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
 * Extracts the leading numeric prefix from a migration filename, e.g.:
 *   "009_drop_legacy.sql" → 9
 *   "010_card_reviews.sql" → 10
 *
 * Returns NaN when no numeric prefix is found.
 */
export function numericPrefix(filename: string): number {
  const match = /^(\d+)_/.exec(filename);
  return match ? parseInt(match[1], 10) : NaN;
}

/**
 * Pure helper: sorts an array of migration filenames in strict ascending
 * numeric-prefix order and throws if any two files share the same prefix.
 *
 * Accepting the list as a parameter makes this testable without filesystem
 * mocking.
 *
 * Throws if two files share the same numeric prefix, which would make the
 * apply order ambiguous and risk silent schema divergence.
 */
export function sortAndValidateMigrationFiles(filenames: string[]): string[] {
  const files = [...filenames].sort((a, b) => {
    const na = numericPrefix(a);
    const nb = numericPrefix(b);
    if (na !== nb) return na - nb;
    // Same numeric prefix: fall back to full filename so the sort is
    // deterministic, but we throw below to surface the collision.
    return a < b ? -1 : a > b ? 1 : 0;
  });

  // Guard: duplicate numeric prefixes make apply order ambiguous.
  const seen = new Map<number, string>();
  for (const f of files) {
    const n = numericPrefix(f);
    if (!isNaN(n)) {
      if (seen.has(n)) {
        throw new Error(
          `Duplicate migration prefix ${n}: "${seen.get(n)}" and "${f}". ` +
            `Rename one to use a unique numeric prefix.`,
        );
      }
      seen.set(n, f);
    }
  }

  return files;
}

/**
 * Returns migration filenames from the migrations directory, sorted in strict
 * ascending numeric order.
 *
 * Files must be named with a zero-padded numeric prefix, e.g.:
 *   001_initial_sync_schema.sql
 *   010_card_reviews_string_keys.sql
 *
 * Node's readdirSync returns entries in filesystem (typically alphabetical)
 * order; we sort explicitly by numeric prefix so the order is stable
 * regardless of filename alphabetical ordering.
 */
export function listMigrationFiles(): string[] {
  const rawFiles = readdirSync(MIGRATIONS_DIR).filter((f) =>
    (f as string).endsWith(".sql"),
  ) as string[];
  return sortAndValidateMigrationFiles(rawFiles);
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
