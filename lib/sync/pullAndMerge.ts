import type { SupabaseClient } from "@supabase/supabase-js";
import { pullSession, mergeCloudIntoLocalSilent } from "@/lib/sync/cloud";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";
import { loadSession, saveSession, SESSION_STORAGE_KEY } from "@/lib/review/persistence";
import { buildSession, DEFAULT_LIMITS } from "@/lib/review/session";
import type { ReviewableCard } from "@/lib/review/session";
import { SEED_POKEMON, SEED_EVOLUTION_CARDS } from "@/lib/pokemon/seed";

/**
 * Pulls all cloud rows for the user, merges them into localStorage using the
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
    const localSession = loadSession();

    // Capture pre-merge value so we can skip the StorageEvent when nothing changed.
    const preValue = typeof window !== "undefined" ? window.localStorage.getItem(SESSION_STORAGE_KEY) : null;

    let merged: ReviewableCard[];
    if (localSession !== null) {
      merged = mergeCloudIntoLocalSilent(localSession.cards, cloudRows, syncStatus.lastPullAt);
      saveSession({ cards: merged, limits: localSession.limits });
    } else {
      const base = buildSession(SEED_POKEMON, SEED_EVOLUTION_CARDS);
      merged = mergeCloudIntoLocalSilent(base, cloudRows, syncStatus.lastPullAt);
      saveSession({ cards: merged, limits: DEFAULT_LIMITS });
    }

    // Use the most-recently-updated cloud row's timestamp as lastPullAt so a
    // drifting device clock cannot produce false "cloud is newer" signals on
    // the next pull. When no rows exist or none have updated_at, retain the
    // previous lastPullAt rather than substituting a local clock value.
    let serverTs: string | null = syncStatus.lastPullAt;
    for (const r of cloudRows) {
      if (r.updated_at && (serverTs === null || r.updated_at > serverTs)) {
        serverTs = r.updated_at;
      }
    }

    saveSyncStatus({ ...syncStatus, lastPullAt: serverTs });

    // Dispatch a synthetic StorageEvent so same-tab subscribers (e.g.
    // useSessionStorageKey in Stats/Pokédex) see the updated session without a
    // page reload. Cross-tab listeners receive the native event from saveSession.
    // Skip dispatch when the merged result is identical to what was already stored.
    if (typeof window !== "undefined") {
      const newValue = window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (newValue !== preValue) {
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: SESSION_STORAGE_KEY,
            storageArea: window.localStorage,
            newValue,
          }),
        );
      }
    }

    return "ok";
  } catch {
    return "error";
  }
}
