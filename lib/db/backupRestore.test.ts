/**
 * A signed-in backup restore never lowers the cloud (#2218), on D1.
 *
 * Ported from the Postgres suite (lib/sync/integration/backup-restore.test.ts):
 * runs the real restore, real pullAndMerge and real push code through the real
 * data client and gateway over the D1 test database, so the regression
 * trigger, the pre-reset trigger, reset_all_progress and the settings guard
 * are the real ones. The browser is an in-memory localStorage; IndexedDB is
 * reported unavailable, so the session takes its localStorage fallback path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSqliteD1, createTestUser, type SqliteD1 } from "./testing/sqliteD1";
import { createGatewayTestClient } from "./testing/gatewayClient";
import type { DataClient } from "./client";
import { mergeUserSettings } from "./rpc/mergeUserSettings";
import { restoreBackupSignedIn } from "@/lib/sync/restoreBackup";
import { pullAndMerge } from "@/lib/sync/pullAndMerge";
import { isFurtherOn, pushSingleCard, type CloudRow } from "@/lib/sync/cloud";
import { loadPendingQueue, savePendingQueue } from "@/lib/sync/persistence";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { DEFAULT_LIMITS, type ReviewableCard } from "@/lib/review/session";
import { DEFAULT_SETTINGS } from "@/lib/settings/persistence";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import { initialReviewState, type ReviewState } from "@/lib/srs/scheduler";
import { isoDate } from "@/lib/utils/format-date";
import { Subject } from "@/lib/cards/subjectKey";
import { forUser } from "./scope";

vi.mock("@/lib/idb/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/idb/db")>()),
  isIdbAvailable: () => false,
  idbGet: async () => null,
  idbSet: async () => undefined,
  idbDelete: async () => undefined,
}));

// In a browser the seed comes over fetch; here it comes from the same data on disk.
vi.mock("@/lib/pokemon/seed-async", async (importOriginal) => {
  const { SEED_POKEMON, SEED_EVOLUTION_CARDS } = await import("@/lib/pokemon/seed");
  return {
    ...(await importOriginal<typeof import("@/lib/pokemon/seed-async")>()),
    loadSeed: async () => ({
      seedPokemon: SEED_POKEMON,
      seedEvolutionCards: SEED_EVOLUTION_CARDS,
    }),
  };
});

let d1: SqliteD1;

// ─── Dates ────────────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  return isoDate(new Date(Date.now() - n * 86_400_000));
}

// ─── The cloud: the real data client and gateway over D1 ──────────────────────

type CloudFailure = "pull" | "push" | "settings-read";

function cloudAs(userId: string, fail?: CloudFailure): DataClient {
  return createGatewayTestClient(d1, userId, {
    fail: (q) =>
      (fail === "push" && q.kind === "upsert") ||
      (fail === "pull" && q.kind === "select") ||
      (fail === "settings-read" && q.kind === "select" && q.table === "user_settings"),
  });
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

function card(id: number, state: Partial<ReviewState>): ReviewableCard {
  const pokemon = SEED_POKEMON.find((p) => p.id === id)!;
  return {
    ...pokemon,
    cardType: "name",
    subjectKey: Subject.forSpecies(id),
    locale: "en",
    state: { ...initialReviewState(), ...state },
  } as unknown as ReviewableCard;
}

function backupOf(cards: ReviewableCard[]) {
  return { cards, limits: DEFAULT_LIMITS, settings: DEFAULT_SETTINGS };
}

async function readRow(userId: string, id: number): Promise<CloudRow | null> {
  const [row] = await forUser(d1, userId).select("card_reviews", {
    filters: [
      { column: "card_type", op: "eq", value: "name" },
      { column: "subject_key", op: "eq", value: Subject.forSpecies(id) },
      { column: "locale", op: "eq", value: "en" },
    ],
  });
  return (row as CloudRow | undefined) ?? null;
}

async function localCard(id: number): Promise<ReviewableCard | undefined> {
  const session = await loadSession();
  return session?.cards.find((c) => c.subjectKey === Subject.forSpecies(id));
}

// A user, a device with some history on it and a cloud that has moved on.
async function newUser(): Promise<string> {
  return createTestUser(d1);
}

/** Puts `cards` in the cloud through the real push path, then on this device through a real pull. */
async function signedInWith(userId: string, cards: ReviewableCard[]): Promise<void> {
  const client = cloudAs(userId);
  for (const c of cards) {
    expect(await pushSingleCard(client, userId, c)).toBe("ok");
  }
  expect(await pullAndMerge(client, userId)).toBe("ok");
}

function freshDevice() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  vi.stubGlobal("window", {
    localStorage,
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  vi.stubGlobal("localStorage", localStorage);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  d1 = createSqliteD1();
  freshDevice();
});

afterEach(() => {
  vi.unstubAllGlobals();
  d1.close();
});

// ─── The outcome ──────────────────────────────────────────────────────────────

describe("signed-in backup restore moves cards forward only", () => {
  it("an older backup changes nothing: the cloud row and this device both stay ahead", async () => {
    const userId = await newUser();
    await signedInWith(userId, [card(1, reviewed(9, 2))]);
    const before = await readRow(userId, 1);

    const result = await restoreBackupSignedIn(
      cloudAs(userId),
      userId,
      backupOf([card(1, reviewed(4, 30))]),
    );

    expect(result).toEqual({ ok: true });
    expect(await readRow(userId, 1)).toEqual(before);
    expect((await localCard(1))?.state.reps).toBe(9);
    expect((await localCard(1))?.state.lastReview).toBe(daysAgo(2));
  });

  it("the next grade after restoring an older backup reaches the cloud", async () => {
    const userId = await newUser();
    await signedInWith(userId, [card(1, reviewed(9, 2))]);

    await restoreBackupSignedIn(cloudAs(userId), userId, backupOf([card(1, reviewed(4, 30))]));
    expect(await pullAndMerge(cloudAs(userId), userId)).toBe("ok");

    // What a grade does to whatever copy this device now holds.
    const held = (await localCard(1))!;
    const graded = {
      ...held,
      state: { ...held.state, reps: held.state.reps + 1, lastReview: daysAgo(0) },
    };
    expect(await pushSingleCard(cloudAs(userId), userId, graded)).toBe("ok");
    expect((await readRow(userId, 1))?.reps).toBe(10);
  });

  it("a backup ahead of the cloud moves the cloud on, and another device gets it", async () => {
    const userId = await newUser();
    await signedInWith(userId, [card(1, reviewed(4, 30))]);

    const result = await restoreBackupSignedIn(
      cloudAs(userId),
      userId,
      backupOf([card(1, reviewed(9, 2))]),
    );

    expect(result).toEqual({ ok: true });
    expect((await readRow(userId, 1))?.reps).toBe(9);
    expect((await localCard(1))?.state.reps).toBe(9);

    freshDevice();
    expect(await pullAndMerge(cloudAs(userId), userId)).toBe("ok");
    expect((await localCard(1))?.state.reps).toBe(9);
  });

  it("a card the cloud has never seen is added to it", async () => {
    const userId = await newUser();
    await signedInWith(userId, [card(1, reviewed(4, 30))]);

    await restoreBackupSignedIn(cloudAs(userId), userId, backupOf([card(2, reviewed(3, 10))]));

    expect((await readRow(userId, 2))?.reps).toBe(3);
    expect((await readRow(userId, 1))?.reps).toBe(4);
  });

  it("a grade still waiting to sync survives a restore of an older copy, and still syncs", async () => {
    const userId = await newUser();
    await signedInWith(userId, [card(1, reviewed(4, 30))]);
    const waiting = card(1, reviewed(5, 0));
    const session = (await loadSession())!;
    await saveSession({
      cards: session.cards.map((c) => (c.subjectKey === waiting.subjectKey ? waiting : c)),
      limits: session.limits,
    });
    savePendingQueue([waiting]);

    await restoreBackupSignedIn(cloudAs(userId), userId, backupOf([card(1, reviewed(3, 40))]));

    expect((await localCard(1))?.state.reps).toBe(5);
    expect(loadPendingQueue().map((c) => c.state.reps)).toEqual([5]);
    expect(await pushSingleCard(cloudAs(userId), userId, loadPendingQueue()[0])).toBe("ok");
    expect((await readRow(userId, 1))?.reps).toBe(5);
  });

  it("after a reset, cards from before it stay out, so this device and the cloud agree", async () => {
    const userId = await newUser();
    const client = cloudAs(userId);
    await signedInWith(userId, [card(1, reviewed(4, 30))]);
    expect((await client.rpc("reset_all_progress")).error).toBeNull();
    expect(await pullAndMerge(client, userId)).toBe("ok");

    await restoreBackupSignedIn(client, userId, backupOf([card(1, reviewed(4, 30))]));

    expect(await readRow(userId, 1)).toBeNull();
    expect((await localCard(1))?.state.lastReview ?? null).toBeNull();
  });

  it("a failed read of the last reset stops the restore, so a card from before it is not stranded", async () => {
    const userId = await newUser();
    const client = cloudAs(userId);
    await signedInWith(userId, [card(1, reviewed(4, 30))]);
    expect((await client.rpc("reset_all_progress")).error).toBeNull();
    expect(await pullAndMerge(client, userId)).toBe("ok");

    const result = await restoreBackupSignedIn(
      cloudAs(userId, "settings-read"),
      userId,
      backupOf([card(1, reviewed(4, 30))]),
    );

    expect(result).toEqual({ ok: false, reason: "pull-failed" });
    expect((await localCard(1))?.state.lastReview ?? null).toBeNull();
    expect(loadPendingQueue()).toEqual([]);
  });

  it("a pull failure changes nothing on this device or in the cloud", async () => {
    const userId = await newUser();
    await signedInWith(userId, [card(1, reviewed(4, 30))]);
    const before = await readRow(userId, 1);

    const result = await restoreBackupSignedIn(
      cloudAs(userId, "pull"),
      userId,
      backupOf([card(1, reviewed(9, 2))]),
    );

    expect(result).toEqual({ ok: false, reason: "pull-failed" });
    expect(await readRow(userId, 1)).toEqual(before);
    expect((await localCard(1))?.state.reps).toBe(4);
  });

  it("a push failure leaves the restored cards queued for the normal retry", async () => {
    const userId = await newUser();
    await signedInWith(userId, [card(1, reviewed(4, 30))]);

    const result = await restoreBackupSignedIn(
      cloudAs(userId, "push"),
      userId,
      backupOf([card(1, reviewed(9, 2))]),
    );

    expect(result).toEqual({ ok: true });
    expect((await localCard(1))?.state.reps).toBe(9);
    expect(loadPendingQueue().map((c) => c.state.reps)).toEqual([9]);
    expect(await pushSingleCard(cloudAs(userId), userId, loadPendingQueue()[0])).toBe("ok");
    expect((await readRow(userId, 1))?.reps).toBe(9);
  });
});

// ─── isFurtherOn must keep matching the real trigger ──────────────────────────

describe("isFurtherOn against card_reviews_reject_regression", () => {
  const BASE: Partial<CloudRow> = {
    stability: 5,
    difficulty: 5,
    elapsed_days: 1,
    scheduled_days: 7,
    reps: 4,
    lapses: 1,
    fsrs_state: "review",
    due_date: daysAgo(3),
    last_review: daysAgo(10),
    first_seen: daysAgo(20),
    hidden_since: null,
    seen_in_pasture: true,
  };

  // Each case is a change from BASE, and whether the trigger should let it through.
  const CASES: [string, Partial<CloudRow>, boolean][] = [
    ["last_review advances", { last_review: daysAgo(5) }, true],
    ["last_review goes back", { last_review: daysAgo(15) }, false],
    ["last_review cleared", { last_review: null, first_seen: daysAgo(20) }, false],
    ["first_seen cleared", { first_seen: null }, false],
    ["reps rise", { reps: 5 }, true],
    ["reps fall", { reps: 3 }, false],
    ["lapses rise", { lapses: 2 }, true],
    ["lapses fall", { lapses: 0 }, false],
    ["scheduled_days rise on the same date", { scheduled_days: 8 }, true],
    ["scheduled_days fall on the same date", { scheduled_days: 6 }, false],
    ["scheduled_days fall as last_review advances", { scheduled_days: 1, last_review: daysAgo(5) }, true],
    ["seen_in_pasture cleared", { seen_in_pasture: false }, false],
    ["later date with fewer reps", { last_review: daysAgo(5), reps: 3 }, false],
  ];

  it.each(CASES)("%s", async (_name, change, accepted) => {
    const userId = await newUser();
    const client = cloudAs(userId);
    const identity = { user_id: userId, card_type: "name", subject_key: "1", locale: "en" };
    const base = { ...BASE, card_type: "name", subject_key: "1", locale: "en" } as CloudRow;
    const onConflict = "user_id,card_type,subject_key,locale";

    const seeded = await client.from("card_reviews").upsert({ ...BASE, ...identity }, { onConflict });
    expect(seeded.error).toBeNull();

    const next = { ...base, ...change };
    const { error } = await client
      .from("card_reviews")
      .upsert({ ...BASE, ...change, ...identity }, { onConflict });

    expect(error === null ? "accepted" : (error as { code: string }).code).toBe(
      accepted ? "accepted" : "23514",
    );
    expect(isFurtherOn(next, base)).toBe(accepted);
  });

  it("an identical copy is not further on, though the trigger would accept it", () => {
    const row = { ...BASE, card_type: "name", subject_key: "1", locale: "en" } as CloudRow;
    expect(isFurtherOn(row, row)).toBe(false);
  });
});

// ─── Why settings stay out of a signed-in restore ─────────────────────────────

describe("restoring older settings, as the database stands", () => {
  it("one lowered guarded field gets the whole patch refused, later changes included", async () => {
    const userId = await newUser();
    d1.sqlite
      .prepare("INSERT INTO user_settings (user_id, settings) VALUES (?, ?)")
      .run(userId, JSON.stringify({ typedEntryOnboardingShown: true, maxNewPerDay: 10 }));
    await expect(
      mergeUserSettings(d1, userId, { typedEntryOnboardingShown: false, maxNewPerDay: 20 }),
    ).rejects.toMatchObject({ code: "23514" });
    const row = d1.sqlite.prepare("SELECT settings FROM user_settings WHERE user_id = ?").get(userId) as {
      settings: string;
    };
    expect(JSON.parse(row.settings).maxNewPerDay).toBe(10);
  });
});

// ─── Why replacing the cloud is not on offer without a new bypass ─────────────

describe("replacing the cloud from a backup, as the database stands", () => {
  it("resetting first and then pushing the backup is refused by the pre-reset trigger", async () => {
    const userId = await newUser();
    const client = cloudAs(userId);
    await signedInWith(userId, [card(1, reviewed(4, 30))]);
    expect((await client.rpc("reset_all_progress")).error).toBeNull();

    expect(await pushSingleCard(client, userId, card(1, reviewed(4, 30)))).toBe("rejected");
    expect(await readRow(userId, 1)).toBeNull();
  });

  it("a card from before a reset is still refused after a new grade", async () => {
    const userId = await newUser();
    const client = cloudAs(userId);
    await signedInWith(userId, [card(1, reviewed(4, 30))]);
    expect((await client.rpc("reset_all_progress")).error).toBeNull();

    const regraded = card(1, { ...reviewed(5, 0), firstSeen: daysAgo(31) });
    expect(await pushSingleCard(client, userId, regraded)).toBe("rejected");
  });

  it("pushing a lower copy over a cloud row is refused by the regression trigger", async () => {
    const userId = await newUser();
    await signedInWith(userId, [card(1, reviewed(9, 2))]);

    expect(await pushSingleCard(cloudAs(userId), userId, card(1, reviewed(4, 30)))).toBe("rejected");
    expect((await readRow(userId, 1))?.reps).toBe(9);
  });
});
