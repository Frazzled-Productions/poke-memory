import { describe, it, expect } from "vitest";
import {
  applyProtectionStep,
  effectiveStreakDates,
  hasSpendForYesterday,
  validateStreakProtection,
  DEFAULT_STREAK_PROTECTION,
  EARN_INTERVAL_DAYS,
  MAX_BALANCE,
  type StreakProtection,
} from "./tokens";
import { computeStreak } from "./compute";

function blank(): StreakProtection {
  return { ...DEFAULT_STREAK_PROTECTION };
}

describe("validateStreakProtection", () => {
  it("returns the default when value is not an object", () => {
    expect(validateStreakProtection(null)).toEqual(DEFAULT_STREAK_PROTECTION);
    expect(validateStreakProtection("nope")).toEqual(DEFAULT_STREAK_PROTECTION);
    expect(validateStreakProtection(42)).toEqual(DEFAULT_STREAK_PROTECTION);
  });

  it("clamps balance to MAX_BALANCE", () => {
    const out = validateStreakProtection({ balance: 999 });
    expect(out.balance).toBe(MAX_BALANCE);
  });

  it("rejects malformed balance", () => {
    expect(validateStreakProtection({ balance: -1 }).balance).toBe(0);
    expect(validateStreakProtection({ balance: 1.5 }).balance).toBe(0);
    expect(validateStreakProtection({ balance: "two" }).balance).toBe(0);
  });

  it("filters non-ISO entries from spendDates and dedupes", () => {
    const out = validateStreakProtection({
      spendDates: ["2026-05-09", "not-a-date", "2026-05-09", "2026-05-08", 42],
    });
    expect(out.spendDates).toEqual(["2026-05-08", "2026-05-09"]);
  });

  it("falls back when spendDates is not an array", () => {
    expect(validateStreakProtection({ spendDates: "x" }).spendDates).toEqual([]);
  });
});

describe("applyProtectionStep — earn leg", () => {
  it("increments daysSinceLastEarn when today is a review day", () => {
    const dates = ["2026-05-09"];
    const result = applyProtectionStep(blank(), dates, "2026-05-09");
    expect(result.protection.daysSinceLastEarn).toBe(1);
    expect(result.protection.lastEarnCheckDate).toBe("2026-05-09");
    expect(result.earned).toBe(false);
    expect(result.spent).toBe(false);
  });

  it("does not increment when today is not a review day", () => {
    const result = applyProtectionStep(blank(), [], "2026-05-09");
    expect(result.protection.daysSinceLastEarn).toBe(0);
    expect(result.protection.lastEarnCheckDate).toBeNull();
  });

  it("is idempotent across multiple calls on the same day", () => {
    const dates = ["2026-05-09"];
    const r1 = applyProtectionStep(blank(), dates, "2026-05-09");
    const r2 = applyProtectionStep(r1.protection, dates, "2026-05-09");
    expect(r2.protection.daysSinceLastEarn).toBe(1);
    expect(r2.earned).toBe(false);
  });

  it("awards a token at EARN_INTERVAL_DAYS and resets the counter", () => {
    const start: StreakProtection = {
      ...DEFAULT_STREAK_PROTECTION,
      daysSinceLastEarn: EARN_INTERVAL_DAYS - 1,
    };
    const result = applyProtectionStep(start, ["2026-05-09"], "2026-05-09");
    expect(result.earned).toBe(true);
    expect(result.protection.balance).toBe(1);
    expect(result.protection.daysSinceLastEarn).toBe(0);
  });

  it("caps balance at MAX_BALANCE on earn", () => {
    const start: StreakProtection = {
      ...DEFAULT_STREAK_PROTECTION,
      balance: MAX_BALANCE,
      daysSinceLastEarn: EARN_INTERVAL_DAYS - 1,
    };
    const result = applyProtectionStep(start, ["2026-05-09"], "2026-05-09");
    expect(result.earned).toBe(false);
    expect(result.protection.balance).toBe(MAX_BALANCE);
    // Counter still resets so the next earn cycle is fresh.
    expect(result.protection.daysSinceLastEarn).toBe(0);
  });
});

describe("applyProtectionStep — earn-counter reset on streak break", () => {
  // Build an ISO date sequence by offsetting from a base date.
  function isoOffset(base: string, days: number): string {
    const d = new Date(base + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  it("resets the earn counter when the streak is broken without a bridging spend", () => {
    // User reviews 20 consecutive days starting 2026-04-01, takes a 14-day
    // break, then reviews 10 more days. The earn counter must reflect only
    // the latest 10 consecutive review days, not 30 — no token earned.
    const base = "2026-04-01";
    const reviews: string[] = [];
    for (let i = 0; i < 20; i++) reviews.push(isoOffset(base, i));
    // 14-day break: days 20..33 are missing.
    for (let i = 34; i < 44; i++) reviews.push(isoOffset(base, i));

    let state: StreakProtection = { ...DEFAULT_STREAK_PROTECTION };

    // Walk every review day through `applyProtectionStep` so the
    // `lastEarnCheckDate` chain matches a real user's daily passes.
    for (const day of reviews) {
      state = applyProtectionStep(state, reviews, day).protection;
    }

    expect(state.balance).toBe(0);
    expect(state.daysSinceLastEarn).toBe(10);
    expect(state.lastEarnCheckDate).toBe(reviews[reviews.length - 1]);
  });

  it("preserves the earn counter across a day bridged by a token spend", () => {
    // User reviews 20 days, misses day 21, a token bridges day 21, then
    // reviews day 22. The counter should read 22 (no reset), not 0 or 1.
    const base = "2026-04-01";
    const reviews: string[] = [];
    for (let i = 0; i < 20; i++) reviews.push(isoOffset(base, i));
    reviews.push(isoOffset(base, 21)); // resume on day 22 (i.e. base+21)

    const bridgedDay = isoOffset(base, 20); // the missed day 21 itself

    let state: StreakProtection = { ...DEFAULT_STREAK_PROTECTION };
    // Walk the first 20 review days normally.
    for (let i = 0; i < 20; i++) {
      state = applyProtectionStep(state, reviews, reviews[i]).protection;
    }
    expect(state.daysSinceLastEarn).toBe(20);

    // Inject a token spend for the missed day. In production the spend leg
    // would fire on the resume-day pass; we set it directly so the test
    // isolates the earn-counter behaviour from the spend-leg preconditions.
    state = { ...state, spendDates: [bridgedDay] };

    // Resume on day 22.
    state = applyProtectionStep(state, reviews, reviews[20]).protection;
    expect(state.daysSinceLastEarn).toBe(21);
    expect(state.lastEarnCheckDate).toBe(reviews[20]);
  });

  it("does not reset when consecutive review days are unbroken", () => {
    // Two adjacent review days — the chain is intact, no reset.
    const start: StreakProtection = {
      ...DEFAULT_STREAK_PROTECTION,
      daysSinceLastEarn: 5,
      lastEarnCheckDate: "2026-05-08",
    };
    const result = applyProtectionStep(start, ["2026-05-08", "2026-05-09"], "2026-05-09");
    expect(result.protection.daysSinceLastEarn).toBe(6);
  });
});

describe("applyProtectionStep — spend leg", () => {
  it("auto-spends a token to bridge yesterday when balance >= 1", () => {
    const start: StreakProtection = { ...DEFAULT_STREAK_PROTECTION, balance: 2 };
    // Reviewed two days ago and today, missed yesterday. Today is NOT in the
    // streakDates set (e.g. user just opened the app before reviewing).
    const result = applyProtectionStep(start, ["2026-05-07"], "2026-05-09");
    expect(result.spent).toBe(true);
    expect(result.protection.balance).toBe(1);
    expect(result.protection.spendDates).toEqual(["2026-05-08"]);
  });

  it("does not spend when balance is 0", () => {
    const result = applyProtectionStep(blank(), ["2026-05-07"], "2026-05-09");
    expect(result.spent).toBe(false);
    expect(result.protection.balance).toBe(0);
    expect(result.protection.spendDates).toEqual([]);
  });

  it("does not spend when streak was already dead (two-day gap)", () => {
    const start: StreakProtection = { ...DEFAULT_STREAK_PROTECTION, balance: 3 };
    // Yesterday AND day-before-yesterday are missing.
    const result = applyProtectionStep(start, ["2026-05-05"], "2026-05-09");
    expect(result.spent).toBe(false);
    expect(result.protection.balance).toBe(3);
  });

  it("rejects two consecutive spends (consecutive-use guard)", () => {
    const start: StreakProtection = {
      ...DEFAULT_STREAK_PROTECTION,
      balance: 3,
      spendDates: ["2026-05-07"], // day-before-yesterday was a prior spend
    };
    // Yesterday missing too. The guard says: nope, can't chain two spends.
    const result = applyProtectionStep(start, ["2026-05-06"], "2026-05-09");
    expect(result.spent).toBe(false);
    expect(result.protection.balance).toBe(3);
  });

  it("does not double-spend if yesterday is already in spendDates", () => {
    const start: StreakProtection = {
      ...DEFAULT_STREAK_PROTECTION,
      balance: 3,
      spendDates: ["2026-05-08"],
    };
    const result = applyProtectionStep(start, ["2026-05-07"], "2026-05-09");
    expect(result.spent).toBe(false);
    expect(result.protection.balance).toBe(3);
    expect(result.protection.spendDates).toEqual(["2026-05-08"]);
  });

  it("does not spend when yesterday was already a review day", () => {
    const start: StreakProtection = { ...DEFAULT_STREAK_PROTECTION, balance: 3 };
    const result = applyProtectionStep(start, ["2026-05-08"], "2026-05-09");
    expect(result.spent).toBe(false);
    expect(result.protection.balance).toBe(3);
  });

  it("a fresh-user single review day does not trigger a spend", () => {
    // The user just reviewed for the first time today. There is no prior
    // streak to protect — day-before-yesterday is missing.
    const start: StreakProtection = { ...DEFAULT_STREAK_PROTECTION, balance: 3 };
    const result = applyProtectionStep(start, ["2026-05-09"], "2026-05-09");
    expect(result.spent).toBe(false);
    expect(result.protection.balance).toBe(3);
  });
});

describe("applyProtectionStep — combined earn + spend", () => {
  it("can earn and spend in the same call if both conditions hold", () => {
    // Edge case: today is a review day (so counter increments), yesterday
    // was missed, day-before-yesterday was a review day. If the counter
    // crosses the earn threshold today, the user earns AND spends in the
    // same step. Token spend draws from the just-updated balance.
    const start: StreakProtection = {
      ...DEFAULT_STREAK_PROTECTION,
      balance: 0,
      daysSinceLastEarn: EARN_INTERVAL_DAYS - 1,
    };
    const result = applyProtectionStep(
      start,
      ["2026-05-07", "2026-05-09"],
      "2026-05-09",
    );
    expect(result.earned).toBe(true);
    expect(result.spent).toBe(true);
    expect(result.protection.balance).toBe(0);
    expect(result.protection.spendDates).toEqual(["2026-05-08"]);
  });
});

describe("effectiveStreakDates", () => {
  it("returns a sorted-deduped union of review and spend dates", () => {
    const out = effectiveStreakDates(
      ["2026-05-09", "2026-05-07"],
      ["2026-05-08", "2026-05-07"],
    );
    expect(out).toEqual(["2026-05-07", "2026-05-08", "2026-05-09"]);
  });

  it("does not mutate inputs", () => {
    const reviews = ["2026-05-09"];
    const spends = ["2026-05-08"];
    effectiveStreakDates(reviews, spends);
    expect(reviews).toEqual(["2026-05-09"]);
    expect(spends).toEqual(["2026-05-08"]);
  });
});

describe("integration: effectiveStreakDates + computeStreak", () => {
  it("bridges a 1-day gap when a spend exists for the missing day", () => {
    const reviews = ["2026-05-07", "2026-05-09"];
    const spends = ["2026-05-08"];
    const effective = effectiveStreakDates(reviews, spends);
    expect(computeStreak(effective, "2026-05-09")).toBe(3);
  });

  it("a stale spend more than the grace window ago does not start a streak", () => {
    // If the only effective date is 3 days ago, the grace window does not
    // bridge that gap — computeStreak returns 0.
    const effective = effectiveStreakDates([], ["2026-05-06"]);
    expect(computeStreak(effective, "2026-05-09")).toBe(0);
  });
});

describe("hasSpendForYesterday", () => {
  it("returns true when yesterday is in spendDates", () => {
    const p: StreakProtection = {
      ...DEFAULT_STREAK_PROTECTION,
      spendDates: ["2026-05-08"],
    };
    expect(hasSpendForYesterday(p, "2026-05-09")).toBe(true);
  });

  it("returns false when yesterday is not in spendDates", () => {
    expect(hasSpendForYesterday(blank(), "2026-05-09")).toBe(false);
  });
});
