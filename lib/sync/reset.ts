import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Calls the `reset_all_progress` SECURITY DEFINER RPC which atomically deletes
 * all rows in `card_reviews`, `grade_log`, and `streak_days` for the currently
 * authenticated user.
 *
 * `user_settings` is intentionally excluded — the user's preferences (daily
 * limits, practice scope, etc.) are unrelated to card-review history and
 * should survive a progress reset.
 *
 * The RPC reads `auth.uid()` server-side — no `user_id` parameter is needed.
 * Returns `true` on success, `false` on any error (logs to console).
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
