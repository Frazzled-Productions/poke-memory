import { describe, it, expect } from "vitest";
import { isEligibleForStreakNudge } from "./streakNudgePredicate";
import { DEFAULT_STREAK_PROTECTION, type StreakProtection } from "@/lib/streak/tokens";

function blank(): StreakProtection {
  return { ...DEFAULT_STREAK_PROTECTION };
}

describe("isEligibleForStreakNudge", () => {
  it("returns false when the user has already reviewed today", () => {
    expect(
      isEligibleForStreakNudge({
        streakDays: ["2026-05-08", "2026-05-09"],
        streakProtection: blank(),
        reviewedToday: true,
        today: "2026-05-09",
      }),
    ).toBe(false);
  });

  it("returns false when there is no active streak", () => {
    // No review yesterday or today - streak is dead, not "at risk".
    expect(
      isEligibleForStreakNudge({
        streakDays: ["2026-05-01"],
        streakProtection: blank(),
        reviewedToday: false,
        today: "2026-05-09",
      }),
    ).toBe(false);
  });

  it("returns false for a user with zero streak history at all", () => {
    expect(
      isEligibleForStreakNudge({
        streakDays: [],
        streakProtection: blank(),
        reviewedToday: false,
        today: "2026-05-09",
      }),
    ).toBe(false);
  });

  it("returns true for an active streak genuinely at risk (no protection token available)", () => {
    // Reviewed yesterday (and the days before), not yet today, balance 0 -
    // no token available to bridge tonight's simulated gap.
    expect(
      isEligibleForStreakNudge({
        streakDays: ["2026-05-07", "2026-05-08"],
        streakProtection: blank(),
        reviewedToday: false,
        today: "2026-05-09",
      }),
    ).toBe(true);
  });

  it("returns false when a protection token would auto-bridge today's gap (honesty case)", () => {
    // Same streak history, but the user holds a spare token - tomorrow's
    // app-open would auto-spend it to bridge today's missed review, so the
    // streak is not genuinely at risk and the nudge must be suppressed.
    const protection: StreakProtection = { ...blank(), balance: 1 };
    expect(
      isEligibleForStreakNudge({
        streakDays: ["2026-05-07", "2026-05-08"],
        streakProtection: protection,
        reviewedToday: false,
        today: "2026-05-09",
      }),
    ).toBe(false);
  });

  it("returns false when the gap is already unsavable even with tokens (streak already dead beyond grace)", () => {
    // 2026-05-09 with last review 2026-05-04: 4-day gap, more than MAX_BALANCE
    // (3) can ever bridge, so no active streak survives to be "at risk".
    const protection: StreakProtection = { ...blank(), balance: 3 };
    expect(
      isEligibleForStreakNudge({
        streakDays: ["2026-05-04"],
        streakProtection: protection,
        reviewedToday: false,
        today: "2026-05-09",
      }),
    ).toBe(false);
  });

  it("returns true when balance is insufficient to cover a multi-day bridged gap", () => {
    // spendDates already bridges 05-08 (yesterday), so the active streak
    // includes today's grace window; but the user has 0 remaining balance,
    // so tomorrow's gap (today, if missed) has no bridge available.
    const protection: StreakProtection = {
      ...blank(),
      balance: 0,
      spendDates: ["2026-05-08"],
    };
    expect(
      isEligibleForStreakNudge({
        streakDays: ["2026-05-07"],
        streakProtection: protection,
        reviewedToday: false,
        today: "2026-05-09",
      }),
    ).toBe(true);
  });
});
