import type { SupabaseClient } from "@supabase/supabase-js";
import { clearLocalProgress } from "@/lib/storage/reset";

/**
 * Calls the `reset_all_progress` SECURITY DEFINER RPC which atomically deletes
 * all rows in `card_reviews`, `grade_log`, and `streak_days` for the currently
 * authenticated user.
 *
 * `user_settings` is intentionally excluded - the user's preferences (daily
 * limits, practice scope, etc.) are unrelated to card-review history and
 * should survive a progress reset.
 *
 * The RPC reads `auth.uid()` server-side - no `user_id` parameter is needed.
 * Returns `true` on success, `false` on any error (logs to console).
 *
 * Most callers should use `resetAllProgressEverywhere` instead - calling this
 * directly wipes cloud while leaving local intact, which guarantees the local
 * state will resurrect the cloud rows on the next push (the #293 + #576
 * delete-resurrection class).
 */
export async function resetAllProgress(client: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await client.rpc("reset_all_progress");
    if (error) {
      console.error("[sync] reset_all_progress RPC failed:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[sync] reset_all_progress RPC threw:", err);
    return false;
  }
}

export type ResetEverywhereResult =
  | { ok: true }
  | { ok: false; reason: "cloud-reset-failed" };

/**
 * The signed-in destructive path: wipe cloud first, then local. The order
 * matters - clearing local first and then failing the cloud reset would leave
 * the user with empty local + populated cloud, and the next background pull
 * would re-hydrate local from cloud (defeating the user's intent). When the
 * cloud reset succeeds, local is cleared so the next push has nothing stale to
 * resurrect (the delete-resurrection class).
 *
 * Guest callers (no client/userId) should call `clearLocalProgress` directly - 
 * there is no cloud side to wipe.
 */
export async function resetAllProgressEverywhere(
  client: SupabaseClient,
): Promise<ResetEverywhereResult> {
  const cloudOk = await resetAllProgress(client);
  if (!cloudOk) return { ok: false, reason: "cloud-reset-failed" };
  await clearLocalProgress();
  return { ok: true };
}
