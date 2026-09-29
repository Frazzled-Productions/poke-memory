import type { SupabaseClient } from "@supabase/supabase-js";
import type { GradeLogEntry } from "@/lib/gradelog/persistence";
import { pushGradeLog } from "@/lib/sync/gradeLog";
import { markPushSucceeded } from "@/lib/sync/persistence";

/**
 * Best-effort push of a single grade-log entry, shared by every path that
 * sends one: `AutoSyncOnChange` (non-held entries, straight from the append
 * event) and `usePerGradeSync` (held entries, at commit time once the undo
 * window has closed - #2052). One helper so the two paths cannot diverge on
 * the success/failure bookkeeping.
 *
 * Grade-log sync is auxiliary to card state ("cards are the primary
 * contract"): a failure only `console.warn`s, it never flips the overall sync
 * status into error.
 */
export async function pushGradeLogEntry(
  client: SupabaseClient,
  userId: string,
  entry: GradeLogEntry,
): Promise<void> {
  const ok = await pushGradeLog(client, userId, [entry]);
  if (ok) {
    markPushSucceeded();
  } else {
    console.warn("[auto-sync] grade log push failed (not retried, see #2117)");
  }
}
