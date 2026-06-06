import type { SupabaseClient } from "@supabase/supabase-js";
import { pullSession, mergeCloudIntoLocalSilent, maxCloudUpdatedAt } from "@/lib/sync/cloud";
import {
  pullUserSettingsRow,
  pullRegionalPrefs,
  pushSettings,
  mergeLearnedLocales,
  mergeRemovedLocales,
  type UserSettingsRow,
} from "@/lib/sync/settings";
import { pullStreak, mergeStreak } from "@/lib/sync/streak";
import { pullGradeLog, mergeGradeLog } from "@/lib/sync/gradeLog";
import { pullPushSubscriptionCount } from "@/lib/sync/pushSubscriptions";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";
import { loadSession, saveSession, bumpSessionStorageKey } from "@/lib/review/persistence";
import { buildSession, DEFAULT_LIMITS, type ReviewableCard } from "@/lib/review/session";
import { DEFAULT_SETTINGS, hasStoredSettings, loadSettings, saveSettings, resolveActiveLocale } from "@/lib/settings/persistence";
import {
  loadStreakData,
  saveStreakData,
  STREAK_UPDATED_EVENT,
} from "@/lib/streak/persistence";
import { loadGradeLog, saveGradeLog } from "@/lib/gradelog/persistence";
import {
  preserveDeviceLocalKeys,
  loadLastPushedSettings,
  saveLastPushedSettings,
} from "@/lib/settings/lastPushedSnapshot";
import { mtBannerDismissedKey } from "@/lib/storage/keys";
import { clearLocalProgress } from "@/lib/storage/reset";
import { seedOptsFromSettings } from "@/lib/review/seedOpts";
import { loadSeed } from "@/lib/pokemon/seed-async";

/**
 * Fires when `pullAndMerge` completes a cold-load merge that transitioned at
 * least one card's `lastReview` or `firstSeen`. "Cold load" means the device
 * had no user progress when the merge ran - either `localSession` was null
 * (brand-new device, or the tombstone path just wiped it), or it held only
 * pristine seed cards (the practice page raced ahead and saved a fresh
 * empty session before the network pull returned). Surfaces in
 * `ReviewSession` so the practice UI can refresh when the initial sign-in
 * pull arrives after the page has already mounted with pristine seed cards
 * - without this, cold-loading a PWA (or any tab whose local storage is
 * empty but whose user has cloud data) leaves the practice page stuck on
 * "all cards new" until the user navigates away and back (#608).
 *
 * Dispatched only when the pre-merge local state had no user progress, so
 * a mid-review pull - where any card carries `lastReview` or `firstSeen`
 * - does not trigger an unwanted reload that would discard in-flight
 * grades or interrupt a card the user is currently looking at.
 *
 * Same-tab `useLocalStorageKey` subscribers (Stats, Pasture, Pokédex,
 * NavLinks) already react to `saveSession`'s synthetic StorageEvent - this
 * event is the targeted notification for the one surface that can't subscribe
 * to that channel without re-firing on every grade.
 */
export const SYNC_PULL_APPLIED_EVENT = "poke-memory:sync-pull-applied";

/**
 * Order-insensitive set comparison: sort both sides so a mere reordering (e.g.
 * cloud holding the same locales in a different order) doesn't read as a change
 * and trigger a spurious push on every pull cycle.
 */
const setsEqual = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
};

/**
 * True when no card in `cards` has been graded yet - every entry has both
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
 * `before` and `after`, or when `after` contains NEW cards that were not in
 * `before` (inserted from cloud rows for other enrolled locales).
 *
 * Compares by composite key `(card_type, subject_key, locale)` rather than
 * by array position, because `mergeCloudIntoLocalSilent`'s Pass 2 may now
 * append new cards - so the two arrays can differ in length and order.
 *
 * Only `lastReview` and `firstSeen` are compared - other FSRS fields are
 * intentionally excluded because the caller only needs to know whether cloud
 * data populated a previously-empty seed card.
 */
function mergeAffectsProgress(
  before: readonly ReviewableCard[],
  after: readonly ReviewableCard[],
): boolean {
  // New cards inserted means progress was definitely affected.
  if (after.length !== before.length) return true;

  // Build a lookup of before-state keyed by composite identity.
  const beforeByKey = new Map(
    before.map((c) => [
      `${c.cardType}:${c.subjectKey}:${c.locale ?? "en"}`,
      c,
    ]),
  );

  for (const a of after) {
    const key = `${a.cardType}:${a.subjectKey}:${a.locale ?? "en"}`;
    const b = beforeByKey.get(key);
    if (!b) return true; // card not present before - new insertion
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
 *   "ok" - merge completed and persisted.
 *   "error" - pull failed (network/auth); local state unchanged.
 *   "skipped" - called without a client or userId (guest mode).
 *
 * Never throws. Best-effort: errors are swallowed so a network hiccup never
 * breaks the local-first review flow.
 */
export async function pullAndMerge(
  client: SupabaseClient | null,
  userId: string | null,
  /**
   * When true, the push-back leg of the locale union-merge is suppressed.
   * Pulls (reads) remain enabled regardless. Pass `true` whenever any
   * superuser flag is on - the same contract as every other cloud-write path
   * (see AGENTS.md "Superuser mode").
   */
  superuserPaused = false,
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
    // reset_all_progress somewhere - wipe local before any merge runs, so
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

    // Capture the pre-LWW local settings BEFORE any saveSettings call below.
    // The locale union-merge step later (after the card-merge block) must
    // read the ORIGINAL local learningLocales/removedLocales, not the
    // post-LWW values - the LWW block deliberately excludes these two fields
    // from the cloud blob, so the saveSettings spread fills them in from
    // DEFAULT_SETTINGS (["en"]/[]), clobbering any local-only enrolments or
    // tombstones that have not yet been pushed to cloud. Bug #1568-fix-1.
    const preLocalSettings = loadSettings();

    // Apply the JSONB settings blob on every cycle (#572). The brand-new-
    // device path (hasStoredSettings === false) keeps its existing
    // semantics: cloud wins so the base session below is built with the
    // right card-type opts (#391). For devices with stored settings, cloud
    // wins only when its server-side updated_at is strictly newer than the
    // timestamp this device last applied - otherwise the local copy is the
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
      // (response missing the column entirely) - when that happens we still
      // want to apply the blob once and then stamp the cursor so we don't
      // re-apply on every cycle.
      const legacyNeverApplied =
        pulledRow.updatedAt === null && syncStatus.lastSettingsPullAt === null;
      if (!localHadSettings || cloudIsNewer || legacyNeverApplied) {
        // Normalise before writing: a cloud row that pre-dates a field (e.g.
        // mobileNav) would store an incomplete object and trigger a two-load
        // inconsistency until the next loadSettings() call. Spreading over
        // DEFAULT_SETTINGS ensures the stored blob is always complete.
        // preserveDeviceLocalKeys keeps this device's appVisitCount - a stale
        // cloud value (legacy row, manual edit) must not reset the nudge
        // threshold, mirroring the push-side exclusion in diffSettings.
        //
        // learningLocales + removedLocales are deliberately EXCLUDED from the LWW
        // path (#1568): they are managed exclusively by the locale union-merge step
        // below, which computes a tombstone-safe union rather than last-write-wins.
        // Applying cloud raw values here would clobber a local tombstone
        // (removedLocales) between the LWW write and the merge step's re-read.
        // The pre-LWW local values are preserved by using preLocalSettings (captured
        // above) so the locale merge step below still sees the correct original state.
        const { learningLocales: _learningLocales, removedLocales: _removedLocales, ...cloudSettingsWithoutLocales } =
          (pulledRow.settings ?? {}) as Partial<typeof DEFAULT_SETTINGS>;
        const lwwBlob = preserveDeviceLocalKeys(
          {
            ...DEFAULT_SETTINGS,
            ...cloudSettingsWithoutLocales,
            // Re-inject pre-LWW locale fields so saveSettings does not reset
            // them to DEFAULT_SETTINGS defaults. The locale merge step below
            // will compute and write the final merged values.
            learningLocales: preLocalSettings.learningLocales,
            removedLocales: preLocalSettings.removedLocales,
          },
          preLocalSettings,
        );
        // Snapshot the blob BEFORE saveSettings fires SETTINGS_SAVED_EVENT so the
        // AutoSyncOnChange listener sees a zero-key diff and does not re-push
        // cloud-pulled sub-objects back (CC-1, #1682). saveSettings mirrors
        // pokemonNameLocale from activePokemonNameLocale in the written object, so
        // we must do the same here to keep the snapshot and the event detail in sync.
        saveLastPushedSettings({
          ...lwwBlob,
          pokemonNameLocale: lwwBlob.activePokemonNameLocale,
        });
        saveSettings(lwwBlob);
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
      try {
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
      } catch (e) {
        console.warn("[pullAndMerge] mt-banner write-through failed (non-fatal)", e);
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

    // Load seed data asynchronously: the JSON is no longer bundled into the
    // boot chunk, so we await it here rather than using the static imports.
    // loadSeed() is idempotent - the result is cached after the first call.
    const seedData = await loadSeed();

    let merged: ReturnType<typeof buildSession>;
    let saveResult;
    let preMergeCards: ReviewableCard[];
    if (localSession !== null) {
      preMergeCards = localSession.cards;
      // Pass seed data so mergeCloudIntoLocalSilent can insert unmatched cloud
      // rows (other-locale cards enrolled on a different device) as new local
      // cards, ensuring every language's progress is pulled on this device (#1562).
      merged = mergeCloudIntoLocalSilent(
        preMergeCards,
        cloudRows,
        syncStatus.lastPullAt,
        seedData.seedPokemon,
        seedData.seedEvolutionCards,
      );
      saveResult = await saveSession({ cards: merged, limits: localSession.limits });
    } else {
      // Brand-new device (or just-cleared by the tombstone path above):
      // settings have already been applied if cloud had any, so the base
      // session picks up the cloud-side reverse/cry/etc. opts. Without this,
      // cloud rows for disabled card types are silently dropped by the
      // merge (#391).
      const settings = loadSettings();
      preMergeCards = buildSession(
        seedData.seedPokemon,
        seedData.seedEvolutionCards,
        undefined,
        seedOptsFromSettings(settings),
      );
      merged = mergeCloudIntoLocalSilent(
        preMergeCards,
        cloudRows,
        syncStatus.lastPullAt,
        seedData.seedPokemon,
        seedData.seedEvolutionCards,
      );
      saveResult = await saveSession({ cards: merged, limits: DEFAULT_LIMITS });
    }

    // If the write failed (e.g. storage quota exceeded), bail out - same-tab
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

    // Union-merge learningLocales + removedLocales (#1568). Runs on EVERY pull
    // cycle (not gated on cloudIsNewer) because these two arrays must converge
    // across devices regardless of whether the rest of the settings blob is
    // "stale" from this device's perspective.
    //
    // Uses preLocalSettings (captured before any LWW saveSettings) so the
    // original local learningLocales/removedLocales are not lost when the LWW
    // block wrote DEFAULT_SETTINGS.learningLocales/removedLocales as filler.
    //
    // Deliberate push-from-pull exception: we send the merged result back to
    // cloud immediately so the other device sees the union on its next pull.
    // This is confined to `learningLocales` + `removedLocales` only, is
    // fire-and-forget, and is guarded by `superuserPaused` so QA sessions
    // never write to cloud (same contract as every other write path).
    try {
      if (pulledRow !== null && pulledRow.settings !== null) {
        const cloudSettings = pulledRow.settings as Record<string, unknown>;
        // Use pre-LWW local values - not a second loadSettings() call - so
        // enrolments/tombstones not yet pushed to cloud are not lost when the
        // LWW saveSettings block ran with DEFAULT_SETTINGS as the locale filler.
        const cloudLearning = Array.isArray(cloudSettings.learningLocales)
          ? (cloudSettings.learningLocales as import("@/i18n/locales").AppLocale[])
          : null;
        const cloudRemoved = Array.isArray(cloudSettings.removedLocales)
          ? (cloudSettings.removedLocales as import("@/i18n/locales").AppLocale[])
          : null;

        const mergedRemoved = mergeRemovedLocales(preLocalSettings.removedLocales, cloudRemoved);
        const mergedLearning = mergeLearnedLocales(preLocalSettings.learningLocales, cloudLearning, mergedRemoved);

        // Resolve the active locale against the merged learning set.
        // resolveActiveLocale keeps the current device choice if still enrolled,
        // otherwise falls back to English. activePokemonNameLocale is device-local
        // (DEVICE_LOCAL_KEYS) so a change here must NOT trigger a cloud push.
        const mergedActive = resolveActiveLocale(
          preLocalSettings.activePokemonNameLocale,
          null,
          mergedLearning,
        );

        const learningLocalChanged = !setsEqual(mergedLearning, preLocalSettings.learningLocales);
        const removedLocalChanged = !setsEqual(mergedRemoved, preLocalSettings.removedLocales);
        const activeChanged = mergedActive !== preLocalSettings.activePokemonNameLocale;

        // Push back ONLY when cloud is missing the merged content (i.e. the merge
        // actually changes what cloud holds). activePokemonNameLocale is device-local
        // and must NEVER drive a cloud push - exclude it from the push gate.
        const cloudLearningNeedsUpdate =
          !setsEqual(mergedLearning, cloudLearning ?? ["en"]);
        const cloudRemovedNeedsUpdate =
          !setsEqual(mergedRemoved, cloudRemoved ?? []);

        if (learningLocalChanged || removedLocalChanged || activeChanged) {
          // Read post-LWW local settings so the save merges with the already-
          // written LWW values rather than clobbering them with preLocalSettings.
          const currentLocal = loadSettings();

          // Update the last-pushed snapshot BEFORE saveSettings so the
          // SETTINGS_SAVED_EVENT listener in AutoSyncOnChange sees a zero-key
          // diff for learningLocales/removedLocales and skips the duplicate push.
          // On a fresh device there is no prior snapshot, so seed it from the
          // current local settings (rather than skipping the update, which would
          // let AutoSyncOnChange fire a redundant push on first sign-in).
          //
          // NOTE: we update the snapshot whenever learningLocales or
          // removedLocales change locally (not only when cloud needs an update).
          // Without this, a local-only locale change that saveSettings() writes
          // but the snapshot does not record causes AutoSyncOnChange to see a
          // diff and fire a spurious duplicate push on the next settings save.
          // activePokemonNameLocale is device-local (DEVICE_LOCAL_KEYS) and
          // therefore never in the pushed diff; it does not gate snapshot updates.
          if (learningLocalChanged || removedLocalChanged) {
            const snapshotBase = loadLastPushedSettings() ?? currentLocal;
            saveLastPushedSettings({
              ...snapshotBase,
              learningLocales: mergedLearning,
              removedLocales: mergedRemoved,
            });
          }

          saveSettings({
            ...currentLocal,
            learningLocales: mergedLearning,
            removedLocales: mergedRemoved,
            activePokemonNameLocale: mergedActive,
          });
        }

        // Push back only when cloud is missing the merged content, and only
        // when the superuser write-guard is not active.
        if (!superuserPaused && (cloudLearningNeedsUpdate || cloudRemovedNeedsUpdate)) {
          // Push the merged sets back so cloud reflects the union / tombstone.
          // Fire-and-forget: a failure here must never break the pull cycle.
          pushSettings(client, userId, {
            learningLocales: mergedLearning,
            removedLocales: mergedRemoved,
          }).catch((e) => {
            console.warn("[pullAndMerge] learningLocales push-back failed (non-fatal)", e);
          });
        }
      }
    } catch (e) {
      console.warn("[pullAndMerge] learningLocales/removedLocales merge failed (non-fatal)", e);
    }

    // Pull regional prefs (timezone + date_format + push_notification_hour
    // scalar columns) - best-effort, runs on every pull so device B picks up
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
      // Best-effort - regional prefs failure must not flip sync into error.
      console.warn("[pullAndMerge] regional prefs pull failed (non-fatal)", e);
    }

    // Pull streak_days and union-merge with local (#574). Streak rows are
    // monotonic - each date appears at most once and nothing is ever removed
    // by sync - so a set-union always converges. Without this leg streak data
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
      // Best-effort - streak pull failure must not flip sync into error.
      console.warn("[pullAndMerge] streak pull failed (non-fatal)", e);
    }

    // Pull grade_log and union-merge with local (#575). Grade log entries are
    // monotonic - keyed by `occurredAt` and never removed by sync - so
    // mergeGradeLog (a set-union by `occurredAt`) always converges. Without
    // this leg the accuracy sparkline, grade-breakdown bar, heatmap, and
    // rolling-7-day on Stats are local-only and never see grades from another
    // device.
    //
    // Stats reads gradeLog inside an effect gated by `useLocalStorageKey`
    // (the SESSION_STORAGE_KEY of `poke-memory:review-session:v1`). To wake
    // an open Stats mount after the merge we dispatch a synthetic storage
    // event for that key - the same channel `saveSession` already uses
    // earlier in this function - so the effect re-runs and `loadGradeLog`
    // returns the freshly-written log.
    try {
      const cloudLog = await pullGradeLog(client, userId);
      if (cloudLog !== null) {
        const localLog = await loadGradeLog();
        const mergedLog = mergeGradeLog(localLog, cloudLog);
        // Length-only check: mergeGradeLog is a set-union by `occurredAt`, and
        // the only way merged.length === local.length is "every cloud entry
        // shares its occurredAt with a local entry" - which means cloud
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
      // Best-effort - grade-log pull failure must not flip sync into error.
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
