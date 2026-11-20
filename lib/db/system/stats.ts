/**
 * The public account count for the README user-count badge (GET /api/stats/users, design D13). A
 * single aggregate over Better Auth's `user` table: no row, id or name leaves this function.
 *
 * Only importable from the routes ESLint allows (no-restricted-imports in eslint.config.mjs).
 */
import type { D1DatabaseLike } from "../d1";
import { all } from "./query";

export async function countUsers(db: D1DatabaseLike): Promise<number> {
  const [row] = await all<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM "user"');
  if (typeof row?.n !== "number") throw new Error(`unexpected count result: ${JSON.stringify(row)}`);
  return row.n;
}
