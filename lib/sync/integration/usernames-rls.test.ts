/**
 * Integration test: Row Level Security on public.usernames (#1671).
 *
 * Verifies the RLS invariants for the username/password auth table:
 *   SELECT (public)  - any session (including unauthenticated) can read all rows.
 *   INSERT (owner)   - user may only insert a row where user_id = auth.uid().
 *   INSERT (other)   - inserting with another user's user_id is rejected.
 *   UPDATE           - no UPDATE policy; all attempts are silently filtered.
 *   DELETE           - no DELETE policy; deletion cascades from auth.users only.
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

const USER_A = randomUUID();
const USER_B = randomUUID();
// Distinct user IDs for tests that persist admin-inserted rows without rolling
// back. Each test that calls adminInsertUsername outside a transaction needs its
// own user_id so the UNIQUE(user_id) constraint never rejects a setup insert
// because a prior test already holds a row for the same user.
const USER_B_ANON_SELECT = randomUUID();
const USER_B_UPDATE = randomUUID();
const USER_B_DELETE = randomUUID();

let rlsPool: pg.Pool;

/** Replace the database name in a connection string. */
function withDbName(connectionString: string, db: string): string {
  return connectionString.replace(/\/[^/?]+(\?.*)?$/, `/${db}$1`);
}

/**
 * Insert a row into public.usernames using the admin pool (bypasses RLS).
 * Used to seed test data without going through auth checks.
 */
async function adminInsertUsername(
  pool: pg.Pool,
  username: string,
  userId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO public.usernames (username, user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [username, userId],
  );
}

beforeAll(async () => {
  ({ pool: adminPool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(adminPool);
  await applyMigrations(adminPool);

  await insertAuthUser(adminPool, USER_A);
  await insertAuthUser(adminPool, USER_B);
  await insertAuthUser(adminPool, USER_B_ANON_SELECT);
  await insertAuthUser(adminPool, USER_B_UPDATE);
  await insertAuthUser(adminPool, USER_B_DELETE);

  // Create an unprivileged role for RLS testing (cluster-level).
  await adminPool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rls_test_user') THEN
        CREATE ROLE rls_test_user NOLOGIN;
      END IF;
    END;
    $$;
  `);

  // Grant the role access to the usernames table in this test database.
  await adminPool.query(`
    GRANT USAGE ON SCHEMA public TO rls_test_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.usernames TO rls_test_user;
  `);

  rlsPool = new Pool({ connectionString: withDbName(DATABASE_URL, dbName) });
}, 60_000);

afterAll(async () => {
  await rlsPool.end();
  await dropTestDatabase(adminPool, dbName);
});

/**
 * Run a callback as an unprivileged role with a specific auth.uid() value.
 * Always rolls back for isolation.
 */
async function asUser<T>(
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await rlsPool.connect();
  try {
    await client.query("BEGIN");
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

/**
 * Run a callback with no auth.uid() (unauthenticated / anon context).
 * Always rolls back for isolation.
 */
async function asAnon<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await rlsPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE rls_test_user");
    // Explicitly clear jwt claims to simulate anon.
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
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

describe("usernames RLS policies (integration)", () => {
  // ---------------------------------------------------------------------------
  // SELECT - public
  // ---------------------------------------------------------------------------

  it("authenticated user A can SELECT all rows (intentionally public)", async () => {
    await adminInsertUsername(adminPool, "trainerb", USER_B);

    const rows = await asUser(USER_A, async (c) => {
      const res = await c.query(
        `SELECT username FROM public.usernames WHERE username = $1`,
        ["trainerb"],
      );
      return res.rows;
    });

    // SELECT is open - user A can see user B's row.
    expect(rows).toHaveLength(1);
    expect(rows[0].username).toBe("trainerb");
  });

  it("unauthenticated (anon) session can SELECT all rows", async () => {
    await adminInsertUsername(adminPool, "trainerb2", USER_B_ANON_SELECT);

    const rows = await asAnon(async (c) => {
      const res = await c.query(
        `SELECT username FROM public.usernames WHERE username = $1`,
        ["trainerb2"],
      );
      return res.rows;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].username).toBe("trainerb2");
  });

  // ---------------------------------------------------------------------------
  // INSERT - owner only
  // ---------------------------------------------------------------------------

  it("user A can INSERT a row where user_id = auth.uid() (user A)", async () => {
    // This INSERT should succeed without throwing.
    await asUser(USER_A, async (c) => {
      await c.query(
        `INSERT INTO public.usernames (username, user_id)
         VALUES ('trainera', $1)`,
        [USER_A],
      );
    });
    // Verify the row was inserted (before ROLLBACK) - the test function returns
    // without throwing, which is sufficient. After the transaction ROLLBACK the
    // row is gone, so we confirm success via the absence of an exception.
  });

  it("user A's INSERT with user_id = user B is rejected by RLS", async () => {
    await expect(
      asUser(USER_A, async (c) => {
        await c.query(
          `INSERT INTO public.usernames (username, user_id)
           VALUES ('rogue-insert', $1)`,
          [USER_B], // deliberately another user's id
        );
      }),
    ).rejects.toThrow();
  });

  it("unauthenticated INSERT is rejected by RLS", async () => {
    await expect(
      asAnon(async (c) => {
        await c.query(
          `INSERT INTO public.usernames (username, user_id)
           VALUES ('anon-insert', $1)`,
          [USER_A],
        );
      }),
    ).rejects.toThrow();
  });

  // ---------------------------------------------------------------------------
  // UPDATE - no policy (silently matches zero rows)
  // ---------------------------------------------------------------------------

  it("user A UPDATE on user B's row is silently ignored (no UPDATE policy)", async () => {
    await adminInsertUsername(adminPool, "update-target", USER_B_UPDATE);

    // The update should not throw, but must not change any rows.
    await asUser(USER_A, async (c) => {
      await c.query(
        `UPDATE public.usernames SET user_id = $1 WHERE username = 'update-target'`,
        [USER_A],
      );
    });

    // The admin pool can see the row is unchanged.
    const { rows } = await adminPool.query(
      `SELECT user_id FROM public.usernames WHERE username = 'update-target'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(USER_B_UPDATE);
  });

  // ---------------------------------------------------------------------------
  // DELETE - no policy (silently matches zero rows)
  // ---------------------------------------------------------------------------

  it("user A DELETE on user B's row is silently ignored (no DELETE policy)", async () => {
    await adminInsertUsername(adminPool, "delete-target", USER_B_DELETE);

    await asUser(USER_A, async (c) => {
      await c.query(
        `DELETE FROM public.usernames WHERE username = 'delete-target'`,
      );
    });

    // Row must still exist.
    const { rows } = await adminPool.query(
      `SELECT username FROM public.usernames WHERE username = 'delete-target'`,
    );
    expect(rows).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // CHECK constraints
  // ---------------------------------------------------------------------------

  it("INSERT with uppercase username is rejected by CHECK constraint", async () => {
    await expect(
      adminPool.query(
        `INSERT INTO public.usernames (username, user_id)
         VALUES ('InvalidName', $1)`,
        [USER_A],
      ),
    ).rejects.toThrow();
  });

  it("INSERT with username shorter than 3 chars is rejected by CHECK constraint", async () => {
    await expect(
      adminPool.query(
        `INSERT INTO public.usernames (username, user_id)
         VALUES ('ab', $1)`,
        [USER_A],
      ),
    ).rejects.toThrow();
  });

  it("INSERT with username longer than 30 chars is rejected by CHECK constraint", async () => {
    await expect(
      adminPool.query(
        `INSERT INTO public.usernames (username, user_id)
         VALUES ($1, $2)`,
        ["a".repeat(31), USER_A],
      ),
    ).rejects.toThrow();
  });

  it("INSERT with invalid chars (space) is rejected by CHECK constraint", async () => {
    await expect(
      adminPool.query(
        `INSERT INTO public.usernames (username, user_id)
         VALUES ('has space', $1)`,
        [USER_A],
      ),
    ).rejects.toThrow();
  });

  // ---------------------------------------------------------------------------
  // UNIQUE(user_id) - one username per account
  // ---------------------------------------------------------------------------

  it("a second INSERT for the same user_id is rejected by the one_username_per_user constraint", async () => {
    // First insert succeeds.
    await adminPool.query(
      `INSERT INTO public.usernames (username, user_id) VALUES ('uniquetest1', $1)`,
      [USER_A],
    );

    // A second INSERT with the same user_id (different username) must be rejected.
    await expect(
      adminPool.query(
        `INSERT INTO public.usernames (username, user_id) VALUES ('uniquetest2', $1)`,
        [USER_A],
      ),
    ).rejects.toThrow();
  });
});
