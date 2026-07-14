/**
 * Integration test helpers for local Postgres.
 *
 * Connects to the Postgres service container started by the GHA `services:`
 * block (or any Postgres instance pointed at by DATABASE_URL). No Management
 * API calls, no Supabase branch quota.
 *
 * Required env var (defaults work for the GHA service container):
 *   DATABASE_URL - connection string, default:
 *                   postgres://postgres:testpass@localhost:5432/poke_memory_test
 *
 * Each test file gets its own isolated database created from DATABASE_URL at
 * runtime, so running multiple test files serially never causes duplicate-index
 * or duplicate-table errors from migrations re-applying to the same schema.
 *
 * Before the user migrations are applied the fixture step must call
 * `applyPreMigrationFixture()`, which installs:
 *   - the `auth` schema + minimal `auth.users` table (FK target for migrations)
 *   - the `auth.uid()` polyfill (reads from `request.jwt.claims` session var)
 *   - the `anon`, `authenticated`, and `service_role` roles (required by
 *     GRANT/REVOKE in migrations)
 *   - a stub `public.rls_auto_enable()` function (required by migration 025)
 */

import pg from "pg";
import { randomBytes } from "node:crypto";

const { Pool } = pg;

/** Base connection string. Override with DATABASE_URL env var. */
export const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:testpass@localhost:5432/poke_memory_test";

/**
 * Parses a Postgres connection string and returns a copy with a different
 * database name.
 */
function withDbName(connectionString: string, dbName: string): string {
  // Replace the database segment at the end of the URL path.
  // postgres://user:pass@host:port/dbname → postgres://user:pass@host:port/<dbName>
  return connectionString.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);
}

/**
 * Creates an isolated test database and returns a Pool connected to it.
 * The caller must call `dropTestDatabase(pool, dbName)` in `afterAll` to clean up.
 *
 * Returns `{ pool, dbName }`.
 */
export async function createTestDatabase(): Promise<{
  pool: pg.Pool;
  dbName: string;
}> {
  const suffix = randomBytes(4).toString("hex");
  const dbName = `poke_test_${suffix}`;

  // Create the DB using a connection to the base database.
  const adminPool = new Pool({ connectionString: DATABASE_URL });
  try {
    // CREATE DATABASE cannot run inside a transaction block; pg single-client
    // executes it as a standalone statement.
    await adminPool.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await adminPool.end();
  }

  const testUrl = withDbName(DATABASE_URL, dbName);
  const pool = new Pool({ connectionString: testUrl });
  return { pool, dbName };
}

/**
 * Drops the isolated test database created by `createTestDatabase`.
 * Safe to call from `afterAll` - it ends the pool and drops the DB.
 */
export async function dropTestDatabase(
  pool: pg.Pool,
  dbName: string,
): Promise<void> {
  await pool.end();

  const adminPool = new Pool({ connectionString: DATABASE_URL });
  try {
    // Terminate any remaining connections to avoid "database is being accessed
    // by other users" error on DROP DATABASE.
    await adminPool.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName}`);
  } finally {
    await adminPool.end();
  }
}

/**
 * Applies the pre-migration fixture that provides Supabase-specific schema
 * objects that vanilla Postgres does not include:
 *
 *   - `auth` schema
 *   - `auth.users` table (minimal - FK target for card_reviews etc.)
 *   - `auth.uid()` function - polyfill that reads `request.jwt.claims` and
 *     returns the `sub` claim as a uuid. Matches what Supabase's GoTrue sets.
 *   - `anon` role (for REVOKE statements in migrations 018 / 025)
 *   - `authenticated` role (for GRANT/REVOKE in migrations 018 / 025)
 *   - `service_role` role (for GRANT statements in migration 046)
 *   - `public.rls_auto_enable()` stub (REVOKE target in migration 025)
 *
 * Roles are shared across all databases in the cluster; the DO block guards
 * against "role already exists" errors when multiple test files run serially.
 *
 * Must be called once per test database, before `applyMigrations()`.
 */
export async function applyPreMigrationFixture(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // Roles - shared cluster-level objects; use DO block to guard duplicates.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role NOLOGIN BYPASSRLS;
        END IF;
      END;
      $$;
    `);

    // auth schema + minimal users table.
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS auth;

      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid()
      );
    `);

    // auth.uid() polyfill: reads the sub claim from request.jwt.claims.
    // Returns NULL when the setting is absent (unauthenticated context).
    await client.query(`
      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $$
        SELECT COALESCE(
          NULLIF(
            current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
            ''
          ),
          NULL
        )::uuid
      $$;
    `);

    // Stub rls_auto_enable so migration 025 can REVOKE EXECUTE from it.
    // On Supabase this is a real DDL event-trigger helper; here it is a no-op.
    await client.query(`
      CREATE OR REPLACE FUNCTION public.rls_auto_enable()
      RETURNS event_trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        -- no-op stub; exists only so migration 025 can REVOKE EXECUTE on it
      END;
      $$;
    `);
  } finally {
    client.release();
  }
}

/**
 * Simulate an authenticated user by setting `request.jwt.claims` for the
 * duration of a callback.
 *
 * The setting is applied transaction-locally via `set_config(..., true)` inside
 * an explicit transaction so it is automatically reverted when the transaction
 * ends (ROLLBACK or COMMIT).
 *
 * @param client  A pg.PoolClient from pool.connect().
 * @param userId  UUID string to expose as `auth.uid()`.
 * @param fn      Callback that runs inside the transaction.
 */
export async function withUser<T>(
  client: pg.PoolClient,
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    // SET LOCAL does not accept bind parameters (Postgres syntax restriction).
    // set_config('name', value, is_local) is the parameterised equivalent.
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims]);
    const result = await fn(client);
    await client.query("ROLLBACK");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * Insert a row into auth.users with the given id (used to satisfy FK constraints).
 */
export async function insertAuthUser(
  pool: pg.Pool,
  userId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [userId],
  );
}

/**
 * Formats a JS Date that node-postgres parsed from a Postgres `date` column into
 * a 'YYYY-MM-DD' string, timezone-robustly (#1685).
 *
 * The pg driver materialises a bare `date` at LOCAL midnight. Using
 * `.toISOString()` converts that to UTC and, in any timezone behind UTC (e.g.
 * Europe/London under BST), renders the day BEFORE - an off-by-one that
 * false-failed the integration suite locally while passing in UTC CI. Reading
 * the LOCAL components instead returns the stored calendar date in every
 * timezone. Only use this on `date` columns; `timestamptz` columns are absolute
 * instants and round-trip correctly through `.toISOString()`.
 */
export function pgDateToISO(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
