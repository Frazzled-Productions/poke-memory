/**
 * reset_all_progress (018, 022, 026) and delete_account (027) on D1.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1, createTestUser, type SqliteD1 } from "../testing/sqliteD1";
import { resetAllProgress, RESET_COOLDOWN_MS } from "./resetAllProgress";
import { deleteAccount } from "./deleteAccount";
import { deleteAuthUser } from "../authUser";

let d1: SqliteD1;
let alice: string;
let bob: string;
const TODAY = new Date().toISOString().slice(0, 10);

function seed(userId: string, tag: string): void {
  const s = d1.sqlite;
  s.prepare(
    `INSERT INTO card_reviews (user_id, card_type, subject_key, locale, due_date, last_review, first_seen) VALUES (?, 'name', '1', 'en', ?, ?, ?)`,
  ).run(userId, TODAY, TODAY, TODAY);
  s.prepare(`INSERT INTO streak_days (user_id, review_date) VALUES (?, ?)`).run(userId, TODAY);
  s.prepare(
    `INSERT INTO grade_log (user_id, occurred_at, entry_date, card_type, grade, subject_key) VALUES (?, 1, ?, 'name', 4, '1')`,
  ).run(userId, TODAY);
  s.prepare(`INSERT INTO user_settings (user_id, settings) VALUES (?, '{"maxNewPerDay":7}')`).run(userId);
  s.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_secret) VALUES (?, ?, 'k', 's')`,
  ).run(userId, `https://fcm.googleapis.com/fcm/send/${tag}`);
  s.prepare(`INSERT INTO feedback (id, user_id, category, message) VALUES (?, ?, 'bug', 'x')`).run(`bug-${tag}`, userId);
  s.prepare(`INSERT INTO feedback (id, user_id, category, message) VALUES (?, ?, 'feature', 'y')`).run(`feat-${tag}`, userId);
  s.prepare(`INSERT INTO "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId") VALUES (?, ?, ?, ?, ?, ?)`).run(
    `sess-${tag}`, "2099-01-01", `tok-${tag}`, TODAY, TODAY, userId,
  );
  s.prepare(`INSERT INTO "account" (id, "accountId", "providerId", "userId", "createdAt", "updatedAt") VALUES (?, ?, 'github', ?, ?, ?)`).run(
    `acct-${tag}`, `gh-${tag}`, userId, TODAY, TODAY,
  );
}

function count(table: string, userId: string, column = "user_id"): number {
  return Number((d1.sqlite.prepare(`SELECT count(*) AS n FROM "${table}" WHERE "${column}" = ?`).get(userId) as { n: number }).n);
}

beforeEach(() => {
  d1 = createSqliteD1();
  alice = createTestUser(d1);
  bob = createTestUser(d1);
  seed(alice, "a");
  seed(bob, "b");
});
afterEach(() => d1.close());

describe("resetAllProgress", () => {
  it("deletes cards, grade log and streak; keeps settings, push subscriptions and feedback; stamps last_reset_at", async () => {
    const now = new Date("2026-11-19T12:00:00.000Z");
    await resetAllProgress(d1, alice, now);
    expect([count("card_reviews", alice), count("grade_log", alice), count("streak_days", alice)]).toEqual([0, 0, 0]);
    expect([count("push_subscriptions", alice), count("feedback", alice)]).toEqual([1, 2]);
    const row = d1.sqlite.prepare("SELECT settings, last_reset_at, updated_at FROM user_settings WHERE user_id = ?").get(alice);
    expect(row).toEqual({ settings: '{"maxNewPerDay":7}', last_reset_at: now.toISOString(), updated_at: now.toISOString() });
    // Bob untouched.
    expect([count("card_reviews", bob), count("grade_log", bob), count("streak_days", bob)]).toEqual([1, 1, 1]);
  });

  it("creates the settings row when there is none (only last_reset_at set)", async () => {
    d1.sqlite.prepare("DELETE FROM user_settings WHERE user_id = ?").run(alice);
    await resetAllProgress(d1, alice);
    expect(d1.sqlite.prepare("SELECT settings FROM user_settings WHERE user_id = ?").get(alice)).toEqual({ settings: "{}" });
  });

  it("refuses a second reset within the cooldown with P0001 and changes nothing (026)", async () => {
    const first = new Date("2026-11-19T12:00:00.000Z");
    await resetAllProgress(d1, alice, first);
    d1.sqlite
      .prepare(`INSERT INTO streak_days (user_id, review_date) VALUES (?, ?)`)
      .run(alice, first.toISOString().slice(0, 10));
    await expect(resetAllProgress(d1, alice, new Date(first.getTime() + RESET_COOLDOWN_MS - 1))).rejects.toMatchObject({
      code: "P0001",
      message: "reset_all_progress: cooldown active, retry shortly",
    });
    expect(count("streak_days", alice)).toBe(1);
    expect((d1.sqlite.prepare("SELECT last_reset_at FROM user_settings WHERE user_id = ?").get(alice) as { last_reset_at: string }).last_reset_at).toBe(first.toISOString());
    await resetAllProgress(d1, alice, new Date(first.getTime() + RESET_COOLDOWN_MS + 1));
    expect(count("streak_days", alice)).toBe(0);
  });

  it("the tombstone then blocks pre-reset progress (022 triggers)", async () => {
    await resetAllProgress(d1, alice);
    expect(() =>
      d1.sqlite
        .prepare(`INSERT INTO streak_days (user_id, review_date) VALUES (?, '2020-01-01')`)
        .run(alice),
    ).toThrow(/before last_reset_at/);
  });
});

describe("deleteAccount", () => {
  it("deletes every per-user row, the sessions, accounts and the user", async () => {
    expect(await deleteAccount(d1, alice)).toBeUndefined();
    for (const table of ["card_reviews", "grade_log", "streak_days", "user_settings", "push_subscriptions", "feedback"]) {
      expect(count(table, alice)).toBe(0);
    }
    expect(count("session", alice, "userId")).toBe(0);
    expect(count("account", alice, "userId")).toBe(0);
    expect(count("user", alice, "id")).toBe(0);
    // Bob untouched.
    expect(count("card_reviews", bob)).toBe(1);
    expect(count("user", bob, "id")).toBe(1);
  });

  it("deleteAuthUser on its own removes sessions, accounts and the user (and cascades)", async () => {
    await deleteAuthUser(d1, bob);
    expect(count("user", bob, "id")).toBe(0);
    expect(count("session", bob, "userId")).toBe(0);
    expect(count("card_reviews", bob)).toBe(0);
  });
});
