/**
 * Cross-user isolation through the gateway (task 3.5, design D4/D5): the
 * replacement for Supabase RLS. Two users; Alice has rows in every gateway
 * table. Signed in as Bob, every table, operation and RPC is tried against
 * Alice's rows: unfiltered, with filters naming Alice, with rows carrying
 * Alice's id, and with upserts colliding with her keys. Bob must neither read
 * nor change anything of hers. Ported cases from the Postgres suite's
 * rls.test.ts and account-switch.test.ts are included.
 *
 * Proof the test is real: with the user pin removed from lib/db/scope.ts
 * (Compiler.where's `user_id = ?` and encodeRow's user_id), this file fails.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1, createTestUser, type SqliteD1 } from "./testing/sqliteD1";
import { createGatewayTestClient } from "./testing/gatewayClient";
import { handleGatewayRequest, type GatewayTable } from "./gateway";
import { forUser } from "./scope";
import type { DataClient } from "./client";

let d1: SqliteD1;
let alice: string;
let bob: string;
let asBob: DataClient;

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/alice-device";
const TODAY = new Date().toISOString().slice(0, 10);

const GATEWAY_TABLES: GatewayTable[] = ["card_reviews", "user_settings", "streak_days", "grade_log", "push_subscriptions"];

function seedAlice(): void {
  const s = d1.sqlite;
  s.prepare(
    `INSERT INTO card_reviews (user_id, card_type, subject_key, locale, due_date, last_review, first_seen, reps)
     VALUES (?, 'name', '25', 'en', ?, ?, ?, 7)`,
  ).run(alice, TODAY, TODAY, TODAY);
  s.prepare(`INSERT INTO user_settings (user_id, settings, timezone) VALUES (?, '{"maxNewPerDay":10}', 'Europe/London')`).run(alice);
  s.prepare(`INSERT INTO streak_days (id, user_id, review_date) VALUES ('streak-a', ?, ?)`).run(alice, TODAY);
  s.prepare(
    `INSERT INTO grade_log (id, user_id, occurred_at, entry_date, card_type, grade, subject_key) VALUES ('grade-a', ?, 1000, ?, 'name', 4, '25')`,
  ).run(alice, TODAY);
  s.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth_secret) VALUES ('push-a', ?, ?, 'k', 's')`,
  ).run(alice, ENDPOINT);
  s.prepare(`INSERT INTO feedback (id, user_id, category, message) VALUES ('fb-a', ?, 'bug', 'private')`).run(alice);
  s.prepare(`INSERT INTO feedback_discord_posts (feedback_id, discord_message_id) VALUES ('fb-a', 'msg-a')`).run();
}

/** Alice's rows, every table, as stored. */
function aliceSnapshot(): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const table of [...GATEWAY_TABLES, "feedback"]) {
    out[table] = d1.sqlite.prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY 1`).all(alice);
  }
  out.user = d1.sqlite.prepare(`SELECT * FROM "user" WHERE id = ?`).all(alice);
  out.feedback_discord_posts = d1.sqlite.prepare(`SELECT * FROM feedback_discord_posts`).all();
  return out;
}

let before: Record<string, unknown[]>;

beforeEach(() => {
  d1 = createSqliteD1();
  alice = createTestUser(d1);
  bob = createTestUser(d1);
  seedAlice();
  asBob = createGatewayTestClient(d1, bob);
  before = aliceSnapshot();
});

afterEach(() => {
  // Whatever Bob tried, Alice's rows are exactly as they were.
  expect(aliceSnapshot()).toEqual(before);
  d1.close();
});

const bobRequest = (q: Record<string, unknown>) => handleGatewayRequest(d1, bob, q);

describe.each(GATEWAY_TABLES)("%s: Bob cannot read Alice's rows", (table) => {
  it("an unfiltered select returns none of Alice's rows", async () => {
    const { data, error } = await asBob.from(table).select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("an exact count sees none of Alice's rows", async () => {
    const { count, error } = await asBob.from(table).select("*", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(count).toBe(0);
  });

  it("filters on Alice's other column values match nothing", async () => {
    const column = table === "user_settings" ? "timezone" : table === "push_subscriptions" ? "endpoint" : table === "streak_days" ? "review_date" : table === "grade_log" ? "occurred_at" : "subject_key";
    const value = (before[table][0] as Record<string, unknown>)[column];
    const { data } = await asBob.from(table).select("*").eq(column, value);
    expect(data).toEqual([]);
  });

  it.each([
    ["eq", { column: "user_id", op: "eq", value: "ALICE" }],
    ["in", { column: "user_id", op: "in", value: ["ALICE", "BOB"] }],
    ["neq", { column: "user_id", op: "neq", value: "BOB" }],
    ["is not null", { column: "user_id", op: "not-is", value: null }],
    ["gt", { column: "user_id", op: "gt", value: "" }],
  ])("a filter naming user_id (%s) is refused with 403", async (_name, filter) => {
    const f = JSON.parse(JSON.stringify(filter).replace("ALICE", alice).replace("BOB", bob));
    for (const q of [
      { kind: "select", table, filters: [f] },
      { kind: "select", table, filters: [f], count: "exact", head: true },
      { kind: "select", table, filters: [f], single: "maybe" },
    ]) {
      const result = await bobRequest(q);
      expect(result.status).toBe(403);
      expect(result.body.error?.code).toBe("42501");
      expect(result.body.data).toBeNull();
    }
  });

  it("the client's .eq('user_id', alice) gets 42501 and no data", async () => {
    const { data, error } = await asBob.from(table).select("*").eq("user_id", alice);
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });
});

describe("Bob cannot write Alice's rows", () => {
  it("card_reviews: an upsert carrying Alice's user_id is refused (403)", async () => {
    const { error } = await asBob.from("card_reviews").upsert(
      { user_id: alice, card_type: "name", subject_key: "25", locale: "en", due_date: TODAY, reps: 99 },
      { onConflict: "user_id,card_type,subject_key,locale" },
    );
    expect(error?.code).toBe("42501");
  });

  it("card_reviews: an upsert on Alice's key without a user_id makes Bob's own row", async () => {
    const { error } = await asBob
      .from("card_reviews")
      .upsert({ card_type: "name", subject_key: "25", locale: "en", due_date: TODAY, reps: 1 }, { onConflict: "user_id,card_type,subject_key,locale" });
    expect(error).toBeNull();
    expect(d1.sqlite.prepare("SELECT reps FROM card_reviews WHERE user_id = ?").all(bob)).toEqual([{ reps: 1 }]);
  });

  it("card_reviews: a batch mixing Bob's and Alice's rows is refused whole", async () => {
    const { error } = await asBob.from("card_reviews").upsert(
      [
        { user_id: bob, card_type: "name", subject_key: "1", locale: "en", due_date: TODAY },
        { user_id: alice, card_type: "name", subject_key: "25", locale: "en", due_date: TODAY, reps: 99 },
      ],
      { onConflict: "user_id,card_type,subject_key,locale" },
    );
    expect(error?.code).toBe("42501");
    expect(d1.sqlite.prepare("SELECT count(*) AS n FROM card_reviews WHERE user_id = ?").get(bob)).toEqual({ n: 0 });
  });

  it("card_reviews: onConflict without user_id is refused (42P10)", async () => {
    const { error } = await asBob
      .from("card_reviews")
      .upsert({ card_type: "name", subject_key: "25", locale: "en", due_date: TODAY }, { onConflict: "card_type,subject_key,locale" });
    expect(error?.code).toBe("42P10");
  });

  it("streak_days and grade_log: a row naming Alice's primary key id is refused (403)", async () => {
    const streak = await asBob.from("streak_days").upsert({ id: "streak-a", review_date: TODAY }, { onConflict: "user_id,review_date", ignoreDuplicates: true });
    expect(streak.error?.code).toBe("42501");
    const grade = await asBob
      .from("grade_log")
      .upsert({ id: "grade-a", occurred_at: 1000, entry_date: TODAY, card_type: "name", grade: 1, subject_key: "25" }, { onConflict: "user_id,occurred_at", ignoreDuplicates: true });
    expect(grade.error?.code).toBe("42501");
  });

  it("streak_days and grade_log: below the gateway, the scope helper turns an id collision into 23505, not an overwrite", async () => {
    const scoped = forUser(d1, bob);
    await expect(
      scoped.upsert("streak_days", { id: "streak-a", review_date: TODAY }, { onConflict: "user_id,review_date", ignoreDuplicates: true }),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      scoped.upsert(
        "grade_log",
        { id: "grade-a", occurred_at: 1000, entry_date: TODAY, card_type: "name", grade: 1, subject_key: "25" },
        { onConflict: "user_id,occurred_at" },
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("streak_days and grade_log: Bob's rows with Alice's dates and timestamps are his own", async () => {
    expect((await asBob.from("streak_days").upsert({ review_date: TODAY }, { onConflict: "user_id,review_date", ignoreDuplicates: true })).error).toBeNull();
    expect(
      (await asBob.from("grade_log").upsert({ occurred_at: 1000, entry_date: TODAY, card_type: "name", grade: 2, subject_key: "25" }, { onConflict: "user_id,occurred_at", ignoreDuplicates: true })).error,
    ).toBeNull();
    expect(d1.sqlite.prepare("SELECT count(*) AS n FROM grade_log WHERE user_id = ?").get(bob)).toEqual({ n: 1 });
  });

  it("push_subscriptions: inserting with Alice's user_id or id is refused; Alice's endpoint becomes Bob's own row", async () => {
    const row = { endpoint: ENDPOINT, p256dh: "k2", auth_secret: "s2", last_seen_at: new Date().toISOString() };
    expect((await asBob.from("push_subscriptions").insert({ ...row, user_id: alice })).error?.code).toBe("42501");
    expect((await asBob.from("push_subscriptions").insert({ ...row, id: "push-a" })).error?.code).toBe("42501");
    expect((await asBob.from("push_subscriptions").insert(row)).error).toBeNull();
    expect(d1.sqlite.prepare("SELECT endpoint FROM push_subscriptions WHERE user_id = ?").all(bob)).toEqual([{ endpoint: ENDPOINT }]);
  });

  it("user_settings: an update filtered to Alice or setting user_id to Alice is refused", async () => {
    expect((await asBob.from("user_settings").update({ timezone: "UTC" }).eq("user_id", alice)).error?.code).toBe("42501");
    expect((await asBob.from("user_settings").update({ timezone: "UTC", user_id: alice })).error?.code).toBe("42501");
  });

  it("user_settings: an unfiltered update changes only Bob's row (none here)", async () => {
    expect((await asBob.from("user_settings").update({ timezone: "UTC" })).error).toBeNull();
  });

  it("user_settings: settings and last_reset_at cannot be written directly (only through the RPCs)", async () => {
    expect((await asBob.from("user_settings").update({ settings: {} })).error?.code).toBe("42501");
    expect((await asBob.from("user_settings").update({ last_reset_at: null })).error?.code).toBe("42501");
  });

  it("push_subscriptions: a delete filtered to Alice is refused; an unfiltered delete removes only Bob's rows", async () => {
    expect((await asBob.from("push_subscriptions").delete().eq("user_id", alice)).error?.code).toBe("42501");
    expect((await asBob.from("push_subscriptions").delete().eq("endpoint", ENDPOINT)).error).toBeNull();
    expect((await asBob.from("push_subscriptions").delete()).error).toBeNull();
  });

  it.each([
    ["card_reviews", "update", { kind: "update", table: "card_reviews", values: { reps: 0 } }],
    ["card_reviews", "delete", { kind: "delete", table: "card_reviews" }],
    ["streak_days", "delete", { kind: "delete", table: "streak_days" }],
    ["grade_log", "update", { kind: "update", table: "grade_log", values: { grade: 1 } }],
    ["grade_log", "delete", { kind: "delete", table: "grade_log" }],
    ["user_settings", "delete", { kind: "delete", table: "user_settings" }],
    ["user_settings", "upsert", { kind: "upsert", table: "user_settings", rows: { settings: {} } }],
    ["push_subscriptions", "update", { kind: "update", table: "push_subscriptions", values: { p256dh: "x" } }],
  ])("%s %s is not open to the browser (403)", async (_t, _op, q) => {
    const result = await bobRequest(q);
    expect(result.status).toBe(403);
    expect(result.body.error?.code).toBe("42501");
  });
});

describe("RPCs only ever act on the session user", () => {
  it("merge_user_settings naming Alice is refused (403)", async () => {
    const result = await bobRequest({ kind: "rpc", name: "merge_user_settings", args: { p_user_id: alice, p_patch: { maxNewPerDay: 1 } } });
    expect(result.status).toBe(403);
    expect(result.body.error?.code).toBe("42501");
  });

  it("merge_user_settings without an id merges into Bob's row only", async () => {
    expect((await asBob.rpc("merge_user_settings", { p_patch: { maxNewPerDay: 1 } })).error).toBeNull();
    expect(d1.sqlite.prepare("SELECT settings FROM user_settings WHERE user_id = ?").get(bob)).toEqual({ settings: '{"maxNewPerDay":1}' });
  });

  it("reset_all_progress clears only Bob's progress", async () => {
    expect((await asBob.rpc("reset_all_progress")).error).toBeNull();
  });

  it("reset_all_progress and delete_account refuse arguments (no way to name a user)", async () => {
    for (const name of ["reset_all_progress", "delete_account"]) {
      const result = await bobRequest({ kind: "rpc", name, args: { p_user_id: alice } });
      expect(result.status).toBe(400);
    }
  });

  it("delete_account removes Bob only, and returns only Bob's Discord posts", async () => {
    d1.sqlite.prepare(`INSERT INTO feedback (id, user_id, category, message) VALUES ('fb-b', ?, 'bug', 'mine')`).run(bob);
    d1.sqlite.prepare(`INSERT INTO feedback_discord_posts (feedback_id, discord_message_id) VALUES ('fb-b', 'msg-b')`).run();
    const result = await bobRequest({ kind: "rpc", name: "delete_account" });
    expect(result.status).toBe(200);
    expect(result.discordPostsToDelete).toEqual([{ feedbackId: "fb-b", discordMessageId: "msg-b" }]);
    expect(d1.sqlite.prepare(`SELECT count(*) AS n FROM "user" WHERE id = ?`).get(bob)).toEqual({ n: 0 });
    // Keep Alice's snapshot equal: Bob's post row stays for the Discord side to remove.
    d1.sqlite.prepare(`DELETE FROM feedback_discord_posts WHERE feedback_id = 'fb-b'`).run();
  });
});

describe("tables and functions outside the gateway", () => {
  it.each(["feedback", "feedback_discord_posts", "rate_limit_buckets", "user", "session", "account", "verification", "sqlite_master"])(
    "%s is not available (400, 42P01)",
    async (table) => {
      for (const q of [
        { kind: "select", table },
        { kind: "delete", table },
        { kind: "insert", table, rows: { user_id: bob } },
      ]) {
        const result = await bobRequest(q);
        expect(result.status).toBe(400);
        expect(result.body.error?.code).toBe("42P01");
      }
    },
  );

  it.each(["get_push_targets", "get_push_due_cards", "reconcile_grade_log_orphans", "check_rate_limit", "jsonb_deep_merge"])(
    "rpc %s is not available (400, 42883)",
    async (name) => {
      const result = await bobRequest({ kind: "rpc", name, args: {} });
      expect(result.status).toBe(400);
      expect(result.body.error?.code).toBe("42883");
    },
  );
});
