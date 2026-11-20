/**
 * Removes a Better Auth user (0002_auth.sql): sessions, accounts, then the
 * "user" row. The per-user app tables also cascade from "user", but
 * lib/db/rpc/deleteAccount.ts deletes them explicitly in the same batch.
 *
 * deleteAuthUserStatements gives the statements so a caller can put them in
 * its own atomic batch; deleteAuthUser runs them on their own.
 */
import type { D1DatabaseLike, D1PreparedStatementLike } from "./d1";
import { toDbError } from "./errors";

export function deleteAuthUserStatements(db: D1DatabaseLike, userId: string): D1PreparedStatementLike[] {
  return [
    db.prepare(`DELETE FROM "session" WHERE "userId" = ?`).bind(userId),
    db.prepare(`DELETE FROM "account" WHERE "userId" = ?`).bind(userId),
    db.prepare(`DELETE FROM "user" WHERE "id" = ?`).bind(userId),
  ];
}

export async function deleteAuthUser(db: D1DatabaseLike, userId: string): Promise<void> {
  try {
    await db.batch(deleteAuthUserStatements(db, userId));
  } catch (err) {
    throw toDbError(err);
  }
}
