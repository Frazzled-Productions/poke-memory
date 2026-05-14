/**
 * Programmatic migration runner for integration tests.
 *
 * Reads every *.sql file from db/migrations/ in zero-padded numeric order
 * and executes each against the branch via the Supabase Management API's
 * database-query endpoint:
 *   POST /v1/projects/{ref}/database/query
 *
 * This endpoint accepts raw SQL and is available on all Supabase plans.
 * It runs as a superuser-equivalent role, so it can create extensions,
 * set up RLS policies, and execute functions that reference auth.users.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? "";

/** Absolute path to the migrations directory. */
const MIGRATIONS_DIR = resolve(
  new URL("../../../db/migrations", import.meta.url).pathname,
);

/** Execute a SQL string against a branch via the Management API. */
async function executeSql(projectRef: string, sql: string): Promise<void> {
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(
      `database/query failed for ${projectRef}: HTTP ${res.status}: ${body}`,
    );
  }
}

/**
 * Returns migration filenames sorted in strict ascending numeric order.
 * Files must be named with a zero-padded numeric prefix, e.g.:
 *   001_initial_sync_schema.sql
 *   010_card_reviews_string_keys.sql
 *
 * Node's readdirSync returns entries in filesystem (typically alphabetical)
 * order; for zero-padded prefixes that is numerically correct, but we sort
 * explicitly to be safe.
 */
export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // alphabetical = numeric for zero-padded names
}

/**
 * Applies all migrations in numeric order to the given project/branch ref.
 *
 * @param branchRef  The branch project ref (e.g. "abcdefghijklmnop").
 */
export async function applyMigrations(branchRef: string): Promise<void> {
  const files = listMigrationFiles();
  for (const filename of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
    try {
      await executeSql(branchRef, sql);
    } catch (err) {
      throw new Error(
        `Migration ${filename} failed on branch ${branchRef}: ${String(err)}`,
      );
    }
  }
}
