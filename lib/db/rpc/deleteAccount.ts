/**
 * delete_account on D1 (design D3): the port of Postgres migration 027, which
 * deleted the auth.users row and let ON DELETE CASCADE remove the rest.
 *
 * One atomic D1 batch deletes every per-user row (card_reviews, grade_log,
 * streak_days, user_settings, push_subscriptions, feedback), then the Better
 * Auth user with its sessions and accounts (lib/db/authUser.ts).
 *
 * Discord: in Postgres, deleting a bug-report feedback row fired the 051
 * trigger, which asked /api/discord/notify to delete the Discord post. That
 * trigger is gone, so the batch's first statement collects the posts of the
 * user's bug reports and this function returns them; the caller deletes them
 * after the response (ctx.waitUntil). feedback_discord_posts rows are kept on
 * purpose (as in 051): the Discord side looks each post up by feedback id and
 * removes the row once the Discord message is gone.
 */
import type { D1DatabaseLike } from "../d1";
import { deleteAuthUserStatements } from "../authUser";
import { toDbError } from "../errors";

export interface DiscordPostToDelete {
  feedbackId: string;
  discordMessageId: string;
}

export interface DeleteAccountResult {
  discordPosts: DiscordPostToDelete[];
}

const USER_TABLES = [
  "card_reviews",
  "grade_log",
  "streak_days",
  "user_settings",
  "push_subscriptions",
  "feedback",
] as const;

export async function deleteAccount(db: D1DatabaseLike, userId: string): Promise<DeleteAccountResult> {
  let results;
  try {
    results = await db.batch<{ feedback_id: string; discord_message_id: string }>([
      db
        .prepare(
          `SELECT p.feedback_id, p.discord_message_id
             FROM feedback f JOIN feedback_discord_posts p ON p.feedback_id = f.id
            WHERE f.user_id = ? AND f.category = 'bug'
            ORDER BY p.created_at`,
        )
        .bind(userId),
      ...USER_TABLES.map((table) => db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId)),
      ...deleteAuthUserStatements(db, userId),
    ]);
  } catch (err) {
    throw toDbError(err);
  }
  return {
    discordPosts: (results[0]?.results ?? []).map((r) => ({
      feedbackId: r.feedback_id,
      discordMessageId: r.discord_message_id,
    })),
  };
}

/**
 * After the account's Discord posts are deleted (lib/discord/webhook.ts
 * deleteDiscordPosts): removes their stored ids, so no row outlives its post.
 * Posts whose delete failed or was skipped keep their row.
 */
export async function forgetDiscordPosts(db: D1DatabaseLike, feedbackIds: readonly string[]): Promise<void> {
  if (feedbackIds.length === 0) return;
  try {
    await db.batch(
      feedbackIds.map((id) => db.prepare(`DELETE FROM feedback_discord_posts WHERE feedback_id = ?`).bind(id)),
    );
  } catch (err) {
    throw toDbError(err);
  }
}
