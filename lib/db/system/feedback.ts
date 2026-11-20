/**
 * Cross-user feedback queries (design D4): the insert from POST /api/feedback
 * (guests have no user, so it cannot go through forUser), the 12-month
 * retention purge (Postgres migration 034's pg_cron job), the weekly digest's
 * read (042) and the message read for the bug-report email's preview.
 *
 * Only importable from the cron, push-send and feedback routes
 * (ESLint no-restricted-imports in eslint.config.mjs).
 */
import type { D1DatabaseLike } from "../d1";
import { all, run } from "./query";

export type FeedbackCategory = "bug" | "feature" | "other";

export type NewFeedback = {
  /** The session user, or null for a guest. Never from the request body. */
  user_id: string | null;
  category: FeedbackCategory;
  message: string;
  page: string | null;
  app_version: string | null;
};

/** Inserts one feedback row; returns its id and database timestamp. */
export async function insertFeedback(
  db: D1DatabaseLike,
  row: NewFeedback,
): Promise<{ id: string; created_at: string }> {
  const [inserted] = await all<{ id: string; created_at: string }>(
    db,
    `INSERT INTO feedback (user_id, category, message, page, app_version)
     VALUES (?, ?, ?, ?, ?)
     RETURNING id, created_at`,
    row.user_id,
    row.category,
    row.message,
    row.page,
    row.app_version,
  );
  return inserted;
}

/** Feedback is kept for 12 calendar months (034: `interval '12 months'`). */
export function feedbackRetentionCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);
  return cutoff;
}

/** The retention purge (034): deletes every feedback row created before `cutoff`; returns how many went. */
export async function deleteFeedbackCreatedBefore(db: D1DatabaseLike, cutoff: Date): Promise<number> {
  return run(db, `DELETE FROM feedback WHERE created_at < ?`, cutoff.toISOString());
}

/**
 * The digest's read (042): rows created at or after `since`, with whether a
 * signed-in user sent each. user_id itself is never selected.
 */
export async function feedbackForDigest(
  db: D1DatabaseLike,
  since: Date,
): Promise<{ id: string; category: string; authenticated: boolean }[]> {
  const rows = await all<{ id: string; category: string; authenticated: number }>(
    db,
    `SELECT id, category, (user_id IS NOT NULL) AS authenticated
       FROM feedback
      WHERE created_at >= ?`,
    since.toISOString(),
  );
  return rows.map((r) => ({ id: r.id, category: r.category, authenticated: r.authenticated === 1 }));
}

/** One row's message, for the bug-report email's preview, or null when the row is gone. */
export async function feedbackMessage(db: D1DatabaseLike, feedbackId: string): Promise<string | null> {
  const [row] = await all<{ message: string }>(db, `SELECT message FROM feedback WHERE id = ?`, feedbackId);
  return row ? row.message : null;
}
