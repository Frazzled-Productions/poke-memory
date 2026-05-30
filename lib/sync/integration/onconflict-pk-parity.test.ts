/**
 * Integration test: onConflict column sets match the DB's PK / UNIQUE constraints.
 *
 * Safeguard for the #1344 / #1243 silent-outage shape: migration 029 widened the
 * card_reviews PK to include `locale` while clients still sent a 3-column onConflict
 * string. Nothing in CI caught the mismatch for ~19 h. This test would have turned
 * that window into a red CI check the moment migration 029 landed without the
 * matching client update.
 *
 * Strategy:
 *   1. Apply all migrations to a fresh DB.
 *   2. For each upsert target, query pg_constraint for the live PK / UNIQUE columns
 *      in declaration order.
 *   3. Compare the ordered array against the parsed client constant imported from
 *      the sync module. An ordered comparison (not a set comparison) is intentional:
 *      order-insensitive set equality is a weaker guard that would not catch a
 *      column added in position 2 that shifts existing columns right.
 *
 * Tables covered:
 *   card_reviews   — PK   (user_id, card_type, subject_key, locale)  — migration 029
 *   streak_days    — UNIQUE (user_id, review_date)                    — migration 001
 *   grade_log      — UNIQUE (user_id, occurred_at)                    — migration 006
 *   user_settings  — PK   (user_id)  — note: no JS .upsert(); written via
 *                    merge_user_settings RPC. Verified here as a schema sanity
 *                    check so any future direct upsert path starts from known ground.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
  applyPreMigrationFixture,
} from "./setup";
import { applyMigrations } from "./applyMigrations";
import pg from "pg";
import { CARD_REVIEWS_CONFLICT_COLS } from "@/lib/sync/cloud";
import { STREAK_DAYS_CONFLICT_COLS } from "@/lib/sync/streak";
import { GRADE_LOG_CONFLICT_COLS } from "@/lib/sync/gradeLog";

let pool: pg.Pool;
let dbName: string;

/**
 * Counts the number of constraints of a given type on a table.
 *
 * Used to assert that exactly one UNIQUE constraint exists before reading its
 * columns — a second UNIQUE constraint added in a future migration would otherwise
 * cause `queryConstraintCols` to return a merged, unpredictable column list.
 *
 * @param tableName - public-schema table name, e.g. "streak_days"
 * @param contype   - 'p' for PRIMARY KEY, 'u' for UNIQUE
 */
async function countConstraints(
  tableName: string,
  contype: "p" | "u",
): Promise<number> {
  const { rows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = $1
       AND c.contype = $2`,
    [tableName, contype],
  );
  return Number(rows[0]?.cnt ?? 0);
}

/**
 * Queries pg_constraint for the columns of a named constraint (or the PRIMARY KEY /
 * UNIQUE constraint of a given type) on a table, returned in declaration order.
 *
 * Callers must first assert via `countConstraints` that exactly one constraint of
 * the queried type exists; if multiple exist the column list returned here is
 * non-deterministic across schema changes.
 *
 * @param tableName   - public-schema table name, e.g. "card_reviews"
 * @param contype     - 'p' for PRIMARY KEY, 'u' for UNIQUE
 */
async function queryConstraintCols(
  tableName: string,
  contype: "p" | "u",
): Promise<string[]> {
  const { rows } = await pool.query<{ column_name: string }>(
    `SELECT a.attname AS column_name
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     JOIN unnest(c.conkey) WITH ORDINALITY AS cols(colnum, ord) ON true
     JOIN pg_attribute a
       ON a.attrelid = c.conrelid AND a.attnum = cols.colnum
     WHERE n.nspname = 'public'
       AND t.relname = $1
       AND c.contype = $2
     ORDER BY cols.ord`,
    [tableName, contype],
  );
  return rows.map((r) => r.column_name);
}

/**
 * Parses a comma-separated onConflict string into an ordered column array.
 * Trims whitespace so "a, b,c" and "a,b,c" both normalise to ["a","b","c"].
 */
function parseConflictCols(cols: string): string[] {
  return cols.split(",").map((c) => c.trim());
}

beforeAll(async () => {
  ({ pool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(pool);
  await applyMigrations(pool);
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(pool, dbName);
});

describe("onConflict ↔ PK/UNIQUE parity (integration)", () => {
  it("card_reviews: client CARD_REVIEWS_CONFLICT_COLS matches the live PK (migration 029 — 4 columns including locale)", async () => {
    // This is the exact check that would have caught the #1344 silent outage.
    // Migration 029 widened the PK from 3 to 4 columns. The client constant must
    // include locale as the 4th column; asserting 4 columns here means a future
    // PK change without a matching client update fails CI immediately.
    const dbCols = await queryConstraintCols("card_reviews", "p");
    const clientCols = parseConflictCols(CARD_REVIEWS_CONFLICT_COLS);

    expect(dbCols).toHaveLength(4); // guard: never revert to the 3-col pre-029 shape
    expect(clientCols).toEqual(dbCols);
  });

  it("streak_days: client STREAK_DAYS_CONFLICT_COLS matches the live UNIQUE constraint (migration 001 — 2 columns)", async () => {
    // Assert exactly one UNIQUE constraint: a second one added later would cause
    // queryConstraintCols to return a merged, non-deterministic column list.
    const constraintCount = await countConstraints("streak_days", "u");
    expect(constraintCount).toBe(1);

    const dbCols = await queryConstraintCols("streak_days", "u");
    const clientCols = parseConflictCols(STREAK_DAYS_CONFLICT_COLS);

    expect(dbCols).toHaveLength(2);
    expect(clientCols).toEqual(dbCols);
  });

  it("grade_log: client GRADE_LOG_CONFLICT_COLS matches the live UNIQUE constraint (migration 006 — 2 columns)", async () => {
    // Assert exactly one UNIQUE constraint: a second one added later would cause
    // queryConstraintCols to return a merged, non-deterministic column list.
    const constraintCount = await countConstraints("grade_log", "u");
    expect(constraintCount).toBe(1);

    const dbCols = await queryConstraintCols("grade_log", "u");
    const clientCols = parseConflictCols(GRADE_LOG_CONFLICT_COLS);

    expect(dbCols).toHaveLength(2);
    expect(clientCols).toEqual(dbCols);
  });

  it("user_settings: PK is (user_id) — schema sanity check (no direct JS .upsert(); written via merge_user_settings RPC)", async () => {
    // user_settings is never written via a direct Supabase .upsert() call from
    // the JS client — it goes through the merge_user_settings RPC which has its
    // own ON CONFLICT (user_id) clause. We verify the live PK shape here as a
    // schema sanity check so any future direct upsert path starts from known ground
    // and knows what columns to include in its onConflict string.
    const dbCols = await queryConstraintCols("user_settings", "p");

    expect(dbCols).toEqual(["user_id"]);
  });
});
