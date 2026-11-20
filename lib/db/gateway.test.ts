/**
 * The gateway's wire-format validation and status mapping (lib/db/gateway.ts).
 * Behaviour through the real client is in clientGateway.test.ts; isolation
 * between users in crossUser.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1, createTestUser, type SqliteD1 } from "./testing/sqliteD1";
import { handleGatewayRequest, MAX_IN_VALUES, MAX_SELECT_ROWS, MAX_WRITE_ROWS } from "./gateway";

let d1: SqliteD1;
let alice: string;
const run = (q: unknown) => handleGatewayRequest(d1, alice, q);
const TODAY = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  d1 = createSqliteD1();
  alice = createTestUser(d1);
});
afterEach(() => d1.close());

function expectBad(result: Awaited<ReturnType<typeof run>>, code: string, status = 400): void {
  expect(result.status).toBe(status);
  expect(result.body.data).toBeNull();
  expect(result.body.error?.code).toBe(code);
}

describe("malformed requests are 400 before anything runs", () => {
  it.each([
    ["not an object", [1, 2]],
    ["null", null],
    ["unknown kind", { kind: "drop", table: "card_reviews" }],
    ["unknown top-level key", { kind: "select", table: "card_reviews", sql: "x" }],
    ["unknown filter key", { kind: "select", table: "card_reviews", filters: [{ column: "locale", op: "eq", value: "en", raw: 1 }] }],
    ["filter without a value", { kind: "select", table: "card_reviews", filters: [{ column: "locale", op: "eq" }] }],
    ["range the wrong way round", { kind: "select", table: "card_reviews", range: [5, 1] }],
    ["range too wide", { kind: "select", table: "card_reviews", range: [0, MAX_SELECT_ROWS] }],
    ["limit too large", { kind: "select", table: "card_reviews", limit: MAX_SELECT_ROWS + 1 }],
    ["negative limit", { kind: "select", table: "card_reviews", limit: -1 }],
    ["count other than exact", { kind: "select", table: "card_reviews", count: "planned" }],
    ["head not a boolean", { kind: "select", table: "card_reviews", head: "yes" }],
    ["too many in values", { kind: "select", table: "card_reviews", filters: [{ column: "locale", op: "in", value: Array(MAX_IN_VALUES + 1).fill("en") }] }],
    ["no rows", { kind: "upsert", table: "streak_days", rows: [] }],
    ["too many rows", { kind: "upsert", table: "streak_days", rows: Array(MAX_WRITE_ROWS + 1).fill({ review_date: TODAY }) }],
    ["a row that is not an object", { kind: "upsert", table: "streak_days", rows: ["2026-01-01"] }],
    ["update with a list of values", { kind: "update", table: "user_settings", values: [{ timezone: "UTC" }] }],
    ["rpc args not an object", { kind: "rpc", name: "reset_all_progress", args: [1] }],
    ["rpc unknown argument", { kind: "rpc", name: "merge_user_settings", args: { p_patch: {}, p_extra: 1 } }],
  ])("%s", async (_name, q) => {
    expectBad(await run(q), "42601");
  });

  it("an unknown table is 42P01, column 42703, operator and function 42883", async () => {
    expectBad(await run({ kind: "select", table: "cards" }), "42P01");
    expectBad(await run({ kind: "select", table: "card_reviews", columns: ["nope"] }), "42703");
    expectBad(await run({ kind: "select", table: "card_reviews", order: [{ column: "nope" }] }), "42703");
    expectBad(await run({ kind: "select", table: "card_reviews", filters: [{ column: "locale", op: "like", value: "%" }] }), "42883");
    expectBad(await run({ kind: "select", table: "card_reviews", filters: [{ column: "locale", op: "not-eq", value: "en" }] }), "42883");
    expectBad(await run({ kind: "rpc", name: "pg_sleep" }), "42883");
  });

  it("a value of the wrong type is 22P02 and a json-column comparison 42883", async () => {
    expectBad(await run({ kind: "select", table: "card_reviews", filters: [{ column: "reps", op: "eq", value: "many" }] }), "22P02");
    expectBad(await run({ kind: "select", table: "user_settings", filters: [{ column: "settings", op: "eq", value: "{}" }] }), "42883");
    expectBad(await run({ kind: "rpc", name: "merge_user_settings", args: { p_patch: [1] } }), "22P02");
  });

  it("an identifier is never interpolated: a column name with SQL in it is just unknown", async () => {
    expectBad(await run({ kind: "select", table: "card_reviews", columns: ['reps" FROM "user" --'] }), "42703");
    expectBad(await run({ kind: "select", table: 'card_reviews"; DROP TABLE card_reviews; --' }), "42P01");
  });
});

describe("selects", () => {
  beforeEach(async () => {
    const rows = ["1", "2", "3"].map((k) => ({ card_type: "name", subject_key: k, locale: "en", due_date: TODAY, reps: Number(k) }));
    expect((await run({ kind: "upsert", table: "card_reviews", rows, onConflict: "user_id,card_type,subject_key,locale" })).status).toBe(200);
  });

  it("columns, filters, order, range and count", async () => {
    const result = await run({
      kind: "select",
      table: "card_reviews",
      columns: ["subject_key", "reps"],
      filters: [{ column: "reps", op: "gte", value: 2 }],
      order: [{ column: "reps", ascending: false }],
      range: [0, 0],
      count: "exact",
    });
    expect(result).toEqual({ status: 200, body: { data: [{ subject_key: "3", reps: 3 }], error: null, count: 2 } });
  });

  it("head returns the count and no data", async () => {
    expect((await run({ kind: "select", table: "card_reviews", count: "exact", head: true })).body).toEqual({ data: null, error: null, count: 3 });
  });

  it("is / not-is and in", async () => {
    const isNull = await run({ kind: "select", table: "card_reviews", columns: ["subject_key"], filters: [{ column: "last_review", op: "is", value: null }] });
    expect((isNull.body.data as unknown[]).length).toBe(3);
    const notNull = await run({ kind: "select", table: "card_reviews", filters: [{ column: "last_review", op: "not-is", value: null }] });
    expect(notNull.body.data).toEqual([]);
    const inList = await run({ kind: "select", table: "card_reviews", columns: ["subject_key"], filters: [{ column: "subject_key", op: "in", value: ["1", "3"] }], order: [{ column: "subject_key" }] });
    expect(inList.body.data).toEqual([{ subject_key: "1" }, { subject_key: "3" }]);
  });

  it("single: maybe gives a row or null; several rows (or none for one) is PGRST116", async () => {
    const one = await run({ kind: "select", table: "card_reviews", columns: ["reps"], filters: [{ column: "subject_key", op: "eq", value: "2" }], single: "maybe" });
    expect(one.body).toEqual({ data: { reps: 2 }, error: null, count: null });
    const none = await run({ kind: "select", table: "card_reviews", filters: [{ column: "subject_key", op: "eq", value: "9" }], single: "maybe" });
    expect(none.body.data).toBeNull();
    expect(none.body.error).toBeNull();
    expectBad(await run({ kind: "select", table: "card_reviews", single: "maybe" }), "PGRST116", 406);
    expectBad(await run({ kind: "select", table: "card_reviews", filters: [{ column: "subject_key", op: "eq", value: "9" }], single: "one" }), "PGRST116", 406);
  });
});

describe("writes", () => {
  it("a database guard is 200 with error 23514 (the client reads error.code)", async () => {
    await run({ kind: "upsert", table: "card_reviews", rows: { card_type: "name", subject_key: "1", locale: "en", due_date: TODAY, reps: 5 } });
    const result = await run({
      kind: "upsert",
      table: "card_reviews",
      rows: { card_type: "name", subject_key: "1", locale: "en", due_date: TODAY, reps: 4 },
      onConflict: "user_id,card_type,subject_key,locale",
    });
    expect(result.status).toBe(200);
    expect(result.body.error?.code).toBe("23514");
    expect(result.body.error?.message).toBe("card_reviews regression: reps cannot decrease");
  });

  it("writes return data: null", async () => {
    const result = await run({ kind: "upsert", table: "streak_days", rows: [{ review_date: TODAY }], onConflict: "user_id,review_date", ignoreDuplicates: true });
    expect(result).toEqual({ status: 200, body: { data: null, error: null } });
  });

  it("server-set columns cannot be written (403)", async () => {
    for (const q of [
      { kind: "upsert", table: "card_reviews", rows: { card_type: "name", subject_key: "1", locale: "en", due_date: TODAY, updated_at: "2000-01-01T00:00:00Z" } },
      { kind: "upsert", table: "card_reviews", rows: { id: "x", card_type: "name", subject_key: "1", locale: "en", due_date: TODAY } },
      { kind: "insert", table: "push_subscriptions", rows: { endpoint: "https://fcm.googleapis.com/x", p256dh: "k", auth_secret: "s", created_at: "2000-01-01T00:00:00Z" } },
    ]) {
      expectBad(await run(q), "42501", 403);
    }
  });

  it("delete_account answers 200 with nothing left to do after the response", async () => {
    d1.sqlite.prepare(`INSERT INTO feedback (id, user_id, category, message) VALUES ('f1', ?, 'bug', 'x')`).run(alice);
    expect(await run({ kind: "rpc", name: "delete_account" })).toEqual({ status: 200, body: { data: null, error: null } });
  });

  it("the reset cooldown is 200 with error P0001", async () => {
    expect((await run({ kind: "rpc", name: "reset_all_progress" })).body.error).toBeNull();
    const again = await run({ kind: "rpc", name: "reset_all_progress", args: {} });
    expect(again.status).toBe(200);
    expect(again.body.error?.code).toBe("P0001");
  });
});
