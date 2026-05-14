import type { SupabaseClient } from "@supabase/supabase-js";
import { pullSession, mergeCloudIntoLocalSilent, maxCloudUpdatedAt } from "@/lib/sync/cloud";
import { pullSettings, pullRegionalPrefs } from "@/lib/sync/settings";
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

    let merged: ReturnType<typeof buildSession>;
    let saveResult;
    if (localSession !== null) {
      merged = mergeCloudIntoLocalSilent(localSession.cards, cloudRows, syncStatus.lastPullAt);
      saveResult = await saveSession({ cards: merged, limits: localSession.limits });
    } else {
      // Brand-new device: pull cloud settings FIRST when local has none —
      // otherwise the base is built with DEFAULT_SETTINGS (reverse/cry
      // disabled) and cloud rows for those types are silently dropped by the
      // merge (#391).
      if (!hasStoredSettings()) {
        try {
          const cloudSettings = await pullSettings(client, userId);
          if (cloudSettings !== null) saveSettings(cloudSettings);
        } catch {
          // Best-effort: fall through to default settings.
        }
      }
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

    saveSyncStatus({ ...syncStatus, lastPullAt: maxCloudUpdatedAt(cloudRows) });

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
    } catch {
      // Best-effort — regional prefs failure must not flip sync into error.
    }

    return "ok";
  } catch {
    return "error";
  }
}
