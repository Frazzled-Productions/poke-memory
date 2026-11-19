import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseLike } from "./d1";
import { DbError } from "./errors";
import { MAX_BOUND_PARAMETERS, forUser, fromSqlValue, toSqlValue, type ScopedDb } from "./scope";
import { createSqliteD1, createTestUser, type SqliteD1 } from "./testing/sqliteD1";

let d1: SqliteD1;
let alice: string;
let bob: string;
let asAlice: ScopedDb;
let asBob: ScopedDb;

beforeEach(() => {
  d1 = createSqliteD1();
  alice = createTestUser(d1);
  bob = createTestUser(d1);
  asAlice = forUser(d1, alice);
  asBob = forUser(d1, bob);
});

afterEach(() => d1.close());

function card(subjectKey: string, extra: Record<string, unknown> = {}) {
  return { card_type: "name", subject_key: subjectKey, locale: "en", due_date: "2026-12-01", ...extra };
}

const CONFLICT = "user_id,card_type,subject_key,locale";

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (err) {
    return err instanceof DbError ? err.code : `not a DbError: ${String(err)}`;
  }
}

describe("forUser: reads are pinned to the session user", () => {
  beforeEach(async () => {
    await asAlice.insert("card_reviews", [card("1"), card("2", { locale: "ja" })]);
    await asBob.insert("card_reviews", card("1"));
  });

  it("select returns only the caller's rows", async () => {
    const rows = await asAlice.select("card_reviews", { columns: ["user_id", "subject_key"] });
    expect(rows).toEqual([
      { user_id: alice, subject_key: "1" },
      { user_id: alice, subject_key: "2" },
    ]);
    expect(await asBob.count("card_reviews")).toBe(1);
  });

  it("a filter restating the caller's own id is allowed", async () => {
    expect(await asAlice.count("card_reviews", [{ column: "user_id", op: "eq", value: alice }])).toBe(2);
    expect(await asAlice.count("card_reviews", [{ column: "user_id", op: "in", value: [alice] }])).toBe(2);
  });

  it.each([
    ["eq another user", { column: "user_id", op: "eq", value: "someone-else" }],
    ["neq", { column: "user_id", op: "neq", value: "x" }],
    ["in with another user", { column: "user_id", op: "in", value: ["someone-else"] }],
    ["in mixing users", { column: "user_id", op: "in", value: ["alice-id-placeholder", "x"] }],
    ["in empty", { column: "user_id", op: "in", value: [] }],
    ["is null", { column: "user_id", op: "is", value: null }],
    ["gt", { column: "user_id", op: "gt", value: "" }],
  ] as const)("a filter on user_id that is not the caller (%s) is refused with 42501", async (_label, filter) => {
    expect(await codeOf(asAlice.select("card_reviews", { filters: [filter] }))).toBe("42501");
    expect(await codeOf(asAlice.count("card_reviews", [filter]))).toBe("42501");
    expect(await codeOf(asAlice.delete("card_reviews", [filter]))).toBe("42501");
    expect(await codeOf(asAlice.update("card_reviews", { reps: 5 }, [filter]))).toBe("42501");
  });

  it("returns supabase-js shapes: booleans, numbers, null", async () => {
    await asAlice.update("card_reviews", { seen_in_pasture: true }, [
      { column: "subject_key", op: "eq", value: "1" },
    ]);
    const [row] = await asAlice.select("card_reviews", {
      columns: ["subject_key", "seen_in_pasture", "stability", "last_review"],
      filters: [{ column: "subject_key", op: "eq", value: "1" }],
    });
    expect(row).toEqual({ subject_key: "1", seen_in_pasture: true, stability: 0, last_review: null });
  });

  it("select * returns every allowlisted column", async () => {
    const [row] = await asBob.select("card_reviews");
    expect(Object.keys(row).sort()).toEqual(
      [
        "id", "user_id", "card_type", "subject_key", "locale", "due_date", "last_review", "first_seen",
        "updated_at", "stability", "difficulty", "elapsed_days", "scheduled_days", "reps", "lapses",
        "fsrs_state", "hidden_since", "seen_in_pasture",
      ].sort(),
    );
    expect(row.seen_in_pasture).toBe(false);
  });
});

describe("forUser: filters, order, paging", () => {
  beforeEach(async () => {
    await asAlice.insert("card_reviews", [
      card("1", { reps: 1, last_review: "2026-11-01", first_seen: "2026-11-01" }),
      card("2", { reps: 2, last_review: null }),
      card("3", { reps: 3, last_review: "2026-11-03", first_seen: "2026-11-01", locale: "ja" }),
      card("4", { reps: 4, card_type: "evolution", last_review: "2026-11-02", first_seen: "2026-11-01" }),
    ]);
  });

  const keys = (rows: Record<string, unknown>[]) => rows.map((r) => r.subject_key);

  it.each([
    ["eq", { column: "locale", op: "eq", value: "ja" }, ["3"]],
    ["neq", { column: "locale", op: "neq", value: "ja" }, ["1", "2", "4"]],
    ["gt", { column: "reps", op: "gt", value: 2 }, ["3", "4"]],
    ["gte", { column: "reps", op: "gte", value: 2 }, ["2", "3", "4"]],
    ["lt", { column: "reps", op: "lt", value: 2 }, ["1"]],
    ["lte (numeric string, as PostgREST)", { column: "reps", op: "lte", value: "2" }, ["1", "2"]],
    ["in", { column: "subject_key", op: "in", value: ["1", "4", "9"] }, ["1", "4"]],
    ["in empty", { column: "subject_key", op: "in", value: [] }, []],
    ["is null", { column: "last_review", op: "is", value: null }, ["2"]],
    ["not-is null", { column: "last_review", op: "not-is", value: null }, ["1", "3", "4"]],
    ["is false (bool)", { column: "seen_in_pasture", op: "is", value: false }, ["1", "2", "3", "4"]],
    ["date gte", { column: "last_review", op: "gte", value: "2026-11-02" }, ["3", "4"]],
  ] as const)("%s", async (_label, filter, expected) => {
    const rows = await asAlice.select("card_reviews", {
      columns: ["subject_key"],
      filters: [filter],
      order: [{ column: "subject_key" }],
    });
    expect(keys(rows)).toEqual(expected);
  });

  it("an in list longer than D1's parameter limit still works (one JSON parameter)", async () => {
    const list = Array.from({ length: 500 }, (_, i) => String(i));
    expect(await asAlice.count("card_reviews", [{ column: "subject_key", op: "in", value: list }])).toBe(4);
  });

  it("filters AND together", async () => {
    expect(
      await asAlice.count("card_reviews", [
        { column: "card_type", op: "eq", value: "name" },
        { column: "reps", op: "gte", value: 2 },
      ]),
    ).toBe(2);
  });

  it("orders like Postgres: nulls last ascending, first descending, overridable", async () => {
    const asc = await asAlice.select("card_reviews", { columns: ["subject_key"], order: [{ column: "last_review" }] });
    expect(keys(asc)).toEqual(["1", "4", "3", "2"]);
    const desc = await asAlice.select("card_reviews", {
      columns: ["subject_key"],
      order: [{ column: "last_review", ascending: false }],
    });
    expect(keys(desc)).toEqual(["2", "3", "4", "1"]);
    const nullsLast = await asAlice.select("card_reviews", {
      columns: ["subject_key"],
      order: [{ column: "last_review", ascending: false, nullsFirst: false }],
    });
    expect(keys(nullsLast)).toEqual(["3", "4", "1", "2"]);
  });

  it("orders by several columns", async () => {
    const rows = await asAlice.select("card_reviews", {
      columns: ["subject_key"],
      order: [{ column: "card_type", ascending: false }, { column: "reps", ascending: false }],
    });
    expect(keys(rows)).toEqual(["3", "2", "1", "4"]);
  });

  it("limit and offset (range)", async () => {
    const page = (offset: number, limit?: number) =>
      asAlice
        .select("card_reviews", { columns: ["subject_key"], order: [{ column: "reps" }], offset, limit })
        .then(keys);
    expect(await page(0, 2)).toEqual(["1", "2"]);
    expect(await page(2, 2)).toEqual(["3", "4"]);
    expect(await page(3)).toEqual(["4"]);
    expect(await codeOf(page(-1, 2))).toBe("22P02");
    expect(await codeOf(page(0, 1.5))).toBe("22P02");
  });

  it("refuses bad filter values and operators", async () => {
    const bad = (filter: never) => codeOf(asAlice.select("card_reviews", { filters: [filter] }));
    expect(await bad({ column: "reps", op: "eq", value: null } as never)).toBe("22P02");
    expect(await bad({ column: "reps", op: "eq", value: "two" } as never)).toBe("22P02");
    expect(await bad({ column: "reps", op: "in", value: "1" } as never)).toBe("22P02");
    expect(await bad({ column: "reps", op: "in", value: [null] } as never)).toBe("22P02");
    expect(await bad({ column: "reps", op: "is", value: 1 } as never)).toBe("22P02");
    expect(await bad({ column: "reps", op: "like", value: "%" } as never)).toBe("42883");
    expect(await bad({ column: "last_review", op: "eq", value: "yesterday" } as never)).toBe("22007");
  });
});

describe("forUser: identifiers are allowlisted", () => {
  it("refuses unknown and system tables with 42P01", async () => {
    for (const table of ["nope", "rate_limit_buckets", "feedback_discord_posts", "user", "session", "account"]) {
      expect([table, await codeOf(asAlice.select(table))]).toEqual([table, "42P01"]);
    }
  });

  it("refuses unknown columns anywhere with 42703", async () => {
    expect(await codeOf(asAlice.select("card_reviews", { columns: ["nope"] }))).toBe("42703");
    expect(await codeOf(asAlice.select("card_reviews", { columns: [] }))).toBe("42703");
    expect(await codeOf(asAlice.select("card_reviews", { order: [{ column: "nope" }] }))).toBe("42703");
    expect(
      await codeOf(asAlice.select("card_reviews", { filters: [{ column: "nope", op: "eq", value: 1 }] })),
    ).toBe("42703");
    expect(await codeOf(asAlice.insert("card_reviews", { ...card("1"), nope: 1 }))).toBe("42703");
    expect(await codeOf(asAlice.update("card_reviews", { nope: 1 }, []))).toBe("42703");
    expect(
      await codeOf(asAlice.select("card_reviews", { columns: ['subject_key" FROM user --'] })),
    ).toBe("42703");
  });

  it("never interpolates values: SQL in a value is just data", async () => {
    await asAlice.insert("card_reviews", card("'); DROP TABLE card_reviews; --"));
    const rows = await asAlice.select("card_reviews", {
      columns: ["subject_key"],
      filters: [{ column: "subject_key", op: "eq", value: "'); DROP TABLE card_reviews; --" }],
    });
    expect(rows).toHaveLength(1);
  });
});

describe("forUser: writes are pinned to the session user", () => {
  it("insert sets user_id to the caller when omitted", async () => {
    const [row] = await asAlice.insert("streak_days", { review_date: "2026-11-01" }, { returning: ["user_id", "review_date"] });
    expect(row).toEqual({ user_id: alice, review_date: "2026-11-01" });
  });

  it("a row naming another user is refused with 42501 and nothing is written", async () => {
    expect(
      await codeOf(
        asAlice.insert("streak_days", [
          { review_date: "2026-11-01" },
          { user_id: bob, review_date: "2026-11-02" },
        ]),
      ),
    ).toBe("42501");
    expect(await asAlice.count("streak_days")).toBe(0);
    expect(await asBob.count("streak_days")).toBe(0);
    expect(await codeOf(asAlice.upsert("streak_days", { user_id: bob, review_date: "2026-11-01" }))).toBe("42501");
    expect(await codeOf(asAlice.update("streak_days", { user_id: bob }, []))).toBe("42501");
  });

  it("update and delete never touch another user's rows", async () => {
    await asAlice.insert("card_reviews", card("1", { reps: 1 }));
    await asBob.insert("card_reviews", card("1", { reps: 1 }));
    const updated = await asAlice.update("card_reviews", { reps: 2 }, [], { returning: ["user_id", "reps"] });
    expect(updated).toEqual([{ user_id: alice, reps: 2 }]);
    const deleted = await asAlice.delete("card_reviews", [], { returning: ["user_id"] });
    expect(deleted).toEqual([{ user_id: alice }]);
    expect(await asBob.select("card_reviews", { columns: ["reps"] })).toEqual([{ reps: 1 }]);
  });

  it("an upsert conflicting on another user's key inserts the caller's own row", async () => {
    await asBob.upsert("card_reviews", card("1", { reps: 7 }), { onConflict: CONFLICT });
    await asAlice.upsert("card_reviews", card("1", { reps: 1 }), { onConflict: CONFLICT });
    expect(await asBob.select("card_reviews", { columns: ["reps"] })).toEqual([{ reps: 7 }]);
    expect(await asAlice.select("card_reviews", { columns: ["reps"] })).toEqual([{ reps: 1 }]);
  });

  it("onConflict must be a unique key that includes user_id (42P10)", async () => {
    expect(await codeOf(asAlice.upsert("streak_days", { review_date: "2026-11-01" }, { onConflict: "id" }))).toBe(
      "42P10",
    );
    expect(await codeOf(asAlice.upsert("streak_days", { review_date: "2026-11-01" }, { onConflict: "review_date" }))).toBe(
      "42P10",
    );
    expect(await codeOf(asAlice.upsert("feedback", { category: "bug", message: "x" }))).toBe("42P10");
    expect(
      await codeOf(asAlice.upsert("streak_days", { review_date: "2026-11-01" }, { onConflict: ["review_date", "user_id"] })),
    ).toBe("ok");
  });

  it("update with only undefined or user_id values is a no-op", async () => {
    await asAlice.insert("card_reviews", card("1"));
    expect(await asAlice.update("card_reviews", { user_id: alice, reps: undefined }, [])).toEqual([]);
  });
});

describe("forUser: upsert", () => {
  it("updates the supplied columns on conflict and keeps the rest", async () => {
    await asAlice.insert("card_reviews", card("1", { reps: 1, stability: 2.5 }));
    await asAlice.upsert("card_reviews", card("1", { reps: 2 }), { onConflict: CONFLICT });
    expect(await asAlice.select("card_reviews", { columns: ["reps", "stability"] })).toEqual([
      { reps: 2, stability: 2.5 },
    ]);
  });

  it("defaults onConflict to the table's first conflict key", async () => {
    await asAlice.upsert("streak_days", { review_date: "2026-11-01" });
    await asAlice.upsert("streak_days", { review_date: "2026-11-01" });
    expect(await asAlice.count("streak_days")).toBe(1);
  });

  it("ignoreDuplicates leaves existing rows alone and returns only new ones", async () => {
    await asAlice.insert("grade_log", { occurred_at: 1, entry_date: "2026-11-01", card_type: "name", grade: 4, subject_key: "1" });
    const returned = await asAlice.upsert(
      "grade_log",
      [
        { occurred_at: 1, entry_date: "2026-11-01", card_type: "name", grade: 1, subject_key: "1" },
        { occurred_at: 2, entry_date: "2026-11-01", card_type: "name", grade: 5, subject_key: "1" },
      ],
      { onConflict: "user_id,occurred_at", ignoreDuplicates: true, returning: ["occurred_at", "grade"] },
    );
    expect(returned).toEqual([{ occurred_at: 2, grade: 5 }]);
    expect(
      await asAlice.select("grade_log", { columns: ["occurred_at", "grade"], order: [{ column: "occurred_at" }] }),
    ).toEqual([
      { occurred_at: 1, grade: 4 },
      { occurred_at: 2, grade: 5 },
    ]);
  });

  it("is atomic: a guard refusing one row rolls back the whole batch, with 23514", async () => {
    await asAlice.insert("card_reviews", card("1", { reps: 5 }));
    const code = await codeOf(
      asAlice.upsert("card_reviews", [card("2", { reps: 1 }), card("1", { reps: 1 })], { onConflict: CONFLICT }),
    );
    expect(code).toBe("23514");
    expect(await asAlice.count("card_reviews")).toBe(1);
  });

  it("writes one statement per row, so many wide rows fit D1's parameter limit", async () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      card(String(i), {
        reps: 1, lapses: 0, stability: 1.5, difficulty: 5, elapsed_days: 1, scheduled_days: 2,
        fsrs_state: "review", last_review: "2026-11-01", first_seen: "2026-11-01", hidden_since: null,
        seen_in_pasture: false, locale: "en", updated_at: "2026-11-01T00:00:00Z",
      }),
    );
    const prepare = vi.spyOn(d1, "prepare");
    await asAlice.upsert("card_reviews", rows, { onConflict: CONFLICT });
    expect(prepare).toHaveBeenCalledTimes(60);
    expect(await asAlice.count("card_reviews")).toBe(60);
  });

  it("columns missing from some rows are NULL by default (defaultToNull), or the default when false", async () => {
    await asAlice.insert("card_reviews", [card("1", { stability: 3 }), card("2")], { defaultToNull: false });
    expect(await asAlice.select("card_reviews", { columns: ["stability"], order: [{ column: "subject_key" }] })).toEqual([
      { stability: 3 },
      { stability: 0 },
    ]);
    // stability is NOT NULL, so defaultToNull (the supabase-js default) fails the second row.
    expect(await codeOf(asAlice.insert("card_reviews", [card("3", { stability: 3 }), card("4")]))).toBe("23502");
  });

  it("empty input runs nothing", async () => {
    const prepare = vi.spyOn(d1, "prepare");
    expect(await asAlice.upsert("card_reviews", [])).toEqual([]);
    expect(await asAlice.insert("card_reviews", [])).toEqual([]);
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("forUser: type conversion", () => {
  it("json columns round-trip as values", async () => {
    const settings = { theme: "dark", onboarding: { done: true }, list: [1, 2], gone: null };
    await asAlice.upsert("user_settings", { settings });
    const [row] = await asAlice.select("user_settings", { columns: ["settings"] });
    expect(row.settings).toEqual(settings);
    expect(await codeOf(asAlice.select("user_settings", { filters: [{ column: "settings", op: "eq", value: "{}" }] }))).toBe(
      "42883",
    );
    expect(await asAlice.count("user_settings", [{ column: "settings", op: "not-is", value: null }])).toBe(1);
  });

  it("timestamps are normalised to ISO UTC with milliseconds", async () => {
    await asAlice.upsert("user_settings", { last_reset_at: "2026-11-19T10:00:00.123456+01:00" });
    const [row] = await asAlice.select("user_settings", { columns: ["last_reset_at"] });
    expect(row.last_reset_at).toBe("2026-11-19T09:00:00.123Z");
    expect(
      await asAlice.count("user_settings", [{ column: "last_reset_at", op: "gt", value: "2026-11-19T09:30:00+01:00" }]),
    ).toBe(1);
    expect(await codeOf(asAlice.upsert("user_settings", { last_reset_at: "soon" }))).toBe("22007");
  });

  it("dates keep their day", async () => {
    await asAlice.insert("streak_days", { review_date: "2026-11-19T23:30:00Z" });
    expect(await asAlice.select("streak_days", { columns: ["review_date"] })).toEqual([{ review_date: "2026-11-19" }]);
  });

  it("toSqlValue / fromSqlValue", () => {
    expect(toSqlValue("c", "text", 5)).toBe("5");
    expect(toSqlValue("c", "text", true)).toBe("true");
    expect(() => toSqlValue("c", "text", {})).toThrow(expect.objectContaining({ code: "22P02" }));
    expect(toSqlValue("c", "int", "42")).toBe(42);
    expect(() => toSqlValue("c", "int", 1.5)).toThrow(expect.objectContaining({ code: "22P02" }));
    expect(() => toSqlValue("c", "int", "")).toThrow(expect.objectContaining({ code: "22P02" }));
    expect(() => toSqlValue("c", "real", Infinity)).toThrow(expect.objectContaining({ code: "22P02" }));
    expect(toSqlValue("c", "real", "1.25")).toBe(1.25);
    expect(toSqlValue("c", "bool", "true")).toBe(1);
    expect(toSqlValue("c", "bool", 0)).toBe(0);
    expect(() => toSqlValue("c", "bool", "yes")).toThrow(expect.objectContaining({ code: "22P02" }));
    expect(toSqlValue("c", "json", "s")).toBe('"s"');
    expect(toSqlValue("c", "timestamp", new Date(0))).toBe("1970-01-01T00:00:00.000Z");
    expect(() => toSqlValue("c", "date", 20261119)).toThrow(expect.objectContaining({ code: "22007" }));
    expect(toSqlValue("c", "int", null)).toBeNull();
    expect(fromSqlValue("bool", 0)).toBe(false);
    expect(fromSqlValue("json", '{"a":1}')).toEqual({ a: 1 });
    expect(fromSqlValue("text", null)).toBeNull();
  });

  it("refuses a non-object row or update", async () => {
    expect(await codeOf(asAlice.insert("streak_days", ["2026-11-01"] as never))).toBe("22P02");
    expect(await codeOf(asAlice.update("streak_days", [] as never, []))).toBe("22P02");
  });
});

describe("forUser: errors and limits", () => {
  it("maps database errors to Postgres codes", async () => {
    await asAlice.insert("streak_days", { review_date: "2026-11-01" });
    expect(await codeOf(asAlice.insert("streak_days", { review_date: "2026-11-01" }))).toBe("23505");
    expect(await codeOf(asAlice.insert("card_reviews", card("1", { difficulty: 11 })))).toBe("23514");
  });

  it("refuses a statement over D1's parameter limit before sending it", async () => {
    const filters = Array.from({ length: MAX_BOUND_PARAMETERS }, (_, i) => ({
      column: "subject_key",
      op: "neq" as const,
      value: String(i),
    }));
    expect(await codeOf(asAlice.select("card_reviews", { filters }))).toBe("54000");
  });

  it("forUser needs a user id", () => {
    expect(() => forUser(d1, "")).toThrow(expect.objectContaining({ code: "42501" }));
    expect(() => forUser(d1, undefined as never)).toThrow(DbError);
  });

  it("a D1 failure outside SQLite surfaces as XX000", async () => {
    const broken: D1DatabaseLike = {
      ...d1,
      prepare: d1.prepare.bind(d1),
      exec: d1.exec.bind(d1),
      batch: async () => {
        throw new Error("network went away");
      },
    };
    expect(await codeOf(forUser(broken, alice).count("card_reviews"))).toBe("XX000");
  });
});
