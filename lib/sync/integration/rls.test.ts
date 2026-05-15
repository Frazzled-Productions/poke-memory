/**
 * Integration test: Row Level Security on card_reviews.
 *
 * Verifies the core RLS invariants:
 *   SELECT — user sees only their own rows.
 *   INSERT  — user cannot insert a row with another user's user_id.
 *   UPDATE  — user cannot update another user's rows.
 *
 * All SQL is executed via direct `pg` queries with `set_config('request.jwt.claims', ...)`
 * inside transactions to simulate `auth.uid()`. Each test rolls back at the end.
 *
 * RLS on vanilla Postgres is enforced for non-superuser roles. The tests connect
 * as `rls_test_user` (created in beforeAll without SUPERUSER) so Postgres enforces
 * the RLS policies defined in the migrations, matching the behaviour of PostgREST.
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

const { Pool } = pg;

let adminPool: pg.Pool;
let dbName: string;

// Two distinct user UUIDs.
const USER_A = randomUUID();
const USER_B = randomUUID();

// Pool that connects as an unprivileged role so RLS is enforced.
let rlsPool: pg.Pool;

/**
 * Helper: insert a card_reviews row as the given user using `set_config` to
 * simulate auth.uid(). Runs in its own transaction that commits so subsequent
 * selects can see the row.
 */
async function insertAsUser(
  pool: pg.Pool,
  userId: string,
  subjectKey: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims]);
    await client.query(
      `INSERT INTO card_reviews
         (user_id, card_type, subject_key,
          stability, difficulty, elapsed_days, scheduled_days,
          reps, lapses, fsrs_state,
          due_date, last_review, first_seen,
          seen_in_pasture, updated_at)
       VALUES ($1, 'name', $2,
               1.0, 5.0, 0, 1,
               1, 0, 'review',
               '2026-06-01', '2026-05-30', '2026-05-28',
               false, now())
       ON CONFLICT (user_id, card_type, subject_key) WHERE subject_key IS NOT NULL DO NOTHING`,
      [userId, subjectKey],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Replace the database name in a connection string with a new one.
 */
function withDbName(connectionString: string, dbName: string): string {
  return connectionString.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);
}

beforeAll(async () => {
  ({ pool: adminPool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(adminPool);
  await applyMigrations(adminPool);

  // Create auth.users rows for both test users.
  await insertAuthUser(adminPool, USER_A);
  await insertAuthUser(adminPool, USER_B);

  // Create an unprivileged role for RLS testing (cluster-level, shared).
  await adminPool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rls_test_user') THEN
        CREATE ROLE rls_test_user NOLOGIN;
      END IF;
    END;
    $$;
  `);

  // Grant the role access to the tables in this specific test database.
  await adminPool.query(`
    GRANT USAGE ON SCHEMA public TO rls_test_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON card_reviews TO rls_test_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rls_test_user;
  `);

  // Build the rls pool pointing to the same test database.
  rlsPool = new Pool({ connectionString: withDbName(DATABASE_URL, dbName) });
}, 60_000);

afterAll(async () => {
  await rlsPool.end();
  await dropTestDatabase(adminPool, dbName);
});

/**
 * Run a callback as an unprivileged role with a specific auth.uid() value.
 * Uses SET ROLE to drop superuser privileges so RLS is enforced.
 * The transaction always ROLLBACKs at the end for isolation.
 */
async function asUser<T>(
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await rlsPool.connect();
  try {
    await client.query("BEGIN");
    // Drop to an unprivileged role so RLS policies are enforced.
    await client.query("SET LOCAL ROLE rls_test_user");
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims]);
    const result = await fn(client);
    await client.query("ROLLBACK");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

describe("RLS policies (integration)", () => {
  it("user A cannot SELECT user B's rows", async () => {
    // Seed a row for user B via the admin pool.
    await insertAsUser(adminPool, USER_B, "200");

    const rows = await asUser(USER_A, async (c) => {
      const res = await c.query(
        `SELECT subject_key FROM card_reviews
         WHERE user_id = $1 AND card_type = 'name' AND subject_key = '200'`,
        [USER_B],
      );
      return res.rows;
    });

    // RLS returns an empty set — no error, but user B's row is invisible.
    expect(rows).toHaveLength(0);
  });

  it("user A's INSERT with user_id=B is rejected by RLS", async () => {
    // Attempting to insert with another user's user_id must be rejected.
    await expect(
      asUser(USER_A, async (c) => {
        await c.query(
          `INSERT INTO card_reviews
             (user_id, card_type, subject_key,
              stability, difficulty, elapsed_days, scheduled_days,
              reps, lapses, fsrs_state,
              due_date, last_review, first_seen,
              seen_in_pasture, updated_at)
           VALUES ($1, 'name', '201',
                   1.0, 5.0, 0, 1,
                   1, 0, 'review',
                   '2026-06-01', '2026-05-30', '2026-05-28',
                   false, now())`,
          [USER_B], // deliberately using USER_B's id as user_id
        );
      }),
    ).rejects.toThrow();
  });

  it("user A cannot UPDATE user B's rows", async () => {
    // Seed a row for user B.
    await insertAsUser(adminPool, USER_B, "202");

    // Try to update user B's row as user A — RLS silently matches zero rows.
    await asUser(USER_A, async (c) => {
      await c.query(
        `UPDATE card_reviews
         SET reps = 99
         WHERE user_id = $1 AND card_type = 'name' AND subject_key = '202'`,
        [USER_B],
      );
    });

    // The row must still have reps=1.
    const { rows } = await adminPool.query(
      `SELECT reps FROM card_reviews
       WHERE user_id = $1 AND card_type = 'name' AND subject_key = '202'`,
      [USER_B],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].reps).toBe(1);
  });

  it("user A can read their own rows and not user B's", async () => {
    await insertAsUser(adminPool, USER_A, "301");
    await insertAsUser(adminPool, USER_B, "302");

    const keys = await asUser(USER_A, async (c) => {
      const res = await c.query(
        `SELECT subject_key FROM card_reviews WHERE card_type = 'name'`,
      );
      return res.rows.map((r: { subject_key: string }) => r.subject_key);
    });

    expect(keys).toContain("301");
    expect(keys).not.toContain("302");
  });
});
