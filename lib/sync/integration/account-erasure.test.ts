/**
 * Integration test: `delete_account` (migration 027) erases a user everywhere.
 *
 * The RPC deletes only the `auth.users` row and relies on each table's
 * `ON DELETE CASCADE`, so a table added without one would keep personal data
 * or block the delete. The catalogue tests below fail on such a table even
 * before any row exists; the erasure test proves the cascade on real rows.
 *
 * All seven tables with a `user_id` column are covered: the comment in
 * migration 027 predates three of them.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import {
  createTestDatabase,
  dropTestDatabase,
  applyPreMigrationFixture,
  insertAuthUser,
} from "./setup";
import { applyMigrations } from "./applyMigrations";
import {
  USER_TABLES,
  callRpcAs,
  readUserRows,
  seedUserRows,
} from "./userRows";

let pool: pg.Pool;
let dbName: string;

beforeAll(async () => {
  ({ pool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(pool);
  await applyMigrations(pool);
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(pool, dbName);
});

async function newSeededUser(): Promise<string> {
  const userId = randomUUID();
  await insertAuthUser(pool, userId);
  await seedUserRows(pool, userId);
  return userId;
}

async function authUserExists(userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM auth.users WHERE id = $1`,
    [userId],
  );
  return rowCount === 1;
}

describe("the schema cascades from auth.users (integration)", () => {
  /** Public tables with a `user_id` column, and that column's attribute number. */
  const USER_ID_COLUMNS = `
    SELECT c.oid AS table_oid, c.relname AS table_name, a.attnum
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND a.attname = 'user_id'
      AND NOT a.attisdropped
  `;

  it("USER_TABLES lists every public table with a user_id column", async () => {
    const { rows } = await pool.query(
      `SELECT table_name FROM (${USER_ID_COLUMNS}) u ORDER BY table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([...USER_TABLES].sort());
  });

  it("every public user_id column references auth.users with ON DELETE CASCADE", async () => {
    const { rows } = await pool.query(
      `SELECT u.table_name
       FROM (${USER_ID_COLUMNS}) u
       WHERE NOT EXISTS (
         SELECT 1 FROM pg_constraint con
         WHERE con.contype = 'f'
           AND con.conrelid = u.table_oid
           AND con.conkey = ARRAY[u.attnum]
           AND con.confrelid = 'auth.users'::regclass
           AND con.confdeltype = 'c'
       )
       ORDER BY u.table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });

  it("every foreign key to auth.users cascades, whatever its column is called", async () => {
    const { rows } = await pool.query(
      `SELECT conrelid::regclass::text AS table_name, conname
       FROM pg_constraint
       WHERE contype = 'f'
         AND confrelid = 'auth.users'::regclass
         AND confdeltype <> 'c'
       ORDER BY 1, 2`,
    );
    expect(rows).toEqual([]);
  });
});

describe("delete_account (integration)", () => {
  it("removes the caller from every table and leaves another user untouched", async () => {
    const userA = await newSeededUser();
    const userB = await newSeededUser();

    // Guard: an empty seed would make the assertions below pass vacuously.
    const seededA = await readUserRows(pool, userA);
    for (const table of USER_TABLES) {
      expect(seededA[table], `seed for ${table}`).not.toEqual([]);
    }
    const userBBefore = await readUserRows(pool, userB);

    await callRpcAs(pool, "delete_account", "authenticated", userA);

    expect(await authUserExists(userA)).toBe(false);
    const leftover = await readUserRows(pool, userA);
    for (const table of USER_TABLES) {
      expect(leftover[table], `rows left in ${table}`).toEqual([]);
    }

    expect(await authUserExists(userB)).toBe(true);
    expect(await readUserRows(pool, userB)).toEqual(userBBefore);
  });

  it("leaves guest feedback, which belongs to no user, in place", async () => {
    const userA = await newSeededUser();
    const { rows } = await pool.query(
      `INSERT INTO feedback (user_id, category, message)
       VALUES (NULL, 'feature', 'from a guest')
       RETURNING id`,
    );

    await callRpcAs(pool, "delete_account", "authenticated", userA);

    const guest = await pool.query(`SELECT 1 FROM feedback WHERE id = $1`, [
      rows[0].id,
    ]);
    expect(guest.rowCount).toBe(1);
  });

  it("frees the username for a later sign-up", async () => {
    const userA = await newSeededUser();
    const username = `u-${userA.slice(0, 8)}`;

    await callRpcAs(pool, "delete_account", "authenticated", userA);

    const newcomer = randomUUID();
    await insertAuthUser(pool, newcomer);
    await expect(
      pool.query(
        `INSERT INTO public.usernames (username, user_id) VALUES ($1, $2)`,
        [username, newcomer],
      ),
    ).resolves.toBeDefined();
  });

  it("refuses the anon role, which has no EXECUTE grant", async () => {
    const userA = await newSeededUser();
    const before = await readUserRows(pool, userA);

    await expect(
      callRpcAs(pool, "delete_account", "anon", userA),
    ).rejects.toMatchObject({
      code: "42501",
      message: expect.stringContaining("permission denied for function"),
    });

    expect(await authUserExists(userA)).toBe(true);
    expect(await readUserRows(pool, userA)).toEqual(before);
  });

  it("refuses a session with no subject and deletes nothing", async () => {
    const userA = await newSeededUser();
    const before = await readUserRows(pool, userA);

    await expect(
      callRpcAs(pool, "delete_account", "authenticated", null),
    ).rejects.toMatchObject({
      code: "42501",
      message: "delete_account requires an authenticated session",
    });

    expect(await authUserExists(userA)).toBe(true);
    expect(await readUserRows(pool, userA)).toEqual(before);
  });
});
