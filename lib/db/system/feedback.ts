/**
 * Cross-user feedback queries (design D4): the insert from POST /api/feedback
 * (guests have no user, so it cannot go through forUser), the 12-month
 * retention purge (Postgres migration 034's pg_cron job), the weekly digest's
 * read (042) and the Discord post ids (051).
 *
 * Only importable from the cron, push-send, Discord and feedback routes
 * (ESLint no-restricted-imports in eslint.config.mjs).
 */
import type { D1DatabaseLike } from "../d1";
import type { DiscordPostStore } from "@/lib/discord/notify";
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

/**
 * The retention purge (034): deletes every feedback row created before
 * `cutoff` and returns the deleted rows' ids and
 * categories, so the caller can remove their Discord posts (051).
 */
export async function deleteFeedbackCreatedBefore(
  db: D1DatabaseLike,
  cutoff: Date,
): Promise<{ id: string; category: string }[]> {
  return all<{ id: string; category: string }>(
    db,
    `DELETE FROM feedback WHERE created_at < ? RETURNING id, category`,
    cutoff.toISOString(),
  );
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

/**
 * The stored Discord posts (051) for one user's feedback, for account
 * deletion: read them before the feedback rows go, delete the posts with
 * deleteDiscordPosts (lib/discord/webhook.ts), then the rows.
 */
export async function discordPostsForUser(
  db: D1DatabaseLike,
  userId: string,
): Promise<{ feedback_id: string; discord_message_id: string }[]> {
  return all<{ feedback_id: string; discord_message_id: string }>(
    db,
    `SELECT p.feedback_id, p.discord_message_id
       FROM feedback_discord_posts p
       JOIN feedback f ON f.id = p.feedback_id
      WHERE f.user_id = ?
      ORDER BY p.feedback_id`,
    userId,
  );
}

/**
 * The database side of the Discord bug notification (lib/discord/notify.ts):
 * the feedback message for the preview, and the posted message ids in
 * feedback_discord_posts (no foreign key, so a row outlives its feedback and
 * the post can still be found and deleted).
 */
export function discordPostStore(db: D1DatabaseLike): DiscordPostStore {
  return {
    async feedbackMessage(feedbackId) {
      const [row] = await all<{ message: string }>(
        db,
        `SELECT message FROM feedback WHERE id = ?`,
        feedbackId,
      );
      return row ? row.message : null;
    },
    async feedbackExists(feedbackId) {
      const [row] = await all(db, `SELECT 1 AS found FROM feedback WHERE id = ?`, feedbackId);
      return row !== undefined;
    },
    async storeMessageId(feedbackId, messageId) {
      await run(
        db,
        `INSERT INTO feedback_discord_posts (feedback_id, discord_message_id) VALUES (?, ?)`,
        feedbackId,
        messageId,
      );
    },
    async messageIdFor(feedbackId) {
      const [row] = await all<{ discord_message_id: string }>(
        db,
        `SELECT discord_message_id FROM feedback_discord_posts WHERE feedback_id = ?`,
        feedbackId,
      );
      return row ? row.discord_message_id : null;
    },
    async forgetMessageId(feedbackId) {
      await run(db, `DELETE FROM feedback_discord_posts WHERE feedback_id = ?`, feedbackId);
    },
  };
}
