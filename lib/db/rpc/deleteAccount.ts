/**
 * delete_account on D1 (design D3): the port of Postgres migration 027, which
 * deleted the auth.users row and let ON DELETE CASCADE remove the rest.
 *
 * One atomic D1 batch deletes every per-user row (card_reviews, grade_log,
 * streak_days, user_settings, push_subscriptions, feedback), then the Better
 * Auth user with its sessions and accounts (lib/db/authUser.ts). Nothing is
 * sent afterwards: the bug-report emails hold no user id, so there is nothing
 * of this account's to find in them (Discord's post deletion went with
 * Discord, 20 November 2026).
 */
import type { D1DatabaseLike } from "../d1";
import { deleteAuthUserStatements } from "../authUser";
import { toDbError } from "../errors";

const USER_TABLES = [
  "card_reviews",
  "grade_log",
  "streak_days",
  "user_settings",
  "push_subscriptions",
  "feedback",
] as const;

export async function deleteAccount(db: D1DatabaseLike, userId: string): Promise<void> {
  try {
    await db.batch([
      ...USER_TABLES.map((table) => db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId)),
      ...deleteAuthUserStatements(db, userId),
    ]);
  } catch (err) {
    throw toDbError(err);
  }
}
