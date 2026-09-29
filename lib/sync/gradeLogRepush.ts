import type { SupabaseClient } from "@supabase/supabase-js";
import type { GradeLogEntry } from "@/lib/gradelog/persistence";
import { isCloudPushHeld } from "@/lib/gradelog/persistence";
import { isGradeLogEntry, pushGradeLogDetailed } from "@/lib/sync/gradeLog";
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

/** Max rows re-pushed per `pullAndMerge` cycle; the remainder drains on later cycles. */
export const GRADE_LOG_REPUSH_MAX_ROWS_PER_CYCLE = 1000;

/** Max upsert requests per cycle, including bisection retries. */
export const GRADE_LOG_REPUSH_MAX_REQUESTS_PER_CYCLE = 25;

/**
 * `occurredAt` values the server rejected as single-row requests, kept for
 * this page load only so a poisoned row is not retried every cycle. A reload
 * clears it, so a row fixed server-side is retried then.
 */
const rejectedThisSession = new Set<number>();

/** Test helper: clears the per-session rejected set. */
export function resetRejectedGradeLogRepush(): void {
  rejectedThisSession.clear();
}

/**
 * UTC calendar date (`YYYY-MM-DD`) of a `last_reset_at` timestamptz, or null
 * when absent / unparseable.
 *
 * This mirrors the DB trigger EXACTLY, on purpose: the trigger rejects when
 * `entry_date < reset_at::date`, i.e. the entry's own (user-local-day) date
 * against the UTC date of the reset (PostgREST sessions run in UTC). Do not
 * "fix" this into a timezone-aware comparison: it would then disagree with
 * the trigger and either drop rows the DB accepts or send rows it rejects.
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
 * Pushes the local-only entries, oldest first, capped per cycle. Never throws.
 *
 * A batch the server REJECTS (an error response about the rows) is bisected
 * (retried in halves down to single rows) so one bad row cannot block the
 * valid rows beside it; a row rejected on its own is remembered for this page
 * load so it is not retried every cycle. Any other failure (thrown error,
 * network, timeout, 5xx, rate limit) says nothing about the rows: it stops the
 * leg for this cycle and blacklists nothing. Total rows and requests per cycle
 * are bounded; the rest drains on later cycles. Returns the number pushed.
 *
 * `lastResetAt` may be null because the user never reset OR because the
 * settings pull failed (a null settings row also skips the tombstone wipe). In
 * the latter case a pre-reset row can reach the DB trigger, which is why
 * bisection matters.
 */
export async function repushLocalGradeLog(
  client: SupabaseClient,
  userId: string,
  local: readonly GradeLogEntry[],
  cloud: readonly GradeLogEntry[],
  opts: { lastResetAt: string | null; now?: number },
): Promise<number> {
  const pending = selectRepushEntries(local, cloud, opts)
    .filter((e) => !rejectedThisSession.has(e.occurredAt))
    .sort((a, b) => a.occurredAt - b.occurredAt)
    .slice(0, GRADE_LOG_REPUSH_MAX_ROWS_PER_CYCLE);

  let pushed = 0;
  let requests = 0;
  let rejectedRows = 0;
  let stopped = false;

  const attempt = async (rows: GradeLogEntry[]): Promise<void> => {
    if (stopped || requests >= GRADE_LOG_REPUSH_MAX_REQUESTS_PER_CYCLE) return;
    requests++;
    const result = await pushGradeLogDetailed(client, userId, rows);
    if (result === "ok") {
      pushed += rows.length;
      return;
    }
    if (result === "failed") {
      stopped = true;
      return;
    }
    if (rows.length === 1) {
      rejectedThisSession.add(rows[0].occurredAt);
      rejectedRows++;
      return;
    }
    const mid = Math.ceil(rows.length / 2);
    await attempt(rows.slice(0, mid));
    await attempt(rows.slice(mid));
  };

  for (let i = 0; i < pending.length; i += GRADE_LOG_REPUSH_BATCH_SIZE) {
    await attempt(pending.slice(i, i + GRADE_LOG_REPUSH_BATCH_SIZE));
  }

  if (rejectedRows > 0 || stopped) {
    console.warn(
      `[pullAndMerge] grade-log re-push incomplete (${rejectedRows} rejected rows${stopped ? ", stopped on a network/server failure" : ""}, non-fatal, retried on a later cycle)`,
    );
  }
  return pushed;
}
