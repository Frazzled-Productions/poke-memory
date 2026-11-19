/**
 * Parity: the real lib/sync functions, unchanged, run through the real data
 * client and the real gateway against the D1 test database (task 3.2 and 3.4).
 * Each test checks what the sync layer sees and what the database holds.
 * Includes the ports of the Postgres suite's paginated-fetch.test.ts (> 1000
 * rows), onconflict-pk-parity.test.ts (client conflict constants match the D1
 * keys) and pull-and-merge.test.ts (upsert conflict rule, card_type and locale
 * discriminators, seen_in_pasture one-way).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1, createTestUser, type SqliteD1 } from "./testing/sqliteD1";
import { createGatewayTestClient } from "./testing/gatewayClient";
import type { DataClient } from "./client";
import { TABLES } from "./tables";
import {
  CARD_REVIEWS_CONFLICT_COLS,
  hasCloudData,
  pullSession,
  pushSession,
  pushSingleCard,
} from "@/lib/sync/cloud";
import {
  pullLastResetAt,
  pullRegionalPrefs,
  pullSettingsWithTimestamp,
  pullUserSettingsRow,
  pushRegionalPrefs,
  pushSettings,
} from "@/lib/sync/settings";
import { pullStreak, pushStreak, STREAK_DAYS_CONFLICT_COLS } from "@/lib/sync/streak";
import { GRADE_LOG_CONFLICT_COLS, pullGradeLog, pushGradeLogDetailed } from "@/lib/sync/gradeLog";
import { pullPushSubscriptionCount } from "@/lib/sync/pushSubscriptions";
import { resetAllProgress } from "@/lib/sync/reset";
import { deleteAccount } from "@/lib/sync/deleteAccount";
import type { ReviewableCard } from "@/lib/review/session";
import type { GradeLogEntry } from "@/lib/gradelog/persistence";
import type { UserSettings } from "@/lib/settings/persistence";
import { initialReviewState, type ReviewState } from "@/lib/srs/scheduler";
import { isoDate } from "@/lib/utils/format-date";

let d1: SqliteD1;
let alice: string;
let db: DataClient;

beforeEach(() => {
  d1 = createSqliteD1();
  alice = createTestUser(d1);
  db = createGatewayTestClient(d1, alice);
});
afterEach(() => d1.close());

function daysAgo(n: number): string {
  return isoDate(new Date(Date.now() - n * 86_400_000));
}

function card(
  subjectKey: string,
  state: Partial<ReviewState>,
  extra: Partial<Pick<ReviewableCard, "cardType" | "locale">> = {},
): ReviewableCard {
  return {
    id: Number(subjectKey) || 1,
    cardType: "name",
    subjectKey,
    locale: "en",
    ...extra,
    state: { ...initialReviewState(), ...state },
  } as unknown as ReviewableCard;
}

function reviewed(reps: number, lastReviewDaysAgo: number): Partial<ReviewState> {
  return {
    stability: 5,
    difficulty: 5,
    elapsedDays: 1,
    scheduledDays: 7,
    reps,
    lapses: 0,
    fsrsState: "review",
    dueDate: daysAgo(lastReviewDaysAgo - 7),
    lastReview: daysAgo(lastReviewDaysAgo),
    firstSeen: daysAgo(lastReviewDaysAgo + 1),
  };
}

function cardRow(subjectKey: string, locale = "en", cardType = "name") {
  return d1.sqlite
    .prepare(
      "SELECT * FROM card_reviews WHERE user_id = ? AND card_type = ? AND subject_key = ? AND locale = ?",
    )
    .get(alice, cardType, subjectKey, locale) as Record<string, unknown> | undefined;
}

function count(table: string, userId = alice): number {
  return Number((d1.sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`).get(userId) as { n: number }).n);
}

describe("cards: pushSession, pushSingleCard, pullSession, hasCloudData", () => {
  it("round-trips cards with supabase-js shapes (booleans, numbers, ISO updated_at)", async () => {
    expect(await hasCloudData(db, alice)).toBe(false);
    expect(await pushSession(db, alice, [card("1", { ...reviewed(3, 5), seenInPasture: true }), card("4", reviewed(1, 2))])).toBe(true);
    expect(await hasCloudData(db, alice)).toBe(true);

    const rows = await pullSession(db, alice);
    expect(rows).toHaveLength(2);
    const one = rows!.find((r) => r.subject_key === "1")!;
    expect(one).toMatchObject({ card_type: "name", locale: "en", reps: 3, seen_in_pasture: true, stability: 5 });
    expect(typeof one.updated_at).toBe("string");
    expect(one.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("pushSingleCard: ok, then a regression is 'rejected' (23514) and the cloud row is unchanged", async () => {
    expect(await pushSingleCard(db, alice, card("25", reviewed(9, 2)))).toBe("ok");
    expect(await pushSingleCard(db, alice, card("25", reviewed(4, 30)))).toBe("rejected");
    expect(cardRow("25")?.reps).toBe(9);
    expect(await pushSingleCard(db, alice, card("25", reviewed(10, 0)))).toBe("ok");
    expect(cardRow("25")?.reps).toBe(10);
  });

  it("the server stamps updated_at; the client's clock is not sent", async () => {
    await pushSingleCard(db, alice, card("7", reviewed(1, 3)));
    const first = String(cardRow("7")?.updated_at);
    await new Promise((r) => setTimeout(r, 5));
    await pushSingleCard(db, alice, card("7", reviewed(2, 1)));
    expect(String(cardRow("7")?.updated_at) > first).toBe(true);
  });

  it("card_type and locale are part of the key (pull-and-merge discriminators)", async () => {
    await pushSession(db, alice, [
      card("1", reviewed(1, 3)),
      card("1", reviewed(2, 3), { locale: "ja" } as never),
      card("1", reviewed(3, 3), { cardType: "reverse" }),
    ]);
    const rows = await pullSession(db, alice);
    expect(rows!.map((r) => `${r.card_type}:${r.locale}:${r.reps}`).sort()).toEqual([
      "name:en:1",
      "name:ja:2",
      "reverse:en:3",
    ]);
  });

  it("seen_in_pasture is one way through an upsert (017)", async () => {
    await pushSingleCard(db, alice, card("9", { ...reviewed(1, 3), seenInPasture: true }));
    expect(await pushSingleCard(db, alice, card("9", { ...reviewed(1, 3), seenInPasture: false }))).toBe("rejected");
    expect(cardRow("9")?.seen_in_pasture).toBe(1);
  });

  it("pulls more than 1000 rows across pages, in a stable order (paginated-fetch port)", async () => {
    const cards = Array.from({ length: 1205 }, (_, i) => card(String(i + 1), reviewed(1, 3)));
    expect(await pushSession(db, alice, cards)).toBe(true);
    const rows = await pullSession(db, alice);
    expect(rows).toHaveLength(1205);
    expect(new Set(rows!.map((r) => r.subject_key)).size).toBe(1205);
  });

  it("the client's onConflict constants match the D1 conflict keys (onconflict-pk-parity port)", () => {
    const same = (cols: string, key: readonly string[]) => expect(cols.split(",").sort()).toEqual([...key].sort());
    same(CARD_REVIEWS_CONFLICT_COLS, TABLES.card_reviews.conflictKeys[0]);
    same(STREAK_DAYS_CONFLICT_COLS, TABLES.streak_days.conflictKeys[0]);
    same(GRADE_LOG_CONFLICT_COLS, TABLES.grade_log.conflictKeys[0]);
  });
});

describe("settings: merge RPC, regional prefs, last reset", () => {
  it("pushSettings deep-merges with nulls kept; pullSettingsWithTimestamp sees it", async () => {
    expect(await pushSettings(db, alice, { maxNewPerDay: 10, favouritePokemonId: 25 } as Partial<UserSettings>)).toBe(true);
    expect(await pushSettings(db, alice, { favouritePokemonId: null } as unknown as Partial<UserSettings>)).toBe(true);
    const pulled = await pullSettingsWithTimestamp(db, alice);
    expect(pulled?.settings).toEqual({ maxNewPerDay: 10, favouritePokemonId: null });
    expect(pulled?.updatedAt).toMatch(/Z$/);
  });

  it("a regressing settings push fails (23514) and leaves the row", async () => {
    await pushSettings(db, alice, { typedEntryOnboardingShown: true } as Partial<UserSettings>);
    expect(await pushSettings(db, alice, { typedEntryOnboardingShown: false } as Partial<UserSettings>)).toBe(false);
    expect((await pullSettingsWithTimestamp(db, alice))?.settings).toEqual({ typedEntryOnboardingShown: true });
  });

  it("regional prefs: update is a no-op without a row, then round-trips", async () => {
    const prefs = { timezone: "Europe/London", dateFormat: "dmy" as const, pushNotificationHour: 8 };
    expect(await pushRegionalPrefs(db, alice, prefs)).toBe(true);
    expect(await pullRegionalPrefs(db, alice)).toBeNull();
    await pushSettings(db, alice, {});
    expect(await pushRegionalPrefs(db, alice, prefs)).toBe(true);
    expect(await pullRegionalPrefs(db, alice)).toEqual(prefs);
  });

  it("pullLastResetAt and pullUserSettingsRow read the tombstone", async () => {
    expect(await pullLastResetAt(db, alice)).toEqual({ lastResetAt: null });
    expect(await resetAllProgress(db)).toBe(true);
    const reset = await pullLastResetAt(db, alice);
    expect(reset?.lastResetAt).toMatch(/Z$/);
    const row = await pullUserSettingsRow(db, alice);
    expect(row).toEqual({ settings: null, updatedAt: expect.any(String), lastResetAt: reset!.lastResetAt });
  });
});

describe("streak and grade log", () => {
  it("pushStreak ignores duplicates; pullStreak returns sorted dates", async () => {
    expect(await pushStreak(db, alice, [daysAgo(1), daysAgo(3)])).toBe(true);
    expect(await pushStreak(db, alice, [daysAgo(1), daysAgo(2)])).toBe(true);
    expect(await pullStreak(db, alice)).toEqual([daysAgo(3), daysAgo(2), daysAgo(1)]);
  });

  it("pushGradeLogDetailed: ok, duplicates ignored, a pre-reset entry is 'rejected'; pullGradeLog shape", async () => {
    const entry = (occurredAt: number, date: string, extra: Partial<GradeLogEntry> = {}): GradeLogEntry =>
      ({ occurredAt, date, cardType: "name", grade: 4, subjectKey: "25", locale: "en", ...extra }) as GradeLogEntry;
    expect(await pushGradeLogDetailed(db, alice, [entry(1000, daysAgo(2)), entry(2000, daysAgo(1), { learningStep: 1, stepStartedAt: 1999 })])).toBe("ok");
    expect(await pushGradeLogDetailed(db, alice, [entry(1000, daysAgo(2))])).toBe("ok");
    expect(count("grade_log")).toBe(2);

    const pulled = await pullGradeLog(db, alice);
    expect(pulled).toEqual([
      { occurredAt: 1000, date: daysAgo(2), cardType: "name", grade: 4, subjectKey: "25", locale: "en" },
      { occurredAt: 2000, date: daysAgo(1), cardType: "name", grade: 4, subjectKey: "25", locale: "en", learningStep: 1, stepStartedAt: 1999 },
    ]);

    expect(await resetAllProgress(db)).toBe(true);
    expect(await pushGradeLogDetailed(db, alice, [entry(3000, daysAgo(5))])).toBe("rejected");
  });

  it("a network failure is 'failed', never 'rejected' (the queue keeps the entry)", async () => {
    const offline = createGatewayTestClient(d1, alice, { fail: () => true });
    expect(
      await pushGradeLogDetailed(offline, alice, [
        { occurredAt: 1, date: daysAgo(0), cardType: "name", grade: 4, subjectKey: "1", locale: "en" } as GradeLogEntry,
      ]),
    ).toBe("failed");
    expect(await pushSingleCard(offline, alice, card("1", reviewed(1, 1)))).toBe("failed");
    expect(await pullSession(offline, alice)).toBeNull();
  });
});

describe("push subscriptions, reset, delete", () => {
  it("pullPushSubscriptionCount counts the caller's rows", async () => {
    expect(await pullPushSubscriptionCount(db, alice)).toBe(0);
    const { error } = await db.from("push_subscriptions").insert({
      user_id: alice,
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      p256dh: "k",
      auth_secret: "s",
      last_seen_at: new Date().toISOString(),
    });
    expect(error).toBeNull();
    expect(await pullPushSubscriptionCount(db, alice)).toBe(1);
  });

  it("resetAllProgress clears cards, streak and grade log, keeps settings, and honours the cooldown", async () => {
    await pushSession(db, alice, [card("1", reviewed(1, 3))]);
    await pushStreak(db, alice, [daysAgo(1)]);
    await pushSettings(db, alice, { maxNewPerDay: 12 } as Partial<UserSettings>);
    expect(await resetAllProgress(db)).toBe(true);
    expect(count("card_reviews") + count("streak_days") + count("grade_log")).toBe(0);
    expect((await pullSettingsWithTimestamp(db, alice))?.settings).toEqual({ maxNewPerDay: 12 });
    // Within 5 s: P0001, reported as a failure.
    expect(await resetAllProgress(db)).toBe(false);
  });

  it("deleteAccount removes every row and the user", async () => {
    await pushSession(db, alice, [card("1", reviewed(1, 3))]);
    await pushSettings(db, alice, { maxNewPerDay: 12 } as Partial<UserSettings>);
    expect(await deleteAccount(db)).toBe(true);
    for (const table of ["card_reviews", "user_settings", "streak_days", "grade_log", "push_subscriptions"]) {
      expect(count(table)).toBe(0);
    }
    expect(d1.sqlite.prepare(`SELECT count(*) AS n FROM "user" WHERE id = ?`).get(alice)).toEqual({ n: 0 });
  });
});
