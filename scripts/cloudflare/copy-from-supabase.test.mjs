/**
 * Tests for scripts/cloudflare/copy-from-supabase.mjs and compare-counts.mjs (task 8.3, design
 * D12): a fixture in the `supabase db dump --data-only` format (invented people only) is converted,
 * loaded into a migrated node:sqlite D1 stand-in, and checked row for row.
 */

import bcrypt from "bcryptjs";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { TABLES } from "../../lib/db/tables";
import { createSqliteD1 } from "../../lib/db/testing/sqliteD1";
import { USERNAME_PATTERN } from "../../lib/auth/username";
import { KNOWN_PUSH_ENDPOINT_PATTERN as APP_PUSH_PATTERN } from "../../lib/push/endpoints";
import { compareCounts, countsQuery } from "./compare-counts.mjs";
import {
  APP_TABLES,
  KNOWN_PUSH_ENDPOINT_PATTERN,
  convert,
  migrationTriggers,
  parseDump,
  readPostgres,
  toIsoTimestamp,
} from "./copy-from-supabase.mjs";

// Invented ids and people.
const ASH = "11111111-1111-4111-8111-111111111111"; // username + password
const MISTY = "22222222-2222-4222-8222-222222222222"; // GitHub
const BROCK = "33333333-3333-4333-8333-333333333333"; // Google
const JESSIE = "44444444-4444-4444-8444-444444444444"; // email + password, unconfirmed, quote in name
const PASSWORD = "invented-test-password";
let HASH = "";

function pushRows() {
  const rows = [];
  for (let k = 0; k < 11; k++) {
    const minute = String(k).padStart(2, "0");
    rows.push(
      `\t('aaaaaaaa-0000-4000-8000-0000000000${minute}', '${ASH}', 'https://fcm.googleapis.com/fcm/send/invented-${k}', 'p256dh-${k}', 'auth-${k}', '2026-03-01 09:${minute}:00.5+00', '2026-03-02 09:${minute}:00.123456+00')`,
    );
  }
  rows.push(
    `\t('aaaaaaaa-0000-4000-8000-0000000000ff', '${MISTY}', 'https://push.invalid.example/send/1', 'p', 'a', '2026-03-01 09:00:00+00', '2026-03-01 09:00:00+00')`,
  );
  return rows.join(",\n");
}

function authDump() {
  return `--
-- PostgreSQL database dump
--
SET statement_timeout = 0;
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET session_replication_role = replica;

--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."users" ("instance_id", "id", "aud", "role", "email", "encrypted_password", "email_confirmed_at", "raw_app_meta_data", "raw_user_meta_data", "created_at", "updated_at", "is_anonymous") VALUES
\t('00000000-0000-0000-0000-000000000000', '${ASH}', 'authenticated', 'authenticated', 'ash-ketchum@users.noreply.pokememory.internal', '${HASH}', '2025-06-01 10:00:00.123456+00', '{"provider": "email", "providers": ["email"]}', '{"username": "ash-ketchum", "email_verified": true}', '2025-06-01 10:00:00.111111+00', '2026-11-18 08:30:00.999+00', false),
\t('00000000-0000-0000-0000-000000000000', '${MISTY}', 'authenticated', 'authenticated', 'misty@example.test', '', '2025-07-01 10:00:00+00', '{"provider": "github"}', '{"full_name": "Misty Waterflower", "user_name": "misty", "avatar_url": "https://avatars.example.test/u/2"}', '2025-07-01 10:00:00+00', '2025-07-02 10:00:00+00', false),
\t('00000000-0000-0000-0000-000000000000', '${BROCK}', 'authenticated', 'authenticated', 'brock@example.test', NULL, '2025-08-01 10:00:00+00', '{"provider": "google"}', '{"name": "Brock Harrison"}', '2025-08-01 10:00:00+01', '2025-08-01 10:00:00+01', false),
\t('00000000-0000-0000-0000-000000000000', '${JESSIE}', 'authenticated', 'authenticated', 'jessie@example.test', '${HASH}', NULL, '{"provider": "email"}', '{"full_name": "Jessie O''Hara"}', '2025-09-01 10:00:00+00', '2025-09-01 10:00:00+00', false);

--
-- Data for Name: identities; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."identities" ("provider_id", "user_id", "identity_data", "provider", "last_sign_in_at", "created_at", "updated_at", "id") VALUES
\t('${ASH}', '${ASH}', '{"sub": "${ASH}"}', 'email', '2025-06-01 10:00:00+00', '2025-06-01 10:00:00+00', '2025-06-01 10:00:00+00', '55555555-5555-4555-8555-555555555551'),
\t('424242', '${MISTY}', '{"sub": "424242", "user_name": "misty"}', 'github', '2025-07-01 10:00:00+00', '2025-07-01 10:00:00.25+00', '2025-07-01 10:00:00.25+00', '55555555-5555-4555-8555-555555555552'),
\t('109876543210987654321', '${BROCK}', '{"sub": "109876543210987654321"}', 'google', NULL, '2025-08-01 10:00:00+00', '2025-08-01 10:00:00+00', '55555555-5555-4555-8555-555555555553');

--
-- Data for Name: sessions; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."sessions" ("id", "user_id", "created_at") VALUES
\t('66666666-6666-4666-8666-666666666666', '${ASH}', '2026-11-18 08:30:00+00');

RESET ALL;
`;
}

function publicDump() {
  return `SET standard_conforming_strings = on;
SET session_replication_role = replica;

INSERT INTO "public"."usernames" ("username", "user_id") VALUES
\t('ash-ketchum', '${ASH}');

INSERT INTO "public"."user_settings" ("user_id", "settings", "updated_at", "timezone", "date_format", "last_reset_at", "push_notification_hour") VALUES
\t('${ASH}', '{"note": "it''s; fine -- really", "theme": "dark", "nested": {"a": null, "b": [1, 2.5e-7, true]}, "emoji": "ピカチュウ"}', '2026-11-19 10:00:00.123456+00', 'Europe/London', 'dmy', '2026-01-01 00:00:00+00', 8),
\t('${MISTY}', 'null', '2026-11-19 10:00:00+00', NULL, NULL, NULL, NULL);

INSERT INTO "public"."card_reviews" ("id", "user_id", "card_type", "subject_key", "locale", "due_date", "last_review", "first_seen", "updated_at", "stability", "difficulty", "elapsed_days", "scheduled_days", "reps", "lapses", "fsrs_state", "hidden_since", "seen_in_pasture") VALUES
\t('77777777-7777-4777-8777-777777777771', '${ASH}', 'name', '25', 'en', '2026-11-20', '2025-12-01', '2025-11-01', '2026-11-19 09:00:00.654321+00', 3.14159265358979323846, 5, 1, 4, 7, 1, 'review', NULL, true),
\t('77777777-7777-4777-8777-777777777772', '${ASH}', 'name', '133', 'ja', '2026-11-21', NULL, NULL, '2026-11-19 09:00:00+00', 0, 0, 0, 0, 0, 0, 'new', '2026-02-01', false),
\t('77777777-7777-4777-8777-777777777773', '${ASH}', 'name', '1', 'en', '2026-11-21', NULL, NULL, '2026-11-19 09:00:00+00', 'NaN', 0, 0, 0, 0, 0, 'new', NULL, false);

INSERT INTO "public"."streak_days" ("id", "user_id", "review_date") VALUES
\t('88888888-8888-4888-8888-888888888881', '${ASH}', '2025-12-01'),
\t('88888888-8888-4888-8888-888888888882', '${ASH}', '2099-01-01');

INSERT INTO "public"."grade_log" ("id", "user_id", "occurred_at", "entry_date", "card_type", "grade", "subject_key", "locale", "learning_step", "step_started_at") VALUES
\t('99999999-9999-4999-8999-999999999991', '${ASH}', 1763546400123, '2025-11-19', 'name', 4, '25', 'en', NULL, NULL),
\t('99999999-9999-4999-8999-999999999992', '${ASH}', 9007199254740993, '2026-11-19', 'name', 1, '25', 'en', 0, 1763546400000);

INSERT INTO "public"."push_subscriptions" ("id", "user_id", "endpoint", "p256dh", "auth_secret", "created_at", "last_seen_at") VALUES
${pushRows()};

INSERT INTO "public"."feedback" ("id", "user_id", "category", "message", "page", "app_version", "created_at") VALUES
\t('bbbbbbbb-0000-4000-8000-000000000001', NULL, 'bug', 'Guest says:
line two; with ''quotes''', '/', '1.2.3', '2026-10-01 12:00:00+00'),
\t('bbbbbbbb-0000-4000-8000-000000000002', '${JESSIE}', 'feature', 'More cards', NULL, NULL, '2026-10-02 12:00:00+00');

INSERT INTO "public"."feedback_discord_posts" ("feedback_id", "discord_message_id", "created_at") VALUES
\t('bbbbbbbb-0000-4000-8000-000000000001', '1234567890123456789', '2026-10-01 12:00:01+00');

INSERT INTO "public"."rate_limit_buckets" ("id", "ip_hash", "action", "attempted_at") VALUES
\t('cccccccc-0000-4000-8000-000000000001', '${"a".repeat(64)}', 'signin', '2026-11-19 10:00:00+00'),
\t('cccccccc-0000-4000-8000-000000000002', '${"b".repeat(64)}', 'signup', '2026-11-19 10:00:00+00');

SELECT pg_catalog.setval('"public"."some_seq"', 1, false);
RESET ALL;
`;
}

function fixtureSource() {
  const tables = parseDump(authDump());
  return parseDump(publicDump(), tables);
}

const triggerSql = (d1) =>
  d1.sqlite
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
    .all()
    .map((r) => ({ ...r }));

const open = [];
function freshD1() {
  const d1 = createSqliteD1();
  open.push(d1);
  return d1;
}
afterEach(() => {
  while (open.length) open.pop().close();
});

beforeAll(async () => {
  HASH = await bcrypt.hash(PASSWORD, 4);
});

describe("parseDump", () => {
  it("reads INSERT rows as Postgres text values and skips other statements", () => {
    const src = fixtureSource();
    expect(src.get("auth.users")).toHaveLength(4);
    expect(src.get("public.push_subscriptions")).toHaveLength(12);
    expect(src.get("public.feedback")[0].message).toBe("Guest says:\nline two; with 'quotes'");
    expect(src.get("public.card_reviews")[0].seen_in_pasture).toBe("true");
    expect(src.get("public.card_reviews")[0].stability).toBe("3.14159265358979323846");
    expect(src.get("public.card_reviews")[2].stability).toBe("NaN");
    expect(src.get("public.user_settings")[1].timezone).toBeNull();
  });

  it("reads E'' strings with backslash escapes", () => {
    const src = parseDump(`INSERT INTO "public"."feedback" ("message") VALUES (E'a\\nb\\'c\\\\');`);
    expect(src.get("public.feedback")[0].message).toBe("a\nb'c\\");
  });

  it("reports a position, never row contents, on bad input", () => {
    expect(() => parseDump(`INSERT INTO "public"."feedback" ("message") VALUES ('secret-text', );`)).toThrow(
      /^Dump parse error at offset \d+/,
    );
    try {
      parseDump(`INSERT INTO "public"."feedback" ("message") VALUES (secret_word);`);
    } catch (err) {
      expect(String(err)).not.toContain("secret");
    }
  });
});

describe("toIsoTimestamp", () => {
  it("converts timestamptz text to ISO UTC with milliseconds", () => {
    expect(toIsoTimestamp("2026-11-19 10:00:00.123456+00")).toBe("2026-11-19T10:00:00.123Z");
    expect(toIsoTimestamp("2026-11-19 10:00:00+00")).toBe("2026-11-19T10:00:00.000Z");
    expect(toIsoTimestamp("2026-11-19 10:00:00.5+05:30")).toBe("2026-11-19T04:30:00.500Z");
    expect(toIsoTimestamp("2026-11-19 00:30:00-01")).toBe("2026-11-19T01:30:00.000Z");
    expect(() => toIsoTimestamp("infinity")).toThrow();
  });
});

describe("convert and import", () => {
  function imported() {
    const { sql, manifest } = convert(fixtureSource());
    const d1 = freshD1();
    const before = triggerSql(d1);
    d1.sqlite.exec(sql);
    return { d1, sql, manifest, before };
  }
  const all = (d1, q, ...p) => d1.sqlite.prepare(q).all(...p).map((r) => ({ ...r }));
  const count = (d1, table) => Number(d1.sqlite.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n);

  it("writes every row, and the counts match the manifest", () => {
    const { d1, manifest } = imported();
    const target = d1.sqlite.prepare(countsQuery(manifest.tables.map((t) => t.table))).get();
    expect(target).toEqual({
      user: 4,
      account: 4, // github, google, two credential accounts
      user_settings: 2,
      card_reviews: 2,
      streak_days: 2,
      grade_log: 2,
      push_subscriptions: 11,
      feedback: 2,
      feedback_discord_posts: 1,
      rate_limit_buckets: 0,
    });
    const result = compareCounts(manifest, target);
    expect(result.ok).toBe(true);
    const byTable = Object.fromEntries(manifest.tables.map((t) => [t.table, t]));
    expect(byTable.push_subscriptions.skipped).toEqual({ "endpoint host outside the known-host CHECK": 1 });
    expect(byTable.card_reviews.skipped).toEqual({ "non-finite number in a REAL column": 1 });
    expect(byTable.account.skipped).toEqual({ "email identity (the credential account covers it)": 1 });
    expect(byTable.rate_limit_buckets).toMatchObject({ source: 2, expected: 0 });
    expect(count(d1, "session")).toBe(0);
    expect(count(d1, "verification")).toBe(0);
  });

  it("maps auth.users to Better Auth users with the same ids", () => {
    const { d1 } = imported();
    const users = Object.fromEntries(all(d1, `SELECT * FROM "user"`).map((u) => [u.id, u]));
    expect(users[ASH]).toMatchObject({
      email: "ash-ketchum@users.noreply.pokememory.internal",
      name: "ash-ketchum",
      emailVerified: 1,
      username: "ash-ketchum",
      displayUsername: "ash-ketchum",
      createdAt: "2025-06-01T10:00:00.111Z",
      updatedAt: "2026-11-18T08:30:00.999Z",
      image: null,
    });
    expect(users[MISTY]).toMatchObject({
      name: "Misty Waterflower",
      image: "https://avatars.example.test/u/2",
      username: null,
      // The GitHub login, for the Journey trainer card handle (Better Auth does not store it).
      displayUsername: "misty",
    });
    expect(users[BROCK]).toMatchObject({
      name: "Brock Harrison",
      createdAt: "2025-08-01T09:00:00.000Z",
      displayUsername: null,
    });
    expect(users[JESSIE]).toMatchObject({ name: "Jessie O'Hara", emailVerified: 0 });
  });

  it("writes github and google accounts by provider user id and bcrypt credential accounts", () => {
    const { d1 } = imported();
    const accounts = all(d1, `SELECT * FROM account ORDER BY providerId, userId`);
    expect(accounts.filter((a) => a.providerId === "github")).toEqual([
      expect.objectContaining({ accountId: "424242", userId: MISTY, password: null, createdAt: "2025-07-01T10:00:00.250Z" }),
    ]);
    expect(accounts.filter((a) => a.providerId === "google")).toEqual([
      expect.objectContaining({ accountId: "109876543210987654321", userId: BROCK }),
    ]);
    const credentials = accounts.filter((a) => a.providerId === "credential");
    expect(credentials.map((a) => a.userId).sort()).toEqual([ASH, JESSIE]);
    for (const a of credentials) {
      expect(a.accountId).toBe(a.userId);
      expect(a.password).toBe(HASH);
      expect(bcrypt.compareSync(PASSWORD, a.password)).toBe(true);
    }
  });

  it("keeps timestamps, booleans, JSON, numbers and dates exactly", () => {
    const { d1 } = imported();
    const [settings] = all(d1, `SELECT * FROM user_settings WHERE user_id = ?`, ASH);
    expect(settings.updated_at).toBe("2026-11-19T10:00:00.123Z");
    expect(settings.last_reset_at).toBe("2026-01-01T00:00:00.000Z");
    expect(JSON.parse(settings.settings)).toEqual({
      note: "it's; fine -- really",
      theme: "dark",
      nested: { a: null, b: [1, 2.5e-7, true] },
      emoji: "ピカチュウ",
    });
    const [nullSettings] = all(d1, `SELECT settings, timezone FROM user_settings WHERE user_id = ?`, MISTY);
    expect(nullSettings).toEqual({ settings: "null", timezone: null });

    const cards = all(d1, `SELECT * FROM card_reviews ORDER BY subject_key`);
    const card25 = cards.find((c) => c.subject_key === "25");
    expect(card25).toMatchObject({
      stability: Number("3.14159265358979323846"),
      difficulty: 5,
      seen_in_pasture: 1,
      updated_at: "2026-11-19T09:00:00.654Z",
      first_seen: "2025-11-01", // before last_reset_at: the tombstone trigger would have refused it
      last_review: "2025-12-01",
    });
    expect(typeof card25.difficulty).toBe("number");
    expect(cards.find((c) => c.subject_key === "133")).toMatchObject({ seen_in_pasture: 0, hidden_since: "2026-02-01", locale: "ja" });

    expect(all(d1, `SELECT review_date FROM streak_days ORDER BY review_date`).map((r) => r.review_date)).toEqual([
      "2025-12-01",
      "2099-01-01",
    ]);
    const grades = all(d1, `SELECT occurred_at, learning_step FROM grade_log WHERE entry_date = '2025-11-19'`);
    expect(grades).toEqual([{ occurred_at: 1763546400123, learning_step: null }]);
    // bigint beyond 2^53 survives as SQLite INTEGER (read back as BigInt to check the exact digits).
    const big = d1.sqlite.prepare(`SELECT occurred_at FROM grade_log WHERE entry_date = '2026-11-19'`);
    big.setReadBigInts(true);
    expect(big.get().occurred_at).toBe(9007199254740993n);

    const [guest] = all(d1, `SELECT * FROM feedback WHERE user_id IS NULL`);
    expect(guest.message).toBe("Guest says:\nline two; with 'quotes'");
    expect(all(d1, `SELECT * FROM feedback_discord_posts`)[0]).toEqual({
      feedback_id: "bbbbbbbb-0000-4000-8000-000000000001",
      discord_message_id: "1234567890123456789",
      created_at: "2026-10-01T12:00:01.000Z",
    });
  });

  it("keeps all 11 push rows and their last_seen_at (the cap and stamp triggers are bypassed)", () => {
    const { d1 } = imported();
    const rows = all(d1, `SELECT id, created_at, last_seen_at FROM push_subscriptions ORDER BY id`);
    expect(rows).toHaveLength(11);
    expect(rows[0]).toEqual({
      id: "aaaaaaaa-0000-4000-8000-000000000000",
      created_at: "2026-03-01T09:00:00.500Z",
      last_seen_at: "2026-03-02T09:00:00.123Z",
    });
    expect(rows[10].last_seen_at).toBe("2026-03-02T09:10:00.123Z");
  });

  it("recreates every trigger verbatim, and they work again after the import", () => {
    const { d1, before } = imported();
    expect(before.length).toBeGreaterThan(0);
    expect(triggerSql(d1)).toEqual(before);
    // The push cap is live again: one more insert trims the user to 10.
    d1.sqlite.exec(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth_secret) VALUES ('dddddddd-0000-4000-8000-000000000001', '${ASH}', 'https://fcm.googleapis.com/fcm/send/new', 'p', 'a')`,
    );
    expect(count(d1, "push_subscriptions")).toBe(10);
    // And the tombstone refuses a pre-reset row.
    expect(() =>
      d1.sqlite.exec(`INSERT INTO streak_days (user_id, review_date) VALUES ('${ASH}', '2025-06-01')`),
    ).toThrow(/check_violation/);
  });

  it("refuses to run on a target that already has rows, changing nothing", () => {
    const { d1, sql, before } = imported();
    expect(() => d1.sqlite.exec(sql)).toThrow(/CHECK constraint failed/);
    expect(triggerSql(d1)).toEqual(before);
    expect(count(d1, "user")).toBe(4);
  });

  it("lets Better Auth find the copied users: username + bcrypt password, and the GitHub account", async () => {
    // lib/auth/server.ts is not in this branch's base; this mirrors its D1 + username + bcrypt
    // verify setup (design D6) with the library's own queries over the imported database.
    const { d1 } = imported();
    const auth = betterAuth({
      database: d1.sqlite,
      secret: "test-secret-not-real-0123456789abcdef",
      baseURL: "http://localhost:3000",
      emailAndPassword: {
        enabled: true,
        password: {
          hash: async (p) => bcrypt.hash(p, 4),
          verify: async ({ hash, password }) => bcrypt.compare(password, hash),
        },
      },
      plugins: [
        username({
          minUsernameLength: 3,
          maxUsernameLength: 30,
          usernameValidator: (value) => USERNAME_PATTERN.test(value.toLowerCase()),
        }),
      ],
    });
    const res = await auth.api.signInUsername({ body: { username: "ash-ketchum", password: PASSWORD } });
    expect(res?.user?.id).toBe(ASH);
    const byEmail = await auth.api.signInEmail({ body: { email: "jessie@example.test", password: PASSWORD } });
    expect(byEmail.user.id).toBe(JESSIE);
    const ctx = await auth.$context;
    const github = await ctx.internalAdapter.findAccountOwnerByKey({ providerId: "github", accountId: "424242" });
    expect(github).toMatchObject({ kind: "owned", user: { id: MISTY } });
    const google = await ctx.internalAdapter.findAccountOwnerByKey({ providerId: "google", accountId: "109876543210987654321" });
    expect(google).toMatchObject({ kind: "owned", user: { id: BROCK } });
    expect((await ctx.internalAdapter.findCredentialAccount(JESSIE))?.password).toBe(HASH);
  });
});

describe("guards against drift", () => {
  it("fails on a public table it does not know", () => {
    const src = fixtureSource();
    src.set("public.mystery", [{ id: "x" }]);
    expect(() => convert(src)).toThrow(/Unknown public tables in the source.*public\.mystery/);
  });

  it("fails when a source table's columns differ from D1", () => {
    const src = fixtureSource();
    src.get("public.streak_days")[0].extra_column = "1";
    expect(() => convert(src)).toThrow(/public\.streak_days columns differ from D1: extra \[extra_column\]/);
  });

  it("APP_TABLES matches lib/db/tables.ts and the D1 schema's columns", () => {
    const d1 = freshD1();
    for (const [table, types] of Object.entries(APP_TABLES)) {
      if (table in TABLES) expect(types).toEqual(TABLES[table].columns);
      const cols = d1.sqlite.prepare(`SELECT name FROM pragma_table_info(?)`).all(table).map((r) => r.name);
      expect(Object.keys(types).sort()).toEqual(cols.sort());
    }
    expect(Object.keys(APP_TABLES).filter((t) => t in TABLES).sort()).toEqual(Object.keys(TABLES).sort());
  });

  it("uses the app's known push host pattern", () => {
    expect(KNOWN_PUSH_ENDPOINT_PATTERN).toBe(APP_PUSH_PATTERN);
  });

  it("finds every trigger in the migrations", () => {
    const d1 = freshD1();
    expect(migrationTriggers().map(([name]) => name).sort()).toEqual(triggerSql(d1).map((t) => t.name).sort());
  });
});

describe("readPostgres", () => {
  it("reads in a read-only transaction and rolls back", async () => {
    const calls = [];
    const client = {
      async query(sql) {
        calls.push(sql);
        if (sql.includes("information_schema")) {
          return { rows: [{ name: "auth.users" }, { name: "public.streak_days" }, { name: "public.mystery" }] };
        }
        if (sql.includes(`"auth"."users"`)) return { rows: [{ id: ASH }] };
        if (sql.includes(`"public"."streak_days"`)) return { rows: [] };
        return { rows: [] };
      },
    };
    const tables = await readPostgres(client);
    expect(calls[0]).toBe("BEGIN TRANSACTION READ ONLY");
    expect(calls.at(-1)).toBe("ROLLBACK");
    expect(calls.some((c) => /\b(insert|update|delete|alter|drop)\b/i.test(c))).toBe(false);
    expect(tables.get("auth.users")).toEqual([{ id: ASH }]);
    expect(tables.has("public.mystery")).toBe(true); // so convert() refuses the unknown table
  });
});

describe("compareCounts", () => {
  const manifest = {
    tables: [
      { table: "user", source: 3, expected: 3, skipped: {} },
      { table: "push_subscriptions", source: 5, expected: 4, skipped: { "unknown host": 1 } },
    ],
  };

  it("passes when target matches and skips explain the gap", () => {
    expect(compareCounts(manifest, { user: 3, push_subscriptions: 4 }).ok).toBe(true);
  });

  it("fails on a target difference or a missing count", () => {
    expect(compareCounts(manifest, { user: 2, push_subscriptions: 4 }).ok).toBe(false);
    expect(compareCounts(manifest, { user: 3 }).ok).toBe(false);
  });

  it("fails when skips do not explain the source count", () => {
    const bad = { tables: [{ table: "user", source: 4, expected: 3, skipped: {} }] };
    expect(compareCounts(bad, { user: 3 }).ok).toBe(false);
  });

  it("builds one read-only count query", () => {
    expect(countsQuery(["user", "feedback"])).toBe(
      `SELECT (SELECT count(*) FROM "user") AS "user", (SELECT count(*) FROM "feedback") AS "feedback"`,
    );
  });
});
