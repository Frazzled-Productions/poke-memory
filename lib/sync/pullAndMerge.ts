import type { SupabaseClient } from "@supabase/supabase-js";
import { pullSession, mergeCloudIntoLocalSilent, maxCloudUpdatedAt } from "@/lib/sync/cloud";
import { pullSettingsWithTimestamp, pullRegionalPrefs } from "@/lib/sync/settings";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { buildSession, DEFAULT_LIMITS } from "@/lib/review/session";
import { hasStoredSettings, loadSettings, saveSettings } from "@/lib/settings/persistence";
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

    const syncStatus = loadSyncStatus();
    const localSession = await loadSession();

    // Pull the JSONB settings blob on every cycle (#572). The brand-new-device
    // path (hasStoredSettings === false) keeps its existing semantics: cloud
    // wins so the base session below is built with the right card-type opts
    // (#391). For devices with stored settings, cloud wins only when its
    // server-side updated_at is strictly newer than the timestamp this device
    // last applied — otherwise the local copy is the freshest view.
    let nextLastSettingsPullAt = syncStatus.lastSettingsPullAt;
    try {
      const pulledSettings = await pullSettingsWithTimestamp(client, userId);
      if (pulledSettings !== null) {
        const localHadSettings = hasStoredSettings();
        const cloudIsNewer =
          pulledSettings.updatedAt !== null &&
          (syncStatus.lastSettingsPullAt === null ||
            pulledSettings.updatedAt > syncStatus.lastSettingsPullAt);
        // `user_settings.updated_at` is `NOT NULL DEFAULT now()` so this
        // branch is unreachable against real Supabase data. It exists for the
        // schema-drift case `pullSettingsWithTimestamp` coerces with `?? null`
        // (response missing the column entirely) — when that happens we still
        // want to apply the blob once and then stamp the cursor so we don't
        // re-apply on every cycle. Removing this guard would silently degrade
        // to "blob applied once, cursor never advances, blob re-applied forever".
        const legacyNeverApplied =
          pulledSettings.updatedAt === null && syncStatus.lastSettingsPullAt === null;
        if (!localHadSettings || cloudIsNewer || legacyNeverApplied) {
          saveSettings(pulledSettings.settings);
        }
        if (pulledSettings.updatedAt !== null) {
          nextLastSettingsPullAt = pulledSettings.updatedAt;
        } else if (legacyNeverApplied) {
          nextLastSettingsPullAt = new Date().toISOString();
        }
      }
    } catch (e) {
      // Best-effort — settings pull failure must not flip sync into error.
      console.warn("[pullAndMerge] settings pull failed (non-fatal)", e);
    }

    let merged: ReturnType<typeof buildSession>;
    let saveResult;
    if (localSession !== null) {
      merged = mergeCloudIntoLocalSilent(localSession.cards, cloudRows, syncStatus.lastPullAt);
      saveResult = await saveSession({ cards: merged, limits: localSession.limits });
    } else {
      // Brand-new device: settings have already been applied above (if cloud
      // had any) so the base session picks up the cloud-side reverse/cry/etc.
      // opts. Without this, cloud rows for disabled card types are silently
      // dropped by the merge (#391).
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

    saveSyncStatus({
      ...syncStatus,
      lastPullAt: maxCloudUpdatedAt(cloudRows),
      lastSettingsPullAt: nextLastSettingsPullAt,
    });

    return "ok";
  } catch {
    return "error";
  }
}
