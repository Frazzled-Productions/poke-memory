/**
 * Integration test: fetchAllPages pagination against a real Postgres instance.
 *
 * Inserts 1001 grade_log rows for a test user (one more than the 1000-row
 * PostgREST default cap) and verifies that the pagination helper collects
 * all rows. This pins the regression path where an unpaginated single-request
 * fetch would silently return only 1000 rows.
 *
 * Runs against the local `postgres:15` container via direct pg queries that
 * mirror the shape of a PostgREST `.range()` call, so the test exercises the
 * fetchAllPages loop without requiring a live PostgREST / Supabase instance.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
  applyPreMigrationFixture,
  insertAuthUser,
  DATABASE_URL,
} from "./setup";
import { applyMigrations } from "./applyMigrations";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { fetchAllPages } from "@/lib/sync/paginatedFetch";

const { Pool } = pg;

let pool: pg.Pool;
let dbName: string;
const USER_ID = randomUUID();

// Total rows to insert - deliberately one over the 1000-row cap.
const TOTAL_ROWS = 1001;

beforeAll(async () => {
  ({ pool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(pool);
  await applyMigrations(pool);
  await insertAuthUser(pool, USER_ID);

  // Insert TOTAL_ROWS grade_log rows. Each row gets a distinct occurred_at
  // (epoch ms offset from a base timestamp) so the UNIQUE(user_id, occurred_at)
  // constraint is satisfied.
  const BASE_TS = 1700000000000; // 2023-11-14 epoch ms
  const rows = Array.from({ length: TOTAL_ROWS }, (_, i) => ({
    user_id: USER_ID,
    occurred_at: BASE_TS + i,
    entry_date: "2023-11-14",
    card_type: "name",
    grade: 4,
    subject_key: `species:${(i % 1025) + 1}`,
    locale: "en",
  }));

  // Batch insert in chunks of 200 to avoid parameter limit.
  const CHUNK = 200;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    const values = chunk
      .map(
        (r, j) =>
          `($${j * 7 + 1}, $${j * 7 + 2}, $${j * 7 + 3}, $${j * 7 + 4}, $${j * 7 + 5}, $${j * 7 + 6}, $${j * 7 + 7})`,
      )
      .join(", ");
    const params = chunk.flatMap((r) => [
      r.user_id,
      r.occurred_at,
      r.entry_date,
      r.card_type,
      r.grade,
      r.subject_key,
      r.locale,
    ]);
    await pool.query(
      `INSERT INTO grade_log (user_id, occurred_at, entry_date, card_type, grade, subject_key, locale)
       VALUES ${values}
       ON CONFLICT DO NOTHING`,
      params,
    );
  }
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(pool, dbName);
});

describe("fetchAllPages - >1000 row integration", () => {
  it("collects all 1001 rows via paginated queries against a real Postgres table", async () => {
    // Build a PostgREST-shaped fetchPage callback using direct pg queries.
    // LIMIT/OFFSET semantics match PostgREST's .range(from, to) behaviour:
    //   from 0 to 999  → LIMIT 1000 OFFSET 0
    //   from 1000 to 1999 → LIMIT 1000 OFFSET 1000
    const dbUrl = DATABASE_URL.replace(
      /\/[^/?]+(\?.*)?$/,
      `/${dbName}$1`,
    );
    const queryPool = new Pool({ connectionString: dbUrl });

    try {
      const result = await fetchAllPages<{ occurred_at: string }>(
        async (from, to) => {
          const pageSize = to - from + 1;
          const { rows, rowCount } = await queryPool.query(
            `SELECT occurred_at
               FROM grade_log
              WHERE user_id = $1
              ORDER BY occurred_at ASC
              LIMIT $2 OFFSET $3`,
            [USER_ID, pageSize, from],
          );
          // Mimic PostgREST shape: { data, error }
          return { data: rows as { occurred_at: string }[], error: null };
          void rowCount;
        },
        1000,
      );

      expect(result).not.toBeNull();
      expect(result!.length).toBe(TOTAL_ROWS);
    } finally {
      await queryPool.end();
    }
  });

  it("a single unpaginated query returns only 1000 rows (confirms the problem)", async () => {
    // Documents WHY pagination is needed: a naive SELECT with no LIMIT
    // returns all rows via pg directly - but PostgREST caps at 1000.
    // We simulate the cap by manually LIMITing to 1000.
    const { rows } = await pool.query(
      `SELECT occurred_at
         FROM grade_log
        WHERE user_id = $1
        ORDER BY occurred_at ASC
        LIMIT 1000`,
      [USER_ID],
    );
    // Confirms the single-fetch cap would miss the 1001st row.
    expect(rows.length).toBe(1000);
    expect(rows.length).toBeLessThan(TOTAL_ROWS);
  });
});
