/**
 * Better Auth user rows (db/d1/migrations/0002_auth.sql) the app touches
 * directly. Server code only.
 */
import type { D1DatabaseLike } from "./d1";

/**
 * Deletes a Better Auth user and everything keyed by them, in one batch
 * (all or nothing): their sessions, linked accounts (password, GitHub,
 * Google), then the "user" row. Every app table's user_id references
 * "user"(id) ON DELETE CASCADE, so the user's data goes with it.
 *
 * Verification rows are not keyed by user here (only OAuth state, which
 * expires within minutes: the app has no email verification or reset), so
 * none are deleted.
 *
 * Returns true when a user row was deleted.
 */
export async function deleteAuthUser(db: D1DatabaseLike, userId: string): Promise<boolean> {
  const results = await db.batch([
    db.prepare(`DELETE FROM "session" WHERE "userId" = ?`).bind(userId),
    db.prepare(`DELETE FROM "account" WHERE "userId" = ?`).bind(userId),
    db.prepare(`DELETE FROM "user" WHERE "id" = ?`).bind(userId),
  ]);
  return (results[2]?.meta.changes ?? 0) > 0;
}
