import type { SupabaseClient } from "@supabase/supabase-js";
import { pullSession, mergeCloudIntoLocalSilent, maxCloudUpdatedAt } from "@/lib/sync/cloud";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { buildSession, DEFAULT_LIMITS } from "@/lib/review/session";
import { SEED_POKEMON, SEED_EVOLUTION_CARDS } from "@/lib/pokemon/seed";

// Must match the key used in lib/review/persistence.ts.
// Any code that writes this key must also dispatch a synthetic StorageEvent
// so same-tab subscribers (useSessionStorageKey) are notified.
const SESSION_STORAGE_KEY = "poke-memory:review-session:v1";

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

    let merged: ReturnType<typeof buildSession>;
    let saveResult;
    if (localSession !== null) {
      merged = mergeCloudIntoLocalSilent(localSession.cards, cloudRows, syncStatus.lastPullAt);
      saveResult = saveSession({ cards: merged, limits: localSession.limits });
    } else {
      const base = buildSession(SEED_POKEMON, SEED_EVOLUTION_CARDS);
      merged = mergeCloudIntoLocalSilent(base, cloudRows, syncStatus.lastPullAt);
      saveResult = saveSession({ cards: merged, limits: DEFAULT_LIMITS });
    }

    // If the write failed (e.g. storage quota exceeded), bail out without
    // dispatching a StorageEvent — subscribers must not receive a stale
    // notification for a session that was never actually written.
    if (!saveResult.ok) return "error";

    saveSyncStatus({ ...syncStatus, lastPullAt: maxCloudUpdatedAt(cloudRows) });

    // Dispatch a synthetic StorageEvent so same-tab subscribers (e.g.
    // useSessionStorageKey in Stats/Pokédex) see the updated session without a
    // page reload. Cross-tab listeners receive the native event from saveSession.
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: SESSION_STORAGE_KEY,
          storageArea: window.localStorage,
          newValue: window.localStorage.getItem(SESSION_STORAGE_KEY),
        }),
      );
    }

    return "ok";
  } catch {
    return "error";
  }
}
