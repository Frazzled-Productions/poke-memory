import type { SupabaseClient } from "@supabase/supabase-js";
import { pullSession, mergeCloudIntoLocalSilent, maxCloudUpdatedAt } from "@/lib/sync/cloud";
import {
  pullUserSettingsRow,
  pullRegionalPrefs,
  type UserSettingsRow,
} from "@/lib/sync/settings";
import { pullStreak, mergeStreak } from "@/lib/sync/streak";
import { pullGradeLog, mergeGradeLog } from "@/lib/sync/gradeLog";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";
import { loadSession, saveSession, bumpSessionStorageKey } from "@/lib/review/persistence";
import { buildSession, DEFAULT_LIMITS } from "@/lib/review/session";
import { hasStoredSettings, loadSettings, saveSettings } from "@/lib/settings/persistence";
import {
  loadStreakData,
  saveStreakData,
  STREAK_UPDATED_EVENT,
} from "@/lib/streak/persistence";
import { loadGradeLog, saveGradeLog } from "@/lib/gradelog/persistence";
import { clearLocalProgress } from "@/lib/storage/reset";
import { seedOptsFromSettings } from "@/lib/review/seedOpts";
import { SEED_POKEMON, SEED_EVOLUTION_CARDS } from "@/lib/pokemon/seed";

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
        saveSettings(pulledRow.settings);
      }
      if (pulledRow.updatedAt !== null) {
        nextLastSettingsPullAt = pulledRow.updatedAt;
      } else if (legacyNeverApplied) {
        nextLastSettingsPullAt = new Date().toISOString();
      }
    }

    let merged: ReturnType<typeof buildSession>;
    let saveResult;
    if (localSession !== null) {
      merged = mergeCloudIntoLocalSilent(localSession.cards, cloudRows, syncStatus.lastPullAt);
      saveResult = await saveSession({ cards: merged, limits: localSession.limits });
    } else {
      // Brand-new device (or just-cleared by the tombstone path above):
      // settings have already been applied if cloud had any, so the base
      // session picks up the cloud-side reverse/cry/etc. opts. Without this,
      // cloud rows for disabled card types are silently dropped by the
      // merge (#391).
      const settings = loadSettings();
      const base = buildSession(
        SEED_POKEMON,
        SEED_EVOLUTION_CARDS,
        undefined,
        seedOptsFromSettings(settings),
      );
      merged = mergeCloudIntoLocalSilent(base, cloudRows, syncStatus.lastPullAt);
      saveResult = await saveSession({ cards: merged, limits: DEFAULT_LIMITS });
    }

    // If the write failed (e.g. storage quota exceeded), bail out — same-tab
    // subscribers will not have received a synthetic StorageEvent because
    // saveSession only dispatches on success.
    if (!saveResult.ok) return "error";

    // Pull regional prefs (timezone + date_format scalar columns) — best-effort,
    // runs on every pull so device B picks up choices made on device A.
    // Cloud non-null values win; null cloud values leave local values untouched.
    try {
      const cloudPrefs = await pullRegionalPrefs(client, userId);
      if (cloudPrefs !== null) {
        const local = loadSettings();
        const next = {
          ...local,
          ...(cloudPrefs.timezone !== null ? { timezone: cloudPrefs.timezone } : {}),
          ...(cloudPrefs.dateFormat !== null ? { dateFormat: cloudPrefs.dateFormat } : {}),
        };
        if (next.timezone !== local.timezone || next.dateFormat !== local.dateFormat) {
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
            window.dispatchEvent(new Event(STREAK_UPDATED_EVENT));
          }
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
    // Stats reads gradeLog inside an effect gated by `useSessionStorageKey`
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
          // re-runs its useSessionStorageKey effect and reads the freshly-
          // written grade_log without waiting for the next pull cycle.
          bumpSessionStorageKey();
        }
      }
    } catch (e) {
      // Best-effort — grade-log pull failure must not flip sync into error.
      console.warn("[pullAndMerge] grade-log pull failed (non-fatal)", e);
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
