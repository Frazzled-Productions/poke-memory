/**
 * The push system queries against the D1 test database, matching the
 * Postgres functions of migrations 046 and 047.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forUser } from "../scope";
import { createSqliteD1, createTestUser, type SqliteD1 } from "../testing/sqliteD1";
import { deleteDeadPushSubscriptions, getPushDueCards, getPushStreakDays, getPushTargets } from "./push";

let d1: SqliteD1;
let alice: string;
let bob: string;
let carol: string;

beforeEach(() => {
  d1 = createSqliteD1();
  alice = createTestUser(d1, { id: "00000000-0000-4000-8000-00000000000a" });
  bob = createTestUser(d1, { id: "00000000-0000-4000-8000-00000000000b" });
  carol = createTestUser(d1, { id: "00000000-0000-4000-8000-00000000000c" });
});
afterEach(() => d1.close());

async function subscribe(userId: string, n: number) {
  const [row] = await forUser(d1, userId).insert(
    "push_subscriptions",
    { endpoint: `https://fcm.googleapis.com/fcm/send/${userId}-${n}`, p256dh: "p", auth_secret: "a" },
    { returning: ["id"] },
  );
  return row.id as string;
}

async function card(userId: string, fields: Record<string, unknown>) {
  await forUser(d1, userId).insert("card_reviews", { card_type: "name", locale: "en", ...fields });
}

describe("getPushTargets (046)", () => {
  it("returns one row per subscription, LEFT JOINed to settings, ordered by user then id", async () => {
    const a1 = await subscribe(alice, 1);
    const a2 = await subscribe(alice, 2);
    const b1 = await subscribe(bob, 1);
    await forUser(d1, alice).insert("user_settings", {
      settings: { streakNudgeEnabled: true, learningLocales: ["en", "ja"] },
      timezone: "Europe/London",
      push_notification_hour: 20,
    });

    const targets = await getPushTargets(d1);
    expect(targets.map((t) => t.subscription_id)).toEqual([a1, a2].sort().concat(b1));
    expect(targets[0]).toMatchObject({
      user_id: alice,
      endpoint: expect.stringContaining("fcm.googleapis.com"),
      p256dh: "p",
      auth_secret: "a",
      timezone: "Europe/London",
      settings: { streakNudgeEnabled: true, learningLocales: ["en", "ja"] },
      push_notification_hour: 20,
    });
    // Bob has no settings row: still a target, with null settings fields.
    expect(targets[2]).toMatchObject({ user_id: bob, timezone: null, settings: null, push_notification_hour: null });
  });

  it("leaves out users with no subscription", async () => {
    await forUser(d1, carol).insert("user_settings", { settings: {} });
    expect(await getPushTargets(d1)).toEqual([]);
  });
});

describe("getPushDueCards (046)", () => {
  it("returns the non-hidden rows due on or before today for the given users only", async () => {
    await card(alice, { subject_key: "1", due_date: "2026-05-19", first_seen: "2026-05-01" });
    await card(alice, { subject_key: "2", due_date: "2026-05-20", locale: "ja" });
    await card(alice, { subject_key: "3", due_date: "2026-05-21" });
    await card(alice, { subject_key: "4", due_date: "2026-05-01", hidden_since: "2026-05-02" });
    await card(bob, { subject_key: "5", due_date: "2026-05-10" });
    await card(carol, { subject_key: "6", due_date: "2026-05-10" });

    const rows = await getPushDueCards(d1, [alice, bob], "2026-05-20");
    expect(rows).toEqual([
      { user_id: alice, card_type: "name", subject_key: "1", first_seen: "2026-05-01", locale: "en", due_date: "2026-05-19" },
      { user_id: alice, card_type: "name", subject_key: "2", first_seen: null, locale: "ja", due_date: "2026-05-20" },
      { user_id: bob, card_type: "name", subject_key: "5", first_seen: null, locale: "en", due_date: "2026-05-10" },
    ]);
  });

  it("returns nothing for an empty user list", async () => {
    await card(alice, { subject_key: "1", due_date: "2026-05-19" });
    expect(await getPushDueCards(d1, [], "2026-05-20")).toEqual([]);
  });

  it("is not capped at 1000 rows (no PostgREST page limit)", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      card_type: "name",
      locale: "en",
      subject_key: String(i + 1),
      due_date: "2026-05-01",
    }));
    await forUser(d1, alice).insert("card_reviews", rows);
    expect(await getPushDueCards(d1, [alice], "2026-05-20")).toHaveLength(1200);
  });
});

describe("getPushStreakDays (047)", () => {
  it("returns every streak day of the given users, ordered by user then date", async () => {
    for (const d of ["2026-05-19", "2026-05-17", "2026-05-18"]) {
      await forUser(d1, alice).insert("streak_days", { review_date: d });
    }
    await forUser(d1, bob).insert("streak_days", { review_date: "2026-05-01" });
    await forUser(d1, carol).insert("streak_days", { review_date: "2026-05-02" });

    expect(await getPushStreakDays(d1, [bob, alice])).toEqual([
      { user_id: alice, review_date: "2026-05-17" },
      { user_id: alice, review_date: "2026-05-18" },
      { user_id: alice, review_date: "2026-05-19" },
      { user_id: bob, review_date: "2026-05-01" },
    ]);
  });
});

describe("deleteDeadPushSubscriptions", () => {
  it("deletes exactly the given ids and returns the count", async () => {
    const a1 = await subscribe(alice, 1);
    const a2 = await subscribe(alice, 2);
    const b1 = await subscribe(bob, 1);
    expect(await deleteDeadPushSubscriptions(d1, [a1, b1, "no-such-id"])).toBe(2);
    expect((await getPushTargets(d1)).map((t) => t.subscription_id)).toEqual([a2]);
    expect(await deleteDeadPushSubscriptions(d1, [])).toBe(0);
  });
});
