import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteAuthUser } from "./authUser";
import { forUser } from "./scope";
import { TABLES, type ScopedTableName } from "./tables";
import { createSqliteD1, createTestUser, type SqliteD1 } from "./testing/sqliteD1";

let d1: SqliteD1;
let alice: string;
let bob: string;

beforeEach(() => {
  d1 = createSqliteD1();
  alice = createTestUser(d1, { username: "alice" });
  bob = createTestUser(d1, { username: "bobby" });
});
afterEach(() => d1.close());

/** One row in every per-user table, through the scope helper. */
async function seedEveryTable(userId: string) {
  const db = forUser(d1, userId);
  await db.insert("card_reviews", { card_type: "name", subject_key: "25", locale: "en", due_date: "2026-12-01" });
  await db.insert("user_settings", { settings: { theme: "dark" } });
  await db.insert("streak_days", { review_date: "2026-11-18" });
  await db.insert("grade_log", {
    occurred_at: 1_763_500_000_000,
    entry_date: "2026-11-18",
    card_type: "name",
    grade: 4,
    subject_key: "25",
  });
  await db.insert("push_subscriptions", {
    endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint",
    p256dh: "test-p256dh",
    auth_secret: "test-auth",
  });
  await db.insert("feedback", { category: "bug", message: "test message" });
}

function seedAuthRows(userId: string) {
  const now = new Date().toISOString();
  d1.sqlite
    .prepare(`INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(`s-${userId}`, now, `t-${userId}`, now, now, userId);
  for (const provider of ["credential", "github"]) {
    d1.sqlite
      .prepare(`INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(`a-${provider}-${userId}`, userId, provider, userId, now, now);
  }
}

const count = (sql: string, userId: string) => Number((d1.sqlite.prepare(sql).get(userId) as { n: number }).n);

describe("deleteAuthUser", () => {
  it("covers every table that references the user (a new one must be seeded here)", () => {
    const referencing = (d1.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[])
      .map((t) => t.name)
      .filter((name) =>
        (d1.sqlite.prepare(`PRAGMA foreign_key_list("${name}")`).all() as { table: string }[]).some((fk) => fk.table === "user"),
      )
      .sort();
    expect(referencing).toEqual([...Object.keys(TABLES), "account", "session"].sort());
  });

  it("empties every app table and the auth tables for that user, and leaves other users alone", async () => {
    for (const user of [alice, bob]) {
      await seedEveryTable(user);
      seedAuthRows(user);
    }
    const tables = Object.keys(TABLES) as ScopedTableName[];
    for (const table of tables) expect(await forUser(d1, alice).count(table)).toBe(1);

    await deleteAuthUser(d1, alice);

    for (const table of tables) {
      expect(await forUser(d1, alice).count(table), table).toBe(0);
      expect(await forUser(d1, bob).count(table), table).toBe(1);
    }
    expect(count(`SELECT COUNT(*) AS n FROM "user" WHERE id = ?`, alice)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM "session" WHERE userId = ?`, alice)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM account WHERE userId = ?`, alice)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM "user" WHERE id = ?`, bob)).toBe(1);
    expect(count(`SELECT COUNT(*) AS n FROM account WHERE userId = ?`, bob)).toBe(2);
  });

  it("is a no-op for an unknown user", async () => {
    await deleteAuthUser(d1, "00000000-0000-4000-8000-000000000000");
    expect(count(`SELECT COUNT(*) AS n FROM "user" WHERE id = ?`, alice)).toBe(1);
  });
});
