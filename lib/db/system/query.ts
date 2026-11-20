/**
 * Small helpers for the system queries: run one bound statement and map any
 * D1 failure to a DbError with a Postgres-style code (lib/db/errors.ts).
 */
import type { D1DatabaseLike } from "../d1";
import { toDbError } from "../errors";

export async function all<T>(db: D1DatabaseLike, sql: string, ...params: unknown[]): Promise<T[]> {
  try {
    const { results } = await db.prepare(sql).bind(...params).all<T>();
    return results;
  } catch (err) {
    throw toDbError(err);
  }
}

/** Runs a write; returns the number of rows changed. */
export async function run(db: D1DatabaseLike, sql: string, ...params: unknown[]): Promise<number> {
  try {
    const { meta } = await db.prepare(sql).bind(...params).run();
    return meta.changes;
  } catch (err) {
    throw toDbError(err);
  }
}
