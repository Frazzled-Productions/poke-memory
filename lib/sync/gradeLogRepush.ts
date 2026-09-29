import type { SupabaseClient } from "@supabase/supabase-js";
import type { GradeLogEntry } from "@/lib/gradelog/persistence";
import { isCloudPushHeld } from "@/lib/gradelog/persistence";
import { isGradeLogEntry, pushGradeLog } from "@/lib/sync/gradeLog";
import { HELD_COPY_STALE_MS } from "@/lib/sync/heldGrade";

/**
 * Grade-log reconcile leg (#2117).
 *
 * A `grade_log` entry that did not reach Supabase when it was appended (offline
 * or flaky network, tab killed between append and push, or a grade held for
 * undo across a reload - #2052) stays local-only, and `pullAndMerge` used to
 * only union the CLOUD log into local. This leg pushes the local entries the
 * cloud lacks. It runs inside `pullAndMerge` strictly AFTER a successful
 * `pullGradeLog` (pull-before-push preserved) and is best-effort like every
 * non-card leg.
 */

/** Max rows per upsert request, bounding the payload for large local logs. */
export const GRADE_LOG_REPUSH_BATCH_SIZE = 200;

/**
 * UTC calendar date (`YYYY-MM-DD`) of a `last_reset_at` timestamptz, or null
 * when absent / unparseable. Mirrors the DB trigger's `reset_at::date`.
 */
function resetCutoffDate(lastResetAt: string | null): string | null {
  if (!lastResetAt) return null;
  const t = Date.parse(lastResetAt);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/**
 * Pure diff: the local entries that should be pushed to the cloud.
 *
 * Kept: valid entries whose `occurredAt` the cloud lacks.
 * Dropped:
 *  - already in the cloud (the (user_id, occurred_at) key);
 *  - `!isGradeLogEntry` (e.g. legacy entries without `subjectKey`: the column
 *    is NOT NULL, so one such row would fail the whole batched upsert);
 *  - dated before `last_reset_at` (migration 022's
 *    `grade_log_reject_pre_reset_trigger` RAISEs on them, which would abort
 *    the whole batch: they are stale pre-reset data by definition);
 *  - still held for undo (#2052 invariant: the cloud sees a grade only once it
 *    is committed). `isCloudPushHeld` covers this tab's holds; another tab's
 *    live hold is invisible to module state, so anything newer than
 *    `HELD_COPY_STALE_MS` (the longest a live hold can last) is also deferred
 *    to a later cycle. A grade whose own push is merely in flight is covered
 *    by the same window and by `ignoreDuplicates`.
 */
export function selectRepushEntries(
  local: readonly GradeLogEntry[],
  cloud: readonly GradeLogEntry[],
  opts: { lastResetAt: string | null; now?: number },
): GradeLogEntry[] {
  const now = opts.now ?? Date.now();
  const cutoffDate = resetCutoffDate(opts.lastResetAt);
  const inCloud = new Set(cloud.map((e) => e.occurredAt));
  const seen = new Set<number>();
  const out: GradeLogEntry[] = [];
  for (const e of local) {
    if (inCloud.has(e.occurredAt) || seen.has(e.occurredAt)) continue;
    if (!isGradeLogEntry(e)) continue;
    if (cutoffDate !== null && e.date < cutoffDate) continue;
    if (isCloudPushHeld(e.occurredAt)) continue;
    if (now - e.occurredAt <= HELD_COPY_STALE_MS) continue;
    seen.add(e.occurredAt);
    out.push(e);
  }
  return out;
}

/**
 * Pushes the local-only entries in batches. Never throws. A failed batch is
 * warned about and skipped (the rest still go, and the entries are retried on
 * the next cycle since they remain local-only). Returns the number of entries
 * in batches that succeeded.
 *
 * `lastResetAt` may be null either because the user never reset or because the
 * settings pull failed. In the latter case a pre-reset row can reach the DB
 * trigger, which is why the push is batched: it sinks one batch, not the leg.
 */
export async function repushLocalGradeLog(
  client: SupabaseClient,
  userId: string,
  local: readonly GradeLogEntry[],
  cloud: readonly GradeLogEntry[],
  opts: { lastResetAt: string | null; now?: number },
): Promise<number> {
  const pending = selectRepushEntries(local, cloud, opts);
  let pushed = 0;
  for (let i = 0; i < pending.length; i += GRADE_LOG_REPUSH_BATCH_SIZE) {
    const batch = pending.slice(i, i + GRADE_LOG_REPUSH_BATCH_SIZE);
    const ok = await pushGradeLog(client, userId, batch);
    if (ok) {
      pushed += batch.length;
    } else {
      console.warn(
        `[pullAndMerge] grade-log re-push failed for ${batch.length} entries (non-fatal, retried next cycle)`,
      );
    }
  }
  return pushed;
}
