/**
 * merge_user_settings on D1 (lib/db/rpc/mergeUserSettings.ts), ported from the
 * Postgres suite: lib/sync/integration/user-settings-regression.test.ts (038
 * guard, REJECT and ALLOW cases with the same old/new pairs),
 * settings-clobber.test.ts (#1682) and favourite-settings.test.ts (#2187),
 * plus the deep-merge semantics of 036/037 and the compare-and-swap retry.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1, createTestUser, type SqliteD1 } from "../testing/sqliteD1";
import type { D1DatabaseLike, D1PreparedStatementLike } from "../d1";
import { DbError } from "../errors";
import { OPTIMIZER_COOLDOWN_MS } from "@/lib/srs/optimizer";
import { diffSettings } from "@/lib/settings/lastPushedSnapshot";
import { DEFAULT_SETTINGS, type UserSettings } from "@/lib/settings/persistence";
import {
  assertNoSettingsRegression,
  jsonDeepMerge,
  mergeUserSettings,
  MERGE_MAX_ATTEMPTS,
  ONBOARDING_ONE_SHOT_FLAGS,
  type Json,
} from "./mergeUserSettings";

let d1: SqliteD1;
let userId: string;

beforeEach(() => {
  d1 = createSqliteD1();
  userId = createTestUser(d1);
});
afterEach(() => d1.close());

function seed(settings: Record<string, unknown>, updatedAt = "2026-11-01T00:00:00.000Z"): void {
  d1.sqlite
    .prepare("INSERT INTO user_settings (user_id, settings, updated_at) VALUES (?, ?, ?)")
    .run(userId, JSON.stringify(settings), updatedAt);
}

function stored(id = userId): { settings: Record<string, unknown>; updated_at: string } | null {
  const row = d1.sqlite.prepare("SELECT settings, updated_at FROM user_settings WHERE user_id = ?").get(id) as
    | { settings: string; updated_at: string }
    | undefined;
  return row ? { settings: JSON.parse(row.settings), updated_at: row.updated_at } : null;
}

const ZERO_STREAK = {
  balance: 0,
  spendDates: [] as string[],
  daysSinceLastEarn: 0,
  lastEarnCheckDate: null,
  protectionEvents: [],
  lastAcknowledgedProtectionEventDate: null,
};

const BASE = {
  streakProtection: ZERO_STREAK,
  earnedBadges: [] as unknown[],
  onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 } as Record<string, unknown>,
  learningLocales: ["en"],
  removedLocales: [] as string[],
};

function rejection(oldS: unknown, newS: unknown): DbError {
  try {
    assertNoSettingsRegression(oldS as Json, newS as Json);
  } catch (err) {
    return err as DbError;
  }
  throw new Error("expected a 23514 rejection");
}

describe("jsonb_deep_merge semantics (036)", () => {
  it("recurses into objects on both sides and keeps siblings", () => {
    expect(jsonDeepMerge({ a: { b: 1, c: 2 }, d: 3 }, { a: { b: 9 } })).toEqual({ a: { b: 9, c: 2 }, d: 3 });
  });
  it("a null in the patch SETS the key to null (json_patch would delete it)", () => {
    expect(jsonDeepMerge({ a: 1, b: { c: 2 } }, { a: null, b: { c: null } })).toEqual({ a: null, b: { c: null } });
  });
  it("arrays replace wholesale", () => {
    expect(jsonDeepMerge({ a: [1, 2, 3] }, { a: [3] })).toEqual({ a: [3] });
  });
  it("an object replaces a scalar and a scalar replaces an object", () => {
    expect(jsonDeepMerge({ a: 1, b: { c: 1 } }, { a: { x: 1 }, b: 2 })).toEqual({ a: { x: 1 }, b: 2 });
  });
  it("a null or non-object base starts from {}", () => {
    expect(jsonDeepMerge(null, { a: 1 })).toEqual({ a: 1 });
    expect(jsonDeepMerge([1], { a: 1 })).toEqual({ a: 1 });
  });
});

describe("mergeUserSettings: insert, merge, compare-and-swap (011, 014, 037)", () => {
  it("inserts the patch as the row when there is none, nulls kept", async () => {
    await mergeUserSettings(d1, userId, { maxNewPerDay: 10, favouritePokemonId: null });
    expect(stored()?.settings).toEqual({ maxNewPerDay: 10, favouritePokemonId: null });
  });

  it("a null patch is {} (COALESCE)", async () => {
    await mergeUserSettings(d1, userId, null);
    expect(stored()?.settings).toEqual({});
  });

  it("deep-merges into the stored row and moves updated_at forward", async () => {
    seed({ ...BASE, onboarding: { firstVisitOnboardingDismissed: true, statsHintDismissed: false, practiceSessionsCount: 5 } });
    const before = stored()!.updated_at;
    await mergeUserSettings(d1, userId, { onboarding: { statsHintDismissed: true } });
    const after = stored()!;
    expect(after.settings.onboarding).toEqual({
      firstVisitOnboardingDismissed: true,
      statsHintDismissed: true,
      practiceSessionsCount: 5,
    });
    expect(after.updated_at > before).toBe(true);
  });

  it("updated_at moves strictly forward even when the stored value is ahead of the clock", async () => {
    seed({}, "2999-01-01T00:00:00.000Z");
    await mergeUserSettings(d1, userId, { a: 1 });
    expect(stored()!.updated_at).toBe("2999-01-01T00:00:00.001Z");
  });

  it("refuses a patch that is not an object with 22P02", async () => {
    await expect(mergeUserSettings(d1, userId, [1, 2] as Json)).rejects.toMatchObject({ code: "22P02" });
    expect(stored()).toBeNull();
  });

  it("touches only the caller's row", async () => {
    const other = createTestUser(d1);
    seed({ a: 1 });
    d1.sqlite.prepare("INSERT INTO user_settings (user_id, settings) VALUES (?, ?)").run(other, '{"a":1}');
    await mergeUserSettings(d1, userId, { a: 2 });
    expect(stored()!.settings).toEqual({ a: 2 });
    expect(stored(other)!.settings).toEqual({ a: 1 });
  });

  it("retries when another write wins the race, and merges onto the newer row", async () => {
    seed({ a: 1 });
    let raced = false;
    const racing: D1DatabaseLike = {
      ...d1,
      prepare(sql: string): D1PreparedStatementLike {
        const statement = d1.prepare(sql);
        if (!raced && sql.startsWith("UPDATE user_settings")) {
          raced = true;
          // Another device's merge lands between our read and our write.
          d1.sqlite
            .prepare("UPDATE user_settings SET settings = ?, updated_at = ? WHERE user_id = ?")
            .run('{"a":1,"b":2}', "2026-11-02T00:00:00.000Z", userId);
        }
        return statement;
      },
    };
    await mergeUserSettings(racing, userId, { c: 3 });
    expect(stored()!.settings).toEqual({ a: 1, b: 2, c: 3 });
  });

  it(`gives up with 40001 after ${MERGE_MAX_ATTEMPTS} lost races`, async () => {
    seed({ a: 1 });
    let n = 0;
    const alwaysRaced: D1DatabaseLike = {
      ...d1,
      prepare(sql: string): D1PreparedStatementLike {
        const statement = d1.prepare(sql);
        if (sql.startsWith("UPDATE user_settings")) {
          n++;
          d1.sqlite
            .prepare("UPDATE user_settings SET updated_at = ? WHERE user_id = ?")
            .run(`2026-11-02T00:00:00.${String(n).padStart(3, "0")}Z`, userId);
        }
        return statement;
      },
    };
    await expect(mergeUserSettings(alwaysRaced, userId, { c: 3 })).rejects.toMatchObject({ code: "40001" });
    expect(n).toBe(MERGE_MAX_ATTEMPTS);
    expect(stored()!.settings).toEqual({ a: 1 });
  });
});

describe("038 guard: REJECT (ported from user-settings-regression.test.ts)", () => {
  it("removes a spendDate", () => {
    const err = rejection(
      { ...BASE, streakProtection: { ...ZERO_STREAK, spendDates: ["2026-05-01"] } },
      { ...BASE, streakProtection: { ...ZERO_STREAK, spendDates: [] } },
    );
    expect(err).toBeInstanceOf(DbError);
    expect(err.code).toBe("23514");
    expect(err.message).toBe("user_settings regression: spendDate 2026-05-01 removed from streakProtection");
  });

  it("drops balance without adding a new spendDate", () => {
    const err = rejection(
      { ...BASE, streakProtection: { ...ZERO_STREAK, balance: 2, spendDates: ["2026-05-01"] } },
      { ...BASE, streakProtection: { ...ZERO_STREAK, balance: 1, spendDates: ["2026-05-01"] } },
    );
    expect(err.message).toBe(
      "user_settings regression: streakProtection.balance dropped (2 -> 1) without new spendDate",
    );
  });

  it("removes an earnedBadge by id", () => {
    const err = rejection(
      { ...BASE, earnedBadges: [{ id: "badge-1", earnedAt: "2026-05-01T00:00:00Z" }] },
      { ...BASE, earnedBadges: [] },
    );
    expect(err.message).toBe("user_settings regression: earnedBadge id badge-1 removed");
  });

  it("swaps an earnedBadge id (same array length, different id)", () => {
    const err = rejection(
      { ...BASE, earnedBadges: [{ id: "badge-1" }] },
      { ...BASE, earnedBadges: [{ id: "badge-2" }] },
    );
    expect(err.message).toBe("user_settings regression: earnedBadge id badge-1 removed");
  });

  it("sets an onboarding flag from true to false", () => {
    const err = rejection(
      { ...BASE, onboarding: { ...BASE.onboarding, welcomeDismissed: true } },
      { ...BASE, onboarding: { ...BASE.onboarding, welcomeDismissed: false } },
    );
    expect(err.message).toBe("user_settings regression: onboarding.welcomeDismissed was true, cannot be set to non-true");
  });

  it("removes an onboarding flag that was true (absent = non-true)", () => {
    const err = rejection(
      { ...BASE, onboarding: { ...BASE.onboarding, practiceHintDismissed: true } },
      { ...BASE, onboarding: { ...BASE.onboarding } },
    );
    expect(err.code).toBe("23514");
  });

  it("guards every listed onboarding flag", () => {
    for (const flag of ONBOARDING_ONE_SHOT_FLAGS) {
      const err = rejection({ onboarding: { [flag]: true } }, { onboarding: { [flag]: false } });
      expect(err.message).toContain(`onboarding.${flag} was true`);
    }
  });

  it("decreases practiceSessionsCount", () => {
    const err = rejection(
      { ...BASE, onboarding: { practiceSessionsCount: 5, slowSpriteLoadCount: 0 } },
      { ...BASE, onboarding: { practiceSessionsCount: 4, slowSpriteLoadCount: 0 } },
    );
    expect(err.message).toBe("user_settings regression: onboarding.practiceSessionsCount decreased (5 -> 4)");
  });

  it("decreases slowSpriteLoadCount", () => {
    const err = rejection(
      { ...BASE, onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 3 } },
      { ...BASE, onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 1 } },
    );
    expect(err.message).toBe("user_settings regression: onboarding.slowSpriteLoadCount decreased (3 -> 1)");
  });

  it("removes a learningLocale without a tombstone", () => {
    const err = rejection({ ...BASE, learningLocales: ["en", "ja"] }, { ...BASE, learningLocales: ["en"] });
    expect(err.message).toBe("user_settings regression: learningLocale ja removed without tombstone in removedLocales");
  });

  it("sets typedEntryOnboardingShown from true to false", () => {
    const err = rejection({ ...BASE, typedEntryOnboardingShown: true }, { ...BASE, typedEntryOnboardingShown: false });
    expect(err.message).toBe(
      "user_settings regression: top-level flag typedEntryOnboardingShown was true, cannot be set to non-true",
    );
  });

  it("sets mcCardOnboardingShown from true to false, even with a newer onboardingResetAt", () => {
    const err = rejection(
      { ...BASE, mcCardOnboardingShown: true },
      { ...BASE, mcCardOnboardingShown: false, onboardingResetAt: "2026-06-01T00:00:00Z" },
    );
    expect(err.message).toContain("top-level flag mcCardOnboardingShown");
  });

  it("nulls streakProtection (absent streakProtection with existing spend dates)", () => {
    const old = {
      ...BASE,
      streakProtection: { ...ZERO_STREAK, balance: 3, spendDates: ["2026-05-01", "2026-05-10"] },
    };
    const without: Record<string, unknown> = { ...old };
    delete without.streakProtection;
    expect(rejection(old, without).code).toBe("23514");
  });

  it("rejects onboarding flag reset when onboardingResetAt is absent (no tombstone)", () => {
    expect(
      rejection(
        { ...BASE, onboarding: { ...BASE.onboarding, welcomeDismissed: true } },
        { ...BASE, onboarding: { ...BASE.onboarding, welcomeDismissed: false } },
      ).code,
    ).toBe("23514");
  });

  it("rejects onboarding flag reset when onboardingResetAt is the same as existing (not strictly newer)", () => {
    const at = "2026-05-01T00:00:00Z";
    expect(
      rejection(
        { ...BASE, onboardingResetAt: at, onboarding: { ...BASE.onboarding, welcomeDismissed: true } },
        { ...BASE, onboardingResetAt: at, onboarding: { ...BASE.onboarding, welcomeDismissed: false } },
      ).code,
    ).toBe("23514");
  });

  it("text that is not a boolean in a guarded flag raises 22P02, as the ::boolean cast did", () => {
    expect(rejection({ onboarding: { welcomeDismissed: "maybe" } }, {}).code).toBe("22P02");
  });
});

describe("038 guard: ALLOW (ported from user-settings-regression.test.ts)", () => {
  const allowed = (oldS: unknown, newS: unknown) => expect(() => assertNoSettingsRegression(oldS as Json, newS as Json)).not.toThrow();

  it("dismissing more onboarding flags", () => {
    allowed(
      { ...BASE, onboarding: { ...BASE.onboarding, welcomeDismissed: true } },
      { ...BASE, onboarding: { ...BASE.onboarding, welcomeDismissed: true, statsHintDismissed: true } },
    );
  });
  it("a token spend: balance decreases AND a new spendDate is added", () => {
    allowed(
      { ...BASE, streakProtection: { ...ZERO_STREAK, balance: 2, spendDates: ["2026-05-01"] } },
      { ...BASE, streakProtection: { ...ZERO_STREAK, balance: 1, spendDates: ["2026-05-01", "2026-05-02"] } },
    );
  });
  it("a token earn: balance increases", () => {
    allowed(
      { ...BASE, streakProtection: { ...ZERO_STREAK, balance: 1 } },
      { ...BASE, streakProtection: { ...ZERO_STREAK, balance: 2 } },
    );
  });
  it("earning a badge", () => {
    allowed({ ...BASE, earnedBadges: [{ id: "a" }] }, { ...BASE, earnedBadges: [{ id: "a" }, { id: "b" }] });
  });
  it("removing a learningLocale WITH a tombstone in removedLocales", () => {
    allowed(
      { ...BASE, learningLocales: ["en", "ja"] },
      { ...BASE, learningLocales: ["en"], removedLocales: ["ja"] },
    );
  });
  it("increasing a monotonic counter", () => {
    allowed(
      { ...BASE, onboarding: { practiceSessionsCount: 1, slowSpriteLoadCount: 0 } },
      { ...BASE, onboarding: { practiceSessionsCount: 2, slowSpriteLoadCount: 0 } },
    );
  });
  it("a settings-unchanged write (regional-prefs style no-op)", () => {
    allowed(BASE, structuredClone(BASE));
  });
  it("additive restore: re-add a spendDate and raise balance", () => {
    allowed(
      { ...BASE, streakProtection: { ...ZERO_STREAK, balance: 0, spendDates: [] } },
      { ...BASE, streakProtection: { ...ZERO_STREAK, balance: 1, spendDates: ["2026-05-01"] } },
    );
  });
  it("additive restore: re-earn a badge and re-dismiss an onboarding flag", () => {
    allowed(BASE, { ...BASE, earnedBadges: [{ id: "a" }], onboarding: { ...BASE.onboarding, welcomeDismissed: true } });
  });
  it("additive restore: a row with absent streakProtection in old and new", () => {
    const noStreak: Record<string, unknown> = { ...BASE };
    delete noStreak.streakProtection;
    allowed(noStreak, { ...noStreak, masteryRepetitions: 4 });
  });
  it("onboarding flag reset and counter reset when onboardingResetAt is strictly newer", () => {
    allowed(
      {
        ...BASE,
        onboardingResetAt: "2026-05-01T00:00:00Z",
        onboarding: { welcomeDismissed: true, practiceSessionsCount: 9, slowSpriteLoadCount: 2 },
      },
      {
        ...BASE,
        onboardingResetAt: "2026-06-01T00:00:00Z",
        onboarding: { welcomeDismissed: false, practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
      },
    );
  });
  it("additive restore: a pre-#1484 row with absent learningLocales", () => {
    allowed({ earnedBadges: [], onboarding: {} }, { earnedBadges: [], onboarding: {}, masteryRepetitions: 3 });
  });
});

describe("038 guard inside the merge", () => {
  it("a regressing merge is refused with 23514 and the row is unchanged", async () => {
    seed({ ...BASE, streakProtection: { ...ZERO_STREAK, balance: 1, spendDates: ["2026-05-10"] } });
    const before = stored();
    await expect(
      mergeUserSettings(d1, userId, { streakProtection: { ...ZERO_STREAK, spendDates: [] } }),
    ).rejects.toMatchObject({ code: "23514" });
    expect(stored()).toEqual(before);
  });

  it("the insert path is not guarded (the trigger was BEFORE UPDATE only)", async () => {
    await mergeUserSettings(d1, userId, { onboarding: { welcomeDismissed: false } });
    expect(stored()!.settings).toEqual({ onboarding: { welcomeDismissed: false } });
  });
});

describe("the optimiser's weekly limit inside the merge", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const RUN = "2026-11-10T09:00:00.000Z";
  const after = (ms: number) => new Date(Date.parse(RUN) + ms).toISOString();
  const run = (at: string) => ({ fsrsWeights: [0.1, 0.2], fsrsWeightsOptimizedAt: at });

  it("a second run less than a week after the stored one is refused with 23514 and the row is unchanged", async () => {
    seed({ ...BASE, ...run(RUN) });
    const before = stored();
    await expect(mergeUserSettings(d1, userId, run(after(3 * DAY)))).rejects.toMatchObject({ code: "23514" });
    await expect(mergeUserSettings(d1, userId, run(after(OPTIMIZER_COOLDOWN_MS - 1)))).rejects.toMatchObject({
      code: "23514",
    });
    expect(stored()).toEqual(before);
  });

  it("a run a week or more after the stored one is accepted", async () => {
    seed({ ...BASE, ...run(RUN) });
    await mergeUserSettings(d1, userId, run(after(OPTIMIZER_COOLDOWN_MS)));
    expect(stored()!.settings.fsrsWeightsOptimizedAt).toBe(after(OPTIMIZER_COOLDOWN_MS));
  });

  it("the first run is accepted, with or without a row", async () => {
    await mergeUserSettings(d1, userId, run(RUN));
    expect(stored()!.settings.fsrsWeightsOptimizedAt).toBe(RUN);
    const other = createTestUser(d1);
    d1.sqlite
      .prepare("INSERT INTO user_settings (user_id, settings, updated_at) VALUES (?, ?, ?)")
      .run(other, JSON.stringify(BASE), "2026-11-01T00:00:00.000Z");
    await mergeUserSettings(d1, other, run(RUN));
    expect(stored(other)!.settings.fsrsWeightsOptimizedAt).toBe(RUN);
  });

  it("re-sending the stored run (a full settings push) is accepted", async () => {
    seed({ ...BASE, ...run(RUN) });
    await mergeUserSettings(d1, userId, { ...BASE, ...run(RUN), masteryRepetitions: 4 } as Json);
    expect(stored()!.settings.masteryRepetitions).toBe(4);
  });
});

describe("settings clobber protection (#1682), ported", () => {
  const populatedStreak = {
    balance: 2,
    spendDates: ["2026-05-29"],
    daysSinceLastEarn: 3,
    lastEarnCheckDate: "2026-05-29",
    protectionEvents: [],
    lastAcknowledgedProtectionEventDate: null,
  };

  it("Phase A: a fresh client's first push (prev=null) does not clobber populated cloud values", async () => {
    await mergeUserSettings(d1, userId, {
      streakProtection: populatedStreak,
      onboarding: { ...DEFAULT_SETTINGS.onboarding, firstVisitOnboardingDismissed: true, statsHintDismissed: true },
      masteryRepetitions: 5,
    } as unknown as Json);

    const patch = diffSettings(null, { ...DEFAULT_SETTINGS } as UserSettings);
    expect(patch).not.toHaveProperty("streakProtection");
    expect(patch).not.toHaveProperty("onboarding");
    if (Object.keys(patch).length > 0) await mergeUserSettings(d1, userId, patch as unknown as Json);

    const after = stored()!.settings as Record<string, Record<string, unknown>>;
    expect(after.streakProtection.balance).toBe(2);
    expect(after.streakProtection.spendDates).toEqual(["2026-05-29"]);
    expect(after.onboarding.firstVisitOnboardingDismissed).toBe(true);
    expect(after.onboarding.statsHintDismissed).toBe(true);
    expect(after.masteryRepetitions).toBe(5);
  });

  it("Phase B: the full default-valued blob without pruning is blocked by the guard", async () => {
    await mergeUserSettings(d1, userId, { streakProtection: { ...populatedStreak, balance: 1, spendDates: ["2026-05-10"] } });
    await expect(
      mergeUserSettings(d1, userId, { ...DEFAULT_SETTINGS } as unknown as Json),
    ).rejects.toMatchObject({ code: "23514" });
    const after = stored()!.settings as Record<string, Record<string, unknown>>;
    expect(after.streakProtection.balance).toBe(1);
    expect(after.streakProtection.spendDates).toEqual(["2026-05-10"]);
  });
});

describe("favourite and hearts through merge_user_settings (#2187), ported", () => {
  it("a patch without heartedSpeciesIds leaves the hearts and the favourite; arrays replace; null clears", async () => {
    await mergeUserSettings(d1, userId, {
      favouritePokemonId: 94,
      heartedSpeciesIds: [94, 25, 143],
      priorityNewSpeciesIds: [92, 93],
    });
    await mergeUserSettings(d1, userId, { maxNewPerDay: 15 });
    let after = stored()!.settings;
    expect(after).toMatchObject({
      maxNewPerDay: 15,
      favouritePokemonId: 94,
      heartedSpeciesIds: [94, 25, 143],
      priorityNewSpeciesIds: [92, 93],
    });

    await mergeUserSettings(d1, userId, { heartedSpeciesIds: [94, 143] });
    await mergeUserSettings(d1, userId, { priorityNewSpeciesIds: [93] });
    after = stored()!.settings;
    expect(after.heartedSpeciesIds).toEqual([94, 143]);
    expect(after.priorityNewSpeciesIds).toEqual([93]);

    await mergeUserSettings(d1, userId, { favouritePokemonId: null });
    after = stored()!.settings;
    expect(after.favouritePokemonId).toBeNull();
    expect(after.heartedSpeciesIds).toEqual([94, 143]);
  });
});
