/**
 * reset_all_progress on D1 (design D3): the port of Postgres migrations 018,
 * 022 and 026.
 *
 * Deletes the user's card_reviews, grade_log and streak_days rows and stamps
 * user_settings.last_reset_at (the tombstone the 022 triggers in
 * db/d1/migrations/0001_schema.sql check, so a stale device cannot push
 * pre-reset progress back). Keeps user_settings (preferences survive a reset),
 * push_subscriptions and feedback.
 *
 * A second reset within 5 seconds of the last one is refused with P0001
 * (026). The cooldown check and the writes run in one atomic D1 batch: every
 * write carries the same NOT EXISTS condition, and the batch's first statement
 * reports whether it held, so a refused reset changes nothing.
 */
import type { D1DatabaseLike } from "../d1";
import { DbError, toDbError } from "../errors";

export const RESET_COOLDOWN_MS = 5_000;

export async function resetAllProgress(
  db: D1DatabaseLike,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const stamp = now.toISOString();
  const cutoff = new Date(now.getTime() - RESET_COOLDOWN_MS).toISOString();
  const cooling = "EXISTS (SELECT 1 FROM user_settings WHERE user_id = ? AND last_reset_at > ?)";

  let results;
  try {
    results = await db.batch<{ cooling: number }>([
      db.prepare(`SELECT ${cooling} AS cooling`).bind(userId, cutoff),
      db.prepare(`DELETE FROM card_reviews WHERE user_id = ? AND NOT ${cooling}`).bind(userId, userId, cutoff),
      db.prepare(`DELETE FROM grade_log WHERE user_id = ? AND NOT ${cooling}`).bind(userId, userId, cutoff),
      db.prepare(`DELETE FROM streak_days WHERE user_id = ? AND NOT ${cooling}`).bind(userId, userId, cutoff),
      db
        .prepare(
          `INSERT INTO user_settings (user_id, last_reset_at, updated_at)
           SELECT ?, ?, ? WHERE NOT ${cooling}
           ON CONFLICT (user_id) DO UPDATE
             SET last_reset_at = excluded.last_reset_at, updated_at = excluded.updated_at`,
        )
        .bind(userId, stamp, stamp, userId, cutoff),
    ]);
  } catch (err) {
    throw toDbError(err);
  }
  if (Number(results[0]?.results[0]?.cooling ?? 0) === 1) {
    throw new DbError("P0001", "reset_all_progress: cooldown active, retry shortly");
  }
}
