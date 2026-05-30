import type { SupabaseClient } from "@supabase/supabase-js";
import { pullSession, mergeCloudIntoLocalSilent, maxCloudUpdatedAt } from "@/lib/sync/cloud";
import {
  pullUserSettingsRow,
  pullRegionalPrefs,
  type UserSettingsRow,
} from "@/lib/sync/settings";
import { pullStreak, mergeStreak } from "@/lib/sync/streak";
import { pullGradeLog, mergeGradeLog } from "@/lib/sync/gradeLog";
import { pullPushSubscriptionCount } from "@/lib/sync/pushSubscriptions";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";
import { loadSession, saveSession, bumpSessionStorageKey } from "@/lib/review/persistence";
import { buildSession, DEFAULT_LIMITS, type ReviewableCard } from "@/lib/review/session";
import { DEFAULT_SETTINGS, hasStoredSettings, loadSettings, saveSettings } from "@/lib/settings/persistence";
import {
  loadStreakData,
  saveStreakData,
  STREAK_UPDATED_EVENT,
} from "@/lib/streak/persistence";
import { loadGradeLog, saveGradeLog } from "@/lib/gradelog/persistence";
import { preserveDeviceLocalKeys } from "@/lib/settings/lastPushedSnapshot";
import { mtBannerDismissedKey } from "@/components/i18n/MachineTranslationBanner";
import { clearLocalProgress } from "@/lib/storage/reset";
import { seedOptsFromSettings } from "@/lib/review/seedOpts";
import { SEED_POKEMON, SEED_EVOLUTION_CARDS } from "@/lib/pokemon/seed";

/**
 * Fires when `pullAndMerge` completes a cold-load merge that transitioned at
 * least one card's `lastReview` or `firstSeen`. "Cold load" means the device
 * had no user progress when the merge ran — either `localSession` was null
 * (brand-new device, or the tombstone path just wiped it), or it held only
 * pristine seed cards (the practice page raced ahead and saved a fresh
 * empty session before the network pull returned). Surfaces in
 * `ReviewSession` so the practice UI can refresh when the initial sign-in
 * pull arrives after the page has already mounted with pristine seed cards
 * — without this, cold-loading a PWA (or any tab whose local storage is
 * empty but whose user has cloud data) leaves the practice page stuck on
 * "all cards new" until the user navigates away and back (#608).
 *
 * Dispatched only when the pre-merge local state had no user progress, so
 * a mid-review pull — where any card carries `lastReview` or `firstSeen`
 * — does not trigger an unwanted reload that would discard in-flight
 * grades or interrupt a card the user is currently looking at.
 *
 * Same-tab `useLocalStorageKey` subscribers (Stats, Pasture, Pokédex,
 * NavLinks) already react to `saveSession`'s synthetic StorageEvent — this
 * event is the targeted notification for the one surface that can't subscribe
 * to that channel without re-firing on every grade.
 */
export const SYNC_PULL_APPLIED_EVENT = "poke-memory:sync-pull-applied";

/**
 * True when no card in `cards` has been graded yet — every entry has both
 * `lastReview` and `firstSeen` still null. A freshly-built `buildSession`
 * result satisfies this; a session with even one user grade does not.
 */
function isPristineSession(cards: readonly ReviewableCard[]): boolean {
  for (const c of cards) {
    if (c.state.lastReview !== null) return false;
    if (c.state.firstSeen !== null) return false;
  }
  return true;
}

/**
 * True when at least one card's `lastReview` or `firstSeen` changed between
 * `before` and `after`. Only these two date markers are compared — other FSRS
 * fields (`scheduledDays`, `reps`, `fsrsState`, `dueDate`) are intentionally
 * excluded because the caller only needs to know whether cloud data populated
 * a previously-empty seed card. Both arrays come from the same seed and have
 * matching `id`s in the same order, so a positional comparison is safe.
 */
function mergeAffectsProgress(
  before: readonly ReviewableCard[],
  after: readonly ReviewableCard[],
): boolean {
  if (before.length !== after.length) return true;
  for (let i = 0; i < after.length; i++) {
    const a = after[i];
    const b = before[i];
    if (a.id !== b.id) return true;
    if (a.state.lastReview !== b.state.lastReview) return true;
    if (a.state.firstSeen !== b.state.firstSeen) return true;
  }
  return false;
}

/**
 * Pulls all cloud rows for the user, merges them into IndexedDB using the
 * lastPullAt-based conflict rule, then updates lastPullAt from the server
 * timestamp so subsequent pulls can distinguish new cloud writes from stale ones.
 *
 * Returns:
 *   "ok"      — merge completed and persisted.
 *   "error"   — pull failed (network/auth); local state unchanged.
 *   "skipped" — called without a client or userId (guest mode).
 *
 * Never throws. Best-effort: errors are swallowed so a network hiccup never
 * breaks the local-first review flow.
 */
export async function pullAndMerge(
  client: SupabaseClient | null,
  userId: string | null,
): Promise<"ok" | "error" | "skipped"> {
  if (!client || !userId) return "skipped";

  try {
    const cloudRows = await pullSession(client, userId);
    if (cloudRows === null) return "error";

    let syncStatus = loadSyncStatus();
    let localSession = await loadSession();

    // Pull the full user_settings row up front: we need the JSONB blob, the
    // server-side updated_at (#572 cursor), AND last_reset_at (the #576
    // tombstone marker). One query covers all three.
    let pulledRow: UserSettingsRow | null = null;
    try {
      pulledRow = await pullUserSettingsRow(client, userId);
    } catch (e) {
      console.warn("[pullAndMerge] settings pull failed (non-fatal)", e);
    }

    // Tombstone check (#576). If cloud's `last_reset_at` has advanced past
    // what this device has reconciled, the user has called
    // reset_all_progress somewhere — wipe local before any merge runs, so
    // stale local rows do not survive into the merged session and get pushed
    // back on the next sync. The schema-level triggers (migration 022) catch
    // the resurrection if this app-layer check misses, but doing the wipe
    // here means the user's local state matches cloud immediately.
    if (
      pulledRow?.lastResetAt &&
      (syncStatus.lastSeenResetAt === null ||
        pulledRow.lastResetAt > syncStatus.lastSeenResetAt)
    ) {
      await clearLocalProgress();
      // clearLocalProgress wiped sync-status:v1 under the poke-memory:*
      // sweep. Reload so the rest of this cycle sees ZERO cursors and
      // freshly applies cloud truth across the board.
      syncStatus = loadSyncStatus();
      localSession = null;
    }

    // Apply the JSONB settings blob on every cycle (#572). The brand-new-
    // device path (hasStoredSettings === false) keeps its existing
    // semantics: cloud wins so the base session below is built with the
    // right card-type opts (#391). For devices with stored settings, cloud
    // wins only when its server-side updated_at is strictly newer than the
    // timestamp this device last applied — otherwise the local copy is the
    // freshest view.
    let nextLastSettingsPullAt = syncStatus.lastSettingsPullAt;
    if (pulledRow !== null && pulledRow.settings !== null) {
      const localHadSettings = hasStoredSettings();
      const cloudIsNewer =
        pulledRow.updatedAt !== null &&
        (syncStatus.lastSettingsPullAt === null ||
          pulledRow.updatedAt > syncStatus.lastSettingsPullAt);
      // `user_settings.updated_at` is `NOT NULL DEFAULT now()` so this
      // branch is unreachable against real Supabase data. It exists for the
      // schema-drift case `pullUserSettingsRow` coerces with `?? null`
      // (response missing the column entirely) — when that happens we still
      // want to apply the blob once and then stamp the cursor so we don't
      // re-apply on every cycle.
      const legacyNeverApplied =
        pulledRow.updatedAt === null && syncStatus.lastSettingsPullAt === null;
      if (!localHadSettings || cloudIsNewer || legacyNeverApplied) {
        // Normalise before writing: a cloud row that pre-dates a field (e.g.
        // mobileNav) would store an incomplete object and trigger a two-load
        // inconsistency until the next loadSettings() call. Spreading over
        // DEFAULT_SETTINGS ensures the stored blob is always complete.
        // preserveDeviceLocalKeys keeps this device's appVisitCount — a stale
        // cloud value (legacy row, manual edit) must not reset the nudge
        // threshold, mirroring the push-side exclusion in diffSettings.
        saveSettings(
          preserveDeviceLocalKeys(
            { ...DEFAULT_SETTINGS, ...pulledRow.settings },
            loadSettings(),
          ),
        );
      }

      // Write-through for MT-banner dismissals (#1387, AC2). Union the cloud
      // `dismissedMtBannerLocales` into the standalone localStorage keys so
      // MachineTranslationBanner's read path (which reads the standalone key
      // directly) reflects the cloud state without needing to read settings.
      // We UNION rather than replace so a locally-dismissed locale not yet
      // pushed is never evicted from localStorage by a stale cloud value.
      // This runs on every cycle (not just when cloudIsNewer) because the
      // write is idempotent and the banner may have been dismissed on another
      // device after this device's lastSettingsPullAt cursor was stamped.
      if (typeof window !== "undefined") {
        const cloudLocales: unknown = (pulledRow.settings as Record<string, unknown> | null)
          ?.dismissedMtBannerLocales;
        if (Array.isArray(cloudLocales)) {
          for (const locale of cloudLocales) {
            if (typeof locale === "string") {
              localStorage.setItem(mtBannerDismissedKey(locale), "1");
            }
          }
        }
      }

      if (pulledRow.updatedAt !== null) {
        nextLastSettingsPullAt = pulledRow.updatedAt;
      } else if (legacyNeverApplied) {
        nextLastSettingsPullAt = new Date().toISOString();
      }
    }

    // Capture before the branches so both paths see the same value. Treat a
    // pristine saved session the same as a null session: ReviewSession's
    // mount-time `load()` writes a fresh empty session via IDB (fast) before
    // pullSession's network round-trip returns, so `localSession` here is
    // typically the just-saved pristine cards rather than null even on a
    // genuine cold load. Without the pristine check the dispatch never
    // fires for the canonical PWA-cold-load bug.
    const wasColdLoad =
      localSession === null || isPristineSession(localSession.cards);

    let merged: ReturnType<typeof buildSession>;
    let saveResult;
    let preMergeCards: ReviewableCard[];
    if (localSession !== null) {
      preMergeCards = localSession.cards;
      merged = mergeCloudIntoLocalSilent(preMergeCards, cloudRows, syncStatus.lastPullAt);
      saveResult = await saveSession({ cards: merged, limits: localSession.limits });
    } else {
      // Brand-new device (or just-cleared by the tombstone path above):
      // settings have already been applied if cloud had any, so the base
      // session picks up the cloud-side reverse/cry/etc. opts. Without this,
      // cloud rows for disabled card types are silently dropped by the
      // merge (#391).
      const settings = loadSettings();
      preMergeCards = buildSession(
        SEED_POKEMON,
        SEED_EVOLUTION_CARDS,
        undefined,
        seedOptsFromSettings(settings),
      );
      merged = mergeCloudIntoLocalSilent(preMergeCards, cloudRows, syncStatus.lastPullAt);
      saveResult = await saveSession({ cards: merged, limits: DEFAULT_LIMITS });
    }

    // If the write failed (e.g. storage quota exceeded), bail out — same-tab
    // subscribers will not have received a synthetic StorageEvent because
    // saveSession only dispatches on success.
    if (!saveResult.ok) return "error";

    // Wake `ReviewSession` only on cold loads (#608). Cold load with empty
    // local + signed-in user is the canonical case: the practice page renders
    // pristine seed cards before the pull lands. Restricting to cold loads
    // means a mid-review sign-in (where localSession was non-null) cannot
    // trigger an unwanted reload that discards in-flight grades. A no-op
    // merge (cloud already matches local seed) stays silent, so a follow-up
    // pull from the resulting reload cannot loop.
    if (
      wasColdLoad &&
      typeof window !== "undefined" &&
      mergeAffectsProgress(preMergeCards, merged)
    ) {
      window.dispatchEvent(new CustomEvent(SYNC_PULL_APPLIED_EVENT));
    }

    // Pull regional prefs (timezone + date_format + push_notification_hour
    // scalar columns) — best-effort, runs on every pull so device B picks up
    // choices made on device A. Cloud non-null values win; null cloud values
    // leave local values untouched.
    try {
      const cloudPrefs = await pullRegionalPrefs(client, userId);
      if (cloudPrefs !== null) {
        const local = loadSettings();
        const next = {
          ...local,
          ...(cloudPrefs.timezone !== null ? { timezone: cloudPrefs.timezone } : {}),
          ...(cloudPrefs.dateFormat !== null ? { dateFormat: cloudPrefs.dateFormat } : {}),
          ...(cloudPrefs.pushNotificationHour !== null
            ? { pushNotificationHour: cloudPrefs.pushNotificationHour }
            : {}),
        };
        if (
          next.timezone !== local.timezone ||
          next.dateFormat !== local.dateFormat ||
          next.pushNotificationHour !== local.pushNotificationHour
        ) {
          saveSettings(next);
        }
      }
    } catch (e) {
      // Best-effort — regional prefs failure must not flip sync into error.
      console.warn("[pullAndMerge] regional prefs pull failed (non-fatal)", e);
    }

    // Pull streak_days and union-merge with local (#574). Streak rows are
    // monotonic — each date appears at most once and nothing is ever removed
    // by sync — so a set-union always converges. Without this leg streak data
    // flows one direction only (push per device) and a Mac signing in after
    // graded days on a phone would show its own stale local streak.
    try {
      const cloudDates = await pullStreak(client, userId);
      if (cloudDates !== null) {
        const localDates = loadStreakData();
        const mergedDates = mergeStreak(localDates, cloudDates);
        // Both sides are sorted-deduped ISO date strings (mergeStreak guarantees
        // it on the return; loadStreakData reads back what recordReview wrote,
        // which sorts after every append). So index-by-index equality is enough.
        const changed =
          mergedDates.length !== localDates.length ||
          mergedDates.some((d, i) => d !== localDates[i]);
        if (changed) {
          saveStreakData(mergedDates);
          if (typeof window !== "undefined") {
            // StreakBadge listens to this event directly.
            window.dispatchEvent(new Event(STREAK_UPDATED_EVENT));
          }
          // Stats reads streakDates inside its useLocalStorageKey-gated
          // effect, which does NOT listen to STREAK_UPDATED_EVENT. Bump the
          // session-key so an open Stats mount re-runs and picks up the new
          // dates this cycle, mirroring the grade-log path in #575. Without
          // this Stats lags by one full pull cycle on streak updates (#592).
          bumpSessionStorageKey();
        }
      }
    } catch (e) {
      // Best-effort — streak pull failure must not flip sync into error.
      console.warn("[pullAndMerge] streak pull failed (non-fatal)", e);
    }

    // Pull grade_log and union-merge with local (#575). Grade log entries are
    // monotonic — keyed by `occurredAt` and never removed by sync — so
    // mergeGradeLog (a set-union by `occurredAt`) always converges. Without
    // this leg the accuracy sparkline, grade-breakdown bar, heatmap, and
    // rolling-7-day on Stats are local-only and never see grades from another
    // device.
    //
    // Stats reads gradeLog inside an effect gated by `useLocalStorageKey`
    // (the SESSION_STORAGE_KEY of `poke-memory:review-session:v1`). To wake
    // an open Stats mount after the merge we dispatch a synthetic storage
    // event for that key — the same channel `saveSession` already uses
    // earlier in this function — so the effect re-runs and `loadGradeLog`
    // returns the freshly-written log.
    try {
      const cloudLog = await pullGradeLog(client, userId);
      if (cloudLog !== null) {
        const localLog = await loadGradeLog();
        const mergedLog = mergeGradeLog(localLog, cloudLog);
        // Length-only check: mergeGradeLog is a set-union by `occurredAt`, and
        // the only way merged.length === local.length is "every cloud entry
        // shares its occurredAt with a local entry" — which means cloud
        // contributes nothing new. Avoiding the write in that case skips a
        // useless IDB round-trip and the synthetic event below.
        if (mergedLog.length !== localLog.length) {
          await saveGradeLog(mergedLog);
          // Re-fire saveSession's notification channel so an open Stats mount
          // re-runs its useLocalStorageKey effect and reads the freshly-
          // written grade_log without waiting for the next pull cycle.
          bumpSessionStorageKey();
        }
      }
    } catch (e) {
      // Best-effort — grade-log pull failure must not flip sync into error.
      console.warn("[pullAndMerge] grade-log pull failed (non-fatal)", e);
    }

    // Pull push-subscription count (#1056) as a best-effort signal so the
    // Settings page can render an accurate initial toggle state on a fresh
    // device. Cards remain the primary contract; this leg's failure must
    // never flip overall sync into error.
    try {
      const count = await pullPushSubscriptionCount(client, userId);
      if (count !== null && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("poke-memory:push-subscriptions-pulled", {
            detail: { count },
          }),
        );
      }
    } catch (e) {
      console.warn("[pullAndMerge] push-subscription pull failed (non-fatal)", e);
    }

    saveSyncStatus({
      ...syncStatus,
      lastPullAt: maxCloudUpdatedAt(cloudRows),
      lastSettingsPullAt: nextLastSettingsPullAt,
      lastSeenResetAt: pulledRow?.lastResetAt ?? syncStatus.lastSeenResetAt,
    });

    return "ok";
  } catch {
    return "error";
  }
}
