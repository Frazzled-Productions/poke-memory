/**
 * Integration test: per-IP rate-limit table + RPC (#1768).
 *
 * Verifies the behaviour of public.check_rate_limit(p_ip_hash, p_action):
 *   - Under cap: returns true and inserts a row.
 *   - At exactly the 10-min cap (5th signup): returns true.
 *   - One over the 10-min cap (6th signup): returns false.
 *   - Over the hourly cap (20 rows within 1 h but older than 10 min): returns false.
 *   - Unprivileged rls_test_user CANNOT directly SELECT or INSERT the table
 *     (RLS blocks direct access).
 *   - The RPC itself works when called as an unprivileged role via the
 *     SECURITY DEFINER grant (anon/authenticated).
 *
 * The RPC is called via pool.query("SELECT public.check_rate_limit($1,$2)")
 * which exercises the SECURITY DEFINER path directly.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
  applyPreMigrationFixture,
  DATABASE_URL,
} from "./setup";
import { applyMigrations } from "./applyMigrations";
import pg from "pg";
import { createHash } from "node:crypto";

const { Pool } = pg;

let adminPool: pg.Pool;
let dbName: string;

/** Replace the database name in a connection string. */
function withDbName(connectionString: string, db: string): string {
  return connectionString.replace(/\/[^/?]+(\?.*)?$/, `/${db}$1`);
}

/** Produce a deterministic 64-char hex hash (matches the DB CHECK constraint). */
function testHash(seed: string): string {
  return createHash("sha256").update("test-salt" + seed).digest("hex");
}

/** Insert N rows directly into rate_limit_buckets at a given offset from now. */
async function seedRows(
  pool: pg.Pool,
  ipHash: string,
  action: string,
  count: number,
  offsetMinutes: number,
): Promise<void> {
  const ts = `now() - interval '${offsetMinutes} minutes'`;
  for (let i = 0; i < count; i++) {
    await pool.query(
      `INSERT INTO public.rate_limit_buckets (ip_hash, action, attempted_at)
       VALUES ($1, $2, ${ts})`,
      [ipHash, action],
    );
  }
}

/** Call the RPC as the superuser (admin pool) and return the boolean result. */
async function callRpc(
  pool: pg.Pool,
  ipHash: string,
  action: string,
): Promise<boolean> {
  const res = await pool.query<{ check_rate_limit: boolean }>(
    `SELECT public.check_rate_limit($1, $2) AS check_rate_limit`,
    [ipHash, action],
  );
  return res.rows[0].check_rate_limit;
}

beforeAll(async () => {
  ({ pool: adminPool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(adminPool);
  await applyMigrations(adminPool);

  // Create an unprivileged role for RLS testing (cluster-level, idempotent).
  await adminPool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rls_test_user') THEN
        CREATE ROLE rls_test_user NOLOGIN;
      END IF;
    END;
    $$;
  `);

  // Grant schema usage but NOT direct table access (RLS must block it).
  await adminPool.query(`
    GRANT USAGE ON SCHEMA public TO rls_test_user;
  `);

  // Grant EXECUTE on the RPC to rls_test_user to simulate the anon/authenticated role.
  await adminPool.query(`
    GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text) TO rls_test_user;
  `);
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(adminPool, dbName);
});

describe("rate_limit_buckets + check_rate_limit RPC (integration)", () => {
  // ---------------------------------------------------------------------------
  // Under cap: first call returns true
  // ---------------------------------------------------------------------------

  it("returns true for the first signup attempt (under cap)", async () => {
    const hash = testHash("ip-under-cap");
    const allowed = await callRpc(adminPool, hash, "signup");
    expect(allowed).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Exactly at the 10-min cap (5th call): true
  // ---------------------------------------------------------------------------

  it("returns true at the 5th signup attempt (exactly at the 10-min cap)", async () => {
    const hash = testHash("ip-at-5th-cap");

    // Seed 4 rows within the last 10 minutes.
    await seedRows(adminPool, hash, "signup", 4, 2);

    // 5th call: still within cap -> must return true.
    const allowed = await callRpc(adminPool, hash, "signup");
    expect(allowed).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // One over the 10-min cap (6th call): false
  // ---------------------------------------------------------------------------

  it("returns false on the 6th signup attempt (over the 10-min cap)", async () => {
    const hash = testHash("ip-over-10m-cap");

    // Seed 5 rows within the last 10 minutes (already at cap).
    await seedRows(adminPool, hash, "signup", 5, 2);

    // 6th call: over cap -> must return false and NOT insert.
    const countBefore = parseInt(
      (await adminPool.query(
        `SELECT COUNT(*) FROM public.rate_limit_buckets WHERE ip_hash = $1`,
        [hash],
      )).rows[0].count,
      10,
    );

    const allowed = await callRpc(adminPool, hash, "signup");

    const countAfter = parseInt(
      (await adminPool.query(
        `SELECT COUNT(*) FROM public.rate_limit_buckets WHERE ip_hash = $1`,
        [hash],
      )).rows[0].count,
      10,
    );

    expect(allowed).toBe(false);
    // No new row should have been inserted.
    expect(countAfter).toBe(countBefore);
  });

  // ---------------------------------------------------------------------------
  // Over the hourly cap: 20 rows within 1 h but older than 10 min -> false
  // ---------------------------------------------------------------------------

  it("returns false when over the hourly cap (20 rows within 1 h, older than 10 min)", async () => {
    const hash = testHash("ip-over-1h-cap");

    // Seed 20 rows between 11 and 59 minutes ago (outside the 10-min window
    // but inside the 1-hour window). This exhausts the hourly cap of 20
    // without triggering the 10-min cap of 5.
    await seedRows(adminPool, hash, "signup", 20, 15);

    const allowed = await callRpc(adminPool, hash, "signup");
    expect(allowed).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Different actions are tracked independently
  // ---------------------------------------------------------------------------

  it("signup and signin caps are tracked independently (same IP hash)", async () => {
    const hash = testHash("ip-action-isolation");

    // Exhaust the signup cap for this IP.
    await seedRows(adminPool, hash, "signup", 5, 2);

    // A signin call on the same IP must still be allowed (10-min cap is 10).
    const signinAllowed = await callRpc(adminPool, hash, "signin");
    expect(signinAllowed).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Unknown action: RPC raises an exception
  // ---------------------------------------------------------------------------

  it("raises an exception for an unknown action", async () => {
    const hash = testHash("ip-unknown-action");
    await expect(
      callRpc(adminPool, hash, "magiclink"),
    ).rejects.toThrow();
  });

  // ---------------------------------------------------------------------------
  // RLS: unprivileged role cannot directly SELECT or INSERT the table
  // ---------------------------------------------------------------------------

  it("rls_test_user cannot directly SELECT rate_limit_buckets", async () => {
    const rlsPool = new Pool({ connectionString: withDbName(DATABASE_URL, dbName) });
    const client = await rlsPool.connect();

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE rls_test_user");
      // RLS is enabled and there are no SELECT policies, so this must fail.
      await expect(
        client.query(`SELECT * FROM public.rate_limit_buckets LIMIT 1`),
      ).rejects.toThrow();
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      await rlsPool.end();
    }
  });

  it("rls_test_user cannot directly INSERT into rate_limit_buckets", async () => {
    const hash = testHash("ip-rls-direct-insert");
    const rlsPool = new Pool({ connectionString: withDbName(DATABASE_URL, dbName) });
    const client = await rlsPool.connect();

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE rls_test_user");
      // No INSERT policy exists, so this must fail.
      await expect(
        client.query(
          `INSERT INTO public.rate_limit_buckets (ip_hash, action) VALUES ($1, 'signup')`,
          [hash],
        ),
      ).rejects.toThrow();
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      await rlsPool.end();
    }
  });

  it("rls_test_user CAN call the check_rate_limit RPC (SECURITY DEFINER bypass)", async () => {
    const hash = testHash("ip-rls-rpc-call");
    const rlsPool = new Pool({ connectionString: withDbName(DATABASE_URL, dbName) });
    const client = await rlsPool.connect();

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE rls_test_user");
      // The RPC is SECURITY DEFINER + GRANT to rls_test_user -> must succeed.
      const res = await client.query<{ check_rate_limit: boolean }>(
        `SELECT public.check_rate_limit($1, 'signup') AS check_rate_limit`,
        [hash],
      );
      // Should return true (under cap) without throwing.
      expect(res.rows[0].check_rate_limit).toBe(true);
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await rlsPool.end();
    }
  });
});
