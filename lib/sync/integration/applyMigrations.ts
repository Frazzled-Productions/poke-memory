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
 * Pre-existing duplicate prefixes that pre-date the collision guard. The two
 * 009_ files were intentionally landed in that order historically; renaming
 * them now would break migration-drift parity against applied state. The
 * alphabetical fallback below sorts them in the order Supabase actually
 * applied them (verified against `list_migrations`: drop_legacy_per_pre_evo
 * before grade_log_card_id), so the apply sequence stays correct.
 *
 * New duplicate prefixes are still a collision — see the guard below.
 */
const KNOWN_PREFIX_DUPLICATES = new Set<number>([9]);

/**
 * Pure helper: sorts an array of migration filenames in strict ascending
 * numeric-prefix order, falling back to lexicographic order within the same
 * prefix. Throws if any two files share a numeric prefix that is NOT on the
 * `KNOWN_PREFIX_DUPLICATES` allow-list.
 *
 * Accepting the list as a parameter makes this testable without filesystem
 * mocking.
 */
export function sortAndValidateMigrationFiles(filenames: string[]): string[] {
  const files = [...filenames].sort((a, b) => {
    const na = numericPrefix(a);
    const nb = numericPrefix(b);
    if (na !== nb) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  // Guard: a new duplicate prefix is a real collision — apply order would be
  // ambiguous and a future migration in between would silently reorder.
  const seen = new Map<number, string>();
  for (const f of files) {
    const n = numericPrefix(f);
    if (!isNaN(n)) {
      if (seen.has(n) && !KNOWN_PREFIX_DUPLICATES.has(n)) {
        throw new Error(
          `Duplicate migration prefix ${n}: "${seen.get(n)}" and "${f}". ` +
            `Rename one to use a unique numeric prefix, or add ${n} to ` +
            `KNOWN_PREFIX_DUPLICATES with a comment explaining why the ` +
            `alphabetical fallback matches applied order.`,
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
