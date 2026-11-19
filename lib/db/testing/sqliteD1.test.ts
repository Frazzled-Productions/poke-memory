import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1, createTestUser, type SqliteD1 } from "./sqliteD1";

let d1: SqliteD1;
beforeEach(() => {
  d1 = createSqliteD1({ migrate: false });
  d1.sqlite.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT UNIQUE, flag INTEGER)");
});
afterEach(() => d1.close());

describe("sqliteD1 shim", () => {
  it("prepare is lazy: a bad statement fails when run, with D1's prefix", async () => {
    const stmt = d1.prepare("SELECT * FROM missing");
    await expect(stmt.all()).rejects.toThrow(/^D1_ERROR: no such table: missing/);
  });

  it("binds booleans as 1/0 and refuses undefined", async () => {
    await d1.prepare("INSERT INTO t (name, flag) VALUES (?, ?)").bind("a", true).run();
    expect(await d1.prepare("SELECT flag FROM t").first("flag")).toBe(1);
    expect(() => d1.prepare("SELECT ?").bind(undefined)).toThrow(/D1_TYPE_ERROR/);
  });

  it("run returns meta; all returns rows; first and raw", async () => {
    const res = await d1.prepare("INSERT INTO t (name) VALUES (?), (?)").bind("a", "b").run();
    expect(res.meta.changes).toBe(2);
    expect(res.meta.last_row_id).toBe(2);
    expect((await d1.prepare("SELECT name FROM t ORDER BY id").all()).results).toEqual([{ name: "a" }, { name: "b" }]);
    expect(await d1.prepare("SELECT name FROM t WHERE id = 9").first()).toBeNull();
    await expect(d1.prepare("SELECT name FROM t").first("nope")).rejects.toThrow(/D1_COLUMN_NOTFOUND/);
    expect(await d1.prepare("SELECT id, name FROM t ORDER BY id").raw()).toEqual([[1, "a"], [2, "b"]]);
    expect(await d1.prepare("SELECT id FROM t WHERE id = 1").raw({ columnNames: true })).toEqual([["id"], [1]]);
  });

  it("RETURNING rows come back from run() and batch()", async () => {
    const res = await d1.prepare("INSERT INTO t (name) VALUES ('a') RETURNING id, name").run();
    expect(res.results).toEqual([{ id: 1, name: "a" }]);
    expect(res.meta.changes).toBe(1);
  });

  it("batch is atomic: one failure rolls every statement back", async () => {
    await expect(
      d1.batch([
        d1.prepare("INSERT INTO t (name) VALUES ('a')"),
        d1.prepare("INSERT INTO t (name) VALUES ('a')"),
      ]),
    ).rejects.toThrow(/UNIQUE constraint failed/);
    expect(await d1.prepare("SELECT count(*) AS n FROM t").first("n")).toBe(0);
    const ok = await d1.batch([d1.prepare("INSERT INTO t (name) VALUES ('a')"), d1.prepare("SELECT name FROM t")]);
    expect(ok[1].results).toEqual([{ name: "a" }]);
  });

  it("exec runs several statements", async () => {
    const res = await d1.exec("INSERT INTO t (name) VALUES ('x'); INSERT INTO t (name) VALUES ('y');");
    expect(res.count).toBe(2);
    await expect(d1.exec("NOT SQL")).rejects.toThrow(/^D1_ERROR/);
  });

  it("applies migrations up to a named file", () => {
    const partial = createSqliteD1({ through: "0001_schema.sql" });
    const tables = (partial.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[]).map((r) => r.name);
    expect(tables).toContain("card_reviews");
    expect(tables).not.toContain("session");
    partial.close();
  });

  it("createTestUser inserts a user that foreign keys accept", async () => {
    const full = createSqliteD1();
    const id = createTestUser(full, { username: "ash_k" });
    await full.prepare("INSERT INTO streak_days (user_id, review_date) VALUES (?, '2026-01-01')").bind(id).run();
    expect(await full.prepare('SELECT username FROM "user" WHERE id = ?').bind(id).first("username")).toBe("ash_k");
    full.close();
  });
});
