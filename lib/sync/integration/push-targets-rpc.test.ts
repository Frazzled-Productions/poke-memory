/**
 * Integration test: Web Push SECURITY DEFINER RPCs (migration 046, #1100).
 *
 * Verifies the two functions the send-daily route reads through:
 *
 *   public.get_push_targets()
 *     - exists, is SECURITY DEFINER with search_path = ''
 *     - returns one row per push subscription LEFT JOINed to the owner's
 *       user_settings row (null settings fields for users without one)
 *     - EXECUTE is denied to anon and authenticated, granted to service_role
 *
 *   public.get_push_due_cards(user_ids uuid[], today_input date)
 *     - same security posture
 *     - returns only rows with due_date <= today_input, hidden_since IS NULL,
 *       and user_id in the given set, with the shape the route consumes
 *       (user_id, card_type, subject_key, first_seen, locale, due_date)
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
/** Has a subscription but NO user_settings row (LEFT JOIN null branch). */
const USER_NO_SETTINGS = randomUUID();
/** Has due cards but no subscription - must not affect get_push_targets. */
const USER_NO_SUB = randomUUID();

const TODAY = "2026-06-15";

/**
 * Runs a statement inside a transaction under SET LOCAL ROLE <role>, rolling
 * back afterwards so a permission failure never poisons the pool connection.
 * Returns the query result, or rethrows the query error.
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
  opts: { dueDate: string; firstSeen?: string | null; hiddenSince?: string | null; locale?: string } ,
): Promise<void> {
  await pool.query(
    `INSERT INTO public.card_reviews
       (user_id, card_type, subject_key,
        stability, difficulty, elapsed_days, scheduled_days,
        reps, lapses, fsrs_state,
        due_date, last_review, first_seen,
        hidden_since, locale,
        seen_in_pasture, updated_at)
     VALUES ($1, 'name', $2,
             2.0, 5.0, 1, 3,
             2, 0, 'review',
             $3, '2026-06-01', $4,
             $5, $6,
             false, now())`,
    [
      userId,
      subjectKey,
      opts.dueDate,
      opts.firstSeen ?? null,
      opts.hiddenSince ?? null,
      opts.locale ?? "en",
    ],
  );
}

beforeAll(async () => {
  ({ pool: adminPool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(adminPool);
  await applyMigrations(adminPool);

  // The Supabase-managed roles need USAGE on the schema to even attempt the
  // function call; without it the failure would be a schema-level denial
  // rather than the function-level EXECUTE denial under test.
  await adminPool.query(
    `GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role`,
  );

  for (const uid of [USER_A, USER_B, USER_NO_SETTINGS, USER_NO_SUB]) {
    await insertAuthUser(adminPool, uid);
  }

  // Subscriptions: two devices for USER_A, one each for USER_B and
  // USER_NO_SETTINGS. USER_NO_SUB has none.
  await adminPool.query(
    `INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth_secret)
     VALUES
       ($1, 'https://push.example/a1', 'p256-a1', 'auth-a1'),
       ($1, 'https://push.example/a2', 'p256-a2', 'auth-a2'),
       ($2, 'https://push.example/b',  'p256-b',  'auth-b'),
       ($3, 'https://push.example/n',  'p256-n',  'auth-n')`,
    [USER_A, USER_B, USER_NO_SETTINGS],
  );

  // Settings rows for USER_A and USER_B only.
  await adminPool.query(
    `INSERT INTO public.user_settings
       (user_id, settings, timezone, push_notification_hour, updated_at)
     VALUES
       ($1, '{"learningLocales":["en","ja"]}'::jsonb, 'Europe/London', 9, now()),
       ($2, '{}'::jsonb, NULL, NULL, now())`,
    [USER_A, USER_B],
  );

  // Due cards for USER_A: one due yesterday (returned), one due today
  // (returned), one due tomorrow (excluded), one hidden (excluded), one ja
  // locale due (returned). USER_NO_SUB has a due card too - it must be
  // returned by get_push_due_cards when asked for, but must never appear in
  // get_push_targets.
  await insertCardReview(adminPool, USER_A, "1", { dueDate: "2026-06-14" });
  await insertCardReview(adminPool, USER_A, "2", { dueDate: TODAY, firstSeen: TODAY });
  await insertCardReview(adminPool, USER_A, "3", { dueDate: "2026-06-16" });
  await insertCardReview(adminPool, USER_A, "4", { dueDate: "2026-06-10", hiddenSince: "2026-06-11" });
  await insertCardReview(adminPool, USER_A, "5", { dueDate: TODAY, locale: "ja" });
  await insertCardReview(adminPool, USER_NO_SUB, "9", { dueDate: "2026-06-01" });
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(adminPool, dbName);
});

describe("migration 046 - function definitions", () => {
  it("both functions exist as SECURITY DEFINER with an empty search_path", async () => {
    const res = await adminPool.query(
      `SELECT proname, prosecdef, proconfig
       FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace
         AND proname IN ('get_push_targets', 'get_push_due_cards')
       ORDER BY proname`,
    );
    expect(res.rows.map((r) => r.proname)).toEqual([
      "get_push_due_cards",
      "get_push_targets",
    ]);
    for (const row of res.rows) {
      expect(row.prosecdef).toBe(true);
      const searchPath = (row.proconfig as string[]).find((c: string) =>
        c.startsWith("search_path="),
      );
      // SET search_path = '' pins an empty search path (018/023 house style).
      expect(searchPath).toBeDefined();
      expect(searchPath!.replace(/"/g, "")).toBe("search_path=");
    }
  });
});

describe("get_push_targets - EXECUTE grants", () => {
  it("denies EXECUTE to anon", async () => {
    await expect(
      queryAsRole(adminPool, "anon", `SELECT * FROM public.get_push_targets()`),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("denies EXECUTE to authenticated", async () => {
    await expect(
      queryAsRole(
        adminPool,
        "authenticated",
        `SELECT * FROM public.get_push_targets()`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("allows EXECUTE to service_role", async () => {
    const res = await queryAsRole(
      adminPool,
      "service_role",
      `SELECT * FROM public.get_push_targets()`,
    );
    expect(res.rows.length).toBe(4);
  });
});

describe("get_push_targets - row shape and join semantics", () => {
  it("returns one row per subscription with the settings fields joined in", async () => {
    const res = await queryAsRole(
      adminPool,
      "service_role",
      `SELECT * FROM public.get_push_targets()`,
    );

    // Exactly the columns the route consumes - a new column here means the
    // route contract changed and this assertion must be updated deliberately.
    expect(Object.keys(res.rows[0]).sort()).toEqual([
      "auth_secret",
      "endpoint",
      "p256dh",
      "push_notification_hour",
      "settings",
      "subscription_id",
      "timezone",
      "user_id",
    ]);

    const byEndpoint = new Map(res.rows.map((r) => [r.endpoint, r]));

    // USER_A: two devices, both carrying the same settings fields.
    for (const endpoint of ["https://push.example/a1", "https://push.example/a2"]) {
      const row = byEndpoint.get(endpoint);
      expect(row).toBeDefined();
      expect(row.user_id).toBe(USER_A);
      expect(row.timezone).toBe("Europe/London");
      expect(row.push_notification_hour).toBe(9);
      expect(row.settings).toEqual({ learningLocales: ["en", "ja"] });
      expect(typeof row.subscription_id).toBe("string");
    }
    expect(byEndpoint.get("https://push.example/a1").p256dh).toBe("p256-a1");
    expect(byEndpoint.get("https://push.example/a1").auth_secret).toBe("auth-a1");

    // USER_B: settings row exists but timezone/hour are NULL.
    const rowB = byEndpoint.get("https://push.example/b");
    expect(rowB.user_id).toBe(USER_B);
    expect(rowB.timezone).toBeNull();
    expect(rowB.push_notification_hour).toBeNull();
    expect(rowB.settings).toEqual({});

    // USER_NO_SETTINGS: LEFT JOIN null branch - subscription still returned.
    const rowN = byEndpoint.get("https://push.example/n");
    expect(rowN.user_id).toBe(USER_NO_SETTINGS);
    expect(rowN.timezone).toBeNull();
    expect(rowN.settings).toBeNull();
    expect(rowN.push_notification_hour).toBeNull();

    // USER_NO_SUB has no subscription and must not appear at all.
    expect(res.rows.some((r) => r.user_id === USER_NO_SUB)).toBe(false);
  });
});

describe("get_push_due_cards - EXECUTE grants", () => {
  it("denies EXECUTE to anon and authenticated", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(
        queryAsRole(
          adminPool,
          role,
          `SELECT * FROM public.get_push_due_cards($1::uuid[], $2::date)`,
          [[USER_A], TODAY],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("allows EXECUTE to service_role", async () => {
    const res = await queryAsRole(
      adminPool,
      "service_role",
      `SELECT * FROM public.get_push_due_cards($1::uuid[], $2::date)`,
      [[USER_A], TODAY],
    );
    expect(res.rows.length).toBeGreaterThan(0);
  });
});

describe("get_push_due_cards - filtering and row shape", () => {
  it("returns only non-hidden rows due on or before today for the given users", async () => {
    const res = await queryAsRole(
      adminPool,
      "service_role",
      `SELECT * FROM public.get_push_due_cards($1::uuid[], $2::date)`,
      [[USER_A], TODAY],
    );

    expect(Object.keys(res.rows[0]).sort()).toEqual([
      "card_type",
      "due_date",
      "first_seen",
      "locale",
      "subject_key",
      "user_id",
    ]);

    const keys = res.rows.map((r) => r.subject_key).sort();
    // "1" (due yesterday), "2" (due today), "5" (due today, ja).
    // Excluded: "3" (due tomorrow), "4" (hidden), USER_NO_SUB's "9" (not in set).
    expect(keys).toEqual(["1", "2", "5"]);

    const byKey = new Map(res.rows.map((r) => [r.subject_key, r]));
    expect(byKey.get("2").first_seen).not.toBeNull();
    expect(pgDateToISO(byKey.get("2").first_seen as Date)).toBe(TODAY);
    expect(byKey.get("1").first_seen).toBeNull();
    expect(byKey.get("5").locale).toBe("ja");
    expect(byKey.get("1").card_type).toBe("name");
    expect(pgDateToISO(byKey.get("1").due_date as Date)).toBe("2026-06-14");
  });

  it("scopes strictly to the requested user set", async () => {
    const res = await queryAsRole(
      adminPool,
      "service_role",
      `SELECT * FROM public.get_push_due_cards($1::uuid[], $2::date)`,
      [[USER_A, USER_NO_SUB], TODAY],
    );
    const users = new Set(res.rows.map((r) => r.user_id));
    expect(users).toEqual(new Set([USER_A, USER_NO_SUB]));
    expect(res.rows).toHaveLength(4); // 3 for USER_A + 1 for USER_NO_SUB
  });

  it("returns no rows for an empty user set", async () => {
    const res = await queryAsRole(
      adminPool,
      "service_role",
      `SELECT * FROM public.get_push_due_cards($1::uuid[], $2::date)`,
      [[], TODAY],
    );
    expect(res.rows).toHaveLength(0);
  });
});
