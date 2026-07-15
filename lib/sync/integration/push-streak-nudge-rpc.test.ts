/**
 * Integration test: streak-nudge SECURITY DEFINER RPCs (migration 047, #1950).
 *
 * Verifies the two functions the send-streak-nudge route reads through:
 *
 *   public.get_push_streak_days(user_ids uuid[])
 *     - exists, is SECURITY DEFINER with search_path = ''
 *     - returns every streak_days row for the given candidate users only
 *     - EXECUTE is denied to anon and authenticated, granted to service_role
 *
 *   public.get_push_reviewed_today(user_ids uuid[], today_input date)
 *     - same security posture
 *     - returns exactly the distinct user_ids whose card_reviews.last_review
 *       equals today_input, scoped to the given user set
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

const TODAY = "2026-06-15";
const YESTERDAY = "2026-06-14";

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

async function insertCardReview(
  pool: pg.Pool,
  userId: string,
  subjectKey: string,
  lastReview: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO public.card_reviews
       (user_id, card_type, subject_key,
        stability, difficulty, elapsed_days, scheduled_days,
        reps, lapses, fsrs_state,
        due_date, last_review, first_seen,
        locale, seen_in_pasture, updated_at)
     VALUES ($1, 'name', $2,
             2.0, 5.0, 1, 3,
             2, 0, 'review',
             $3, $3, '2026-06-01',
             'en', false, now())`,
    [userId, subjectKey, lastReview],
  );
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

  // card_reviews: USER_A reviewed today; USER_B reviewed yesterday (not
  // today); USER_OUTSIDE_SET reviewed today too but is outside the set.
  await insertCardReview(adminPool, USER_A, "1", TODAY);
  await insertCardReview(adminPool, USER_B, "2", YESTERDAY);
  await insertCardReview(adminPool, USER_OUTSIDE_SET, "3", TODAY);
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(adminPool, dbName);
});

describe("migration 047 - function definitions", () => {
  it("both functions exist as SECURITY DEFINER with an empty search_path", async () => {
    const res = await adminPool.query(
      `SELECT proname, prosecdef, proconfig
       FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace
         AND proname IN ('get_push_streak_days', 'get_push_reviewed_today')
       ORDER BY proname`,
    );
    expect(res.rows.map((r) => r.proname)).toEqual([
      "get_push_reviewed_today",
      "get_push_streak_days",
    ]);
    for (const row of res.rows) {
      expect(row.prosecdef).toBe(true);
      const searchPath = (row.proconfig as string[]).find((c: string) =>
        c.startsWith("search_path="),
      );
      expect(searchPath).toBeDefined();
      expect(searchPath!.replace(/"/g, "")).toBe("search_path=");
    }
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

describe("get_push_reviewed_today - EXECUTE grants", () => {
  it("denies EXECUTE to anon and authenticated", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(
        queryAsRole(
          adminPool,
          role,
          `SELECT * FROM public.get_push_reviewed_today($1::uuid[], $2::date)`,
          [[USER_A], TODAY],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("allows EXECUTE to service_role", async () => {
    const res = await queryAsRole(
      adminPool,
      "service_role",
      `SELECT * FROM public.get_push_reviewed_today($1::uuid[], $2::date)`,
      [[USER_A], TODAY],
    );
    expect(res.rows.length).toBeGreaterThan(0);
  });
});

describe("get_push_reviewed_today - distinguishes last_review = today from other dates", () => {
  it("returns only users whose last_review is exactly today_input, scoped to the given set", async () => {
    const res = await queryAsRole(
      adminPool,
      "service_role",
      `SELECT * FROM public.get_push_reviewed_today($1::uuid[], $2::date)`,
      [[USER_A, USER_B], TODAY],
    );

    expect(Object.keys(res.rows[0]).sort()).toEqual(["user_id"]);

    const users = new Set(res.rows.map((r) => r.user_id));
    // USER_A reviewed today - included. USER_B reviewed yesterday, not today
    // - excluded even though it is a real user with real reviews.
    expect(users).toEqual(new Set([USER_A]));
  });

  it("excludes a user outside the passed user_ids even if they reviewed today", async () => {
    const res = await queryAsRole(
      adminPool,
      "service_role",
      `SELECT * FROM public.get_push_reviewed_today($1::uuid[], $2::date)`,
      [[USER_A], TODAY],
    );
    expect(res.rows.some((r) => r.user_id === USER_OUTSIDE_SET)).toBe(false);
  });

  it("returns no rows when nobody in the set reviewed on that date", async () => {
    const res = await queryAsRole(
      adminPool,
      "service_role",
      `SELECT * FROM public.get_push_reviewed_today($1::uuid[], $2::date)`,
      [[USER_A, USER_B], "2026-06-01"],
    );
    expect(res.rows).toHaveLength(0);
  });

  it("returns no rows for an empty user set", async () => {
    const res = await queryAsRole(
      adminPool,
      "service_role",
      `SELECT * FROM public.get_push_reviewed_today($1::uuid[], $2::date)`,
      [[], TODAY],
    );
    expect(res.rows).toHaveLength(0);
  });

  it("deduplicates when a user has multiple card_reviews rows with last_review = today", async () => {
    // USER_A already has one row with last_review = TODAY from the beforeAll
    // setup; add a second row for the same user/date and confirm the RPC
    // still returns exactly one entry for USER_A (SELECT DISTINCT).
    await insertCardReview(adminPool, USER_A, "1b", TODAY);
    const res = await queryAsRole(
      adminPool,
      "service_role",
      `SELECT * FROM public.get_push_reviewed_today($1::uuid[], $2::date)`,
      [[USER_A], TODAY],
    );
    expect(res.rows.filter((r) => r.user_id === USER_A)).toHaveLength(1);
  });
});
