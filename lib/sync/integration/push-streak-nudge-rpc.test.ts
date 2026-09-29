/**
 * Integration test: streak-nudge SECURITY DEFINER RPCs (migration 047, #1950).
 *
 * Verifies the function the send-streak-nudge route reads through:
 *
 *   public.get_push_streak_days(user_ids uuid[])
 *     - exists, is SECURITY DEFINER with search_path = ''
 *     - returns every streak_days row for the given candidate users only
 *     - EXECUTE is denied to anon and authenticated, granted to service_role
 *
 * `get_push_reviewed_today` (also created by 047) was unused after #2113 and
 * is dropped by migration 048; the test below asserts it is gone.
 *
 * A mocked-RPC unit test proves the route's branching but not the DB
 * contract (see the #1883 lesson in AGENTS.md), so the calls here go
 * against the real functions on the local Postgres container.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
  applyPreMigrationFixture,
  insertAuthUser,
  pgDateToISO,
} from "./setup";
import { applyMigrations } from "./applyMigrations";
import pg from "pg";
import { randomUUID } from "node:crypto";

let adminPool: pg.Pool;
let dbName: string;

const USER_A = randomUUID();
const USER_B = randomUUID();
/** Not part of the candidate set passed to the RPCs in most tests. */
const USER_OUTSIDE_SET = randomUUID();

/**
 * Runs a statement inside a transaction under SET LOCAL ROLE <role>, rolling
 * back afterwards so a permission failure never poisons the pool connection.
 */
async function queryAsRole(
  pool: pg.Pool,
  role: string,
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    const result = await client.query(sql, params);
    await client.query("ROLLBACK");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  ({ pool: adminPool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(adminPool);
  await applyMigrations(adminPool);

  await adminPool.query(
    `GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role`,
  );

  for (const uid of [USER_A, USER_B, USER_OUTSIDE_SET]) {
    await insertAuthUser(adminPool, uid);
  }

  // streak_days: USER_A has a 3-day streak (13th-15th); USER_B has one day
  // outside the candidate set's date range of interest; USER_OUTSIDE_SET has
  // rows too but is never passed in the user_ids array below.
  await adminPool.query(
    `INSERT INTO public.streak_days (user_id, review_date)
     VALUES
       ($1, '2026-06-13'), ($1, '2026-06-14'), ($1, '2026-06-15'),
       ($2, '2026-06-10'),
       ($3, '2026-06-15')`,
    [USER_A, USER_B, USER_OUTSIDE_SET],
  );
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(adminPool, dbName);
});

describe("migration 047/048 - function definitions", () => {
  it("get_push_streak_days exists as SECURITY DEFINER with an empty search_path", async () => {
    const res = await adminPool.query(
      `SELECT proname, prosecdef, proconfig
       FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace
         AND proname = 'get_push_streak_days'`,
    );
    expect(res.rows.map((r) => r.proname)).toEqual(["get_push_streak_days"]);
    const row = res.rows[0];
    expect(row.prosecdef).toBe(true);
    const searchPath = (row.proconfig as string[]).find((c: string) =>
      c.startsWith("search_path="),
    );
    expect(searchPath).toBeDefined();
    expect(searchPath!.replace(/"/g, "")).toBe("search_path=");
  });

  it("get_push_reviewed_today is dropped by migration 048 (#2116)", async () => {
    const res = await adminPool.query(
      `SELECT proname FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace
         AND proname = 'get_push_reviewed_today'`,
    );
    expect(res.rows).toHaveLength(0);
  });
});

describe("get_push_streak_days - EXECUTE grants", () => {
  it("denies EXECUTE to anon and authenticated", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(
        queryAsRole(
          adminPool,
          role,
          `SELECT * FROM public.get_push_streak_days($1::uuid[])`,
          [[USER_A]],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("allows EXECUTE to service_role", async () => {
    const res = await queryAsRole(
      adminPool,
      "service_role",
      `SELECT * FROM public.get_push_streak_days($1::uuid[])`,
      [[USER_A]],
    );
    expect(res.rows.length).toBeGreaterThan(0);
  });
});

describe("get_push_streak_days - row shape and scoping", () => {
  it("returns only rows for the passed user_ids", async () => {
    const res = await queryAsRole(
      adminPool,
      "service_role",
      `SELECT * FROM public.get_push_streak_days($1::uuid[])`,
      [[USER_A, USER_B]],
    );

    expect(Object.keys(res.rows[0]).sort()).toEqual(["review_date", "user_id"]);

    const users = new Set(res.rows.map((r) => r.user_id));
    expect(users).toEqual(new Set([USER_A, USER_B]));
    // USER_OUTSIDE_SET's row must never appear.
    expect(res.rows.some((r) => r.user_id === USER_OUTSIDE_SET)).toBe(false);

    const aDates = res.rows
      .filter((r) => r.user_id === USER_A)
      .map((r) => pgDateToISO(r.review_date as Date))
      .sort();
    expect(aDates).toEqual(["2026-06-13", "2026-06-14", "2026-06-15"]);

    const bDates = res.rows
      .filter((r) => r.user_id === USER_B)
      .map((r) => pgDateToISO(r.review_date as Date));
    expect(bDates).toEqual(["2026-06-10"]);
  });

  it("returns no rows for an empty user set", async () => {
    const res = await queryAsRole(
      adminPool,
      "service_role",
      `SELECT * FROM public.get_push_streak_days($1::uuid[])`,
      [[]],
    );
    expect(res.rows).toHaveLength(0);
  });

  it("returns no rows for a user with no streak_days history", async () => {
    const noHistoryUser = randomUUID();
    await insertAuthUser(adminPool, noHistoryUser);
    const res = await queryAsRole(
      adminPool,
      "service_role",
      `SELECT * FROM public.get_push_streak_days($1::uuid[])`,
      [[noHistoryUser]],
    );
    expect(res.rows).toHaveLength(0);
  });
});
