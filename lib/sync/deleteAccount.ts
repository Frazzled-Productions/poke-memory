import type { SupabaseClient } from "@supabase/supabase-js";
import { clearLocalProgress } from "@/lib/storage/reset";

/**
 * Calls the `delete_account` SECURITY DEFINER RPC, which deletes the caller's
 * `auth.users` row. The FK `ON DELETE CASCADE` on `card_reviews`, `streak_days`,
 * `user_settings`, and `grade_log` erases every row of user data atomically.
 *
 * Unlike `reset_all_progress`, this also removes the identity row itself, so
 * re-signing-in with the same provider starts genuinely fresh.
 *
 * The RPC reads `auth.uid()` server-side — no `user_id` parameter is needed.
 * Returns `true` on success, `false` on any error (logs to console).
 *
 * Most callers should use `deleteAccountEverywhere` instead — calling this
 * directly wipes the cloud identity while leaving local data intact.
 */
export async function deleteAccount(client: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await client.rpc("delete_account");
    if (error) {
      console.error("[sync] delete_account RPC failed:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[sync] delete_account RPC threw:", err);
    return false;
  }
}

/**
 * Wipes the `poke-memory:*` localStorage keys, including the settings keys
 * (`poke-memory:settings:*`) that `clearLocalProgress` deliberately preserves.
 *
 * Account deletion is a full erasure — there is no cloud row left to restore
 * preferences from, so leaving stale settings behind would be inconsistent
 * with the user's intent. This is the deliberate departure from a normal
 * sign-out (which keeps local data so guests can carry on).
 */
function clearAllLocalData(): void {
  try {
    if (typeof window === "undefined") return;
    const ls = window.localStorage;
    // Snapshot the keys first via the indexed Storage API (length / key()) —
    // iterating while removing would shift indices. This API works on both the
    // real Storage object and any in-memory test stub.
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k !== null && k.startsWith("poke-memory:")) keys.push(k);
    }
    keys.forEach((k) => ls.removeItem(k));
  } catch {
    // localStorage inaccessible (e.g. Safari ITP in a third-party context).
  }
}

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; reason: "cloud-delete-failed" };

/**
 * The signed-in destructive path for full account erasure: delete the cloud
 * identity first, then clear ALL local data.
 *
 * Order matters — clearing local first and then failing the cloud delete
 * would leave the user with empty local + a populated cloud account, and the
 * next background pull would re-hydrate local from cloud. When the cloud
 * delete succeeds, local is cleared so nothing stale survives.
 *
 * This clears `poke-memory:*` keys in full — including `poke-memory:settings:*`,
 * which `clearLocalProgress` (the reset-progress path) deliberately keeps.
 * `clearLocalProgress` is still called for its IDB-store cleanup and the
 * same-tab storage-event dispatch; the extra settings-key sweep runs after it.
 */
export async function deleteAccountEverywhere(
  client: SupabaseClient,
): Promise<DeleteAccountResult> {
  const cloudOk = await deleteAccount(client);
  if (!cloudOk) return { ok: false, reason: "cloud-delete-failed" };
  // clearLocalProgress handles the IDB stores and the synthetic storage events
  // that same-tab subscribers listen for; it intentionally spares the settings
  // keys, so sweep those separately for a full erasure.
  await clearLocalProgress();
  clearAllLocalData();
  return { ok: true };
}
