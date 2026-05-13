import { describe, it, expect } from "vitest";
import {
  computeLongestStreak,
  computeBestReviewDay,
  computeRecords,
} from "./records";
import { MASTERY_REPETITIONS, MASTERY_INTERVAL_DAYS } from "./derive";
import type { ReviewState } from "@/lib/srs/scheduler";
import type { NameReviewCard } from "@/lib/review/session";
import type { GradeLog } from "@/lib/gradelog/persistence";

function state(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0,
    reps: 0, lapses: 0, fsrsState: "new",
    dueDate: "2026-05-12", lastReview: null, firstSeen: null,
    learningStep: null, stepStartedAt: null, hiddenSince: null,
    seenInPasture: false,
    ...overrides,
  };
}

function card(id: number, overrides: Partial<ReviewState> = {}): NameReviewCard {
  return {
    id, name: `P${id}`, spriteUrl: "", types: ["normal"],
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "", flavorTexts: [""], evolutionChain: [],
    height: 10, weight: 100, baseExperience: 64, genus: "",
    generation: "generation-i", captureRate: 45, baseHappiness: 50,
    growthRate: "medium", habitat: null, genderRate: 0,
    isLegendary: false, isMythical: false, cryUrl: null,
    cardType: "name", subjectKey: String(id), state: state(overrides),
  };
}

function entry(date: string, grade: 1 | 2 | 4 | 5 = 4): GradeLog[number] {
  return { date, grade, cardType: "name", occurredAt: 0 };
}

describe("computeLongestStreak", () => {
  it("returns 0 for empty input", () => {
    expect(computeLongestStreak([])).toBe(0);
  });

  it("returns 1 for a single date", () => {
    expect(computeLongestStreak(["2026-05-12"])).toBe(1);
  });

  it("counts consecutive dates", () => {
    expect(
      computeLongestStreak(["2026-05-10", "2026-05-11", "2026-05-12"]),
    ).toBe(3);
  });

  it("ignores duplicates and is order-independent", () => {
    expect(
      computeLongestStreak([
        "2026-05-12",
        "2026-05-10",
        "2026-05-11",
        "2026-05-10",
      ]),
    ).toBe(3);
  });

  it("picks the longest run when multiple disjoint runs exist", () => {
    expect(
      computeLongestStreak([
        // 2-day run
        "2026-04-01",
        "2026-04-02",
        // 5-day run
        "2026-05-08",
        "2026-05-09",
        "2026-05-10",
        "2026-05-11",
        "2026-05-12",
      ]),
    ).toBe(5);
  });
});

describe("computeBestReviewDay", () => {
  it("returns 0 for empty log", () => {
    expect(computeBestReviewDay([])).toBe(0);
  });

  it("returns the max count of entries on any single date", () => {
    const log: GradeLog = [
      entry("2026-05-12"),
      entry("2026-05-12"),
      entry("2026-05-12"),
      entry("2026-05-11"),
      entry("2026-05-11"),
    ];
    expect(computeBestReviewDay(log)).toBe(3);
  });
});

describe("computeRecords", () => {
  it("empty inputs produce zeros and nulls", () => {
    const r = computeRecords([], [], [], MASTERY_REPETITIONS);
    expect(r).toEqual({
      longestStreak: 0,
      bestReviewDay: 0,
      avgDaysToMastery: null,
      mostMasteredIn7d: null,
    });
  });

  it("avgDaysToMastery averages (lastReview - firstSeen) over mastered cards", () => {
    const cards = [
      // mastered, 10 days between firstSeen and lastReview
      card(1, {
        reps: MASTERY_REPETITIONS,
        scheduledDays: MASTERY_INTERVAL_DAYS,
        firstSeen: "2026-05-02",
        lastReview: "2026-05-12",
      }),
      // mastered, 20 days
      card(2, {
        reps: MASTERY_REPETITIONS,
        scheduledDays: MASTERY_INTERVAL_DAYS,
        firstSeen: "2026-04-22",
        lastReview: "2026-05-12",
      }),
      // not yet mastered — ignored
      card(3, {
        reps: 1,
        scheduledDays: 1,
        firstSeen: "2026-05-01",
        lastReview: "2026-05-12",
      }),
    ];
    const r = computeRecords(cards, [], [], MASTERY_REPETITIONS);
    expect(r.avgDaysToMastery).toBe(15);
  });

  it("mostMasteredIn7d finds the densest 7-day window of lastReview dates", () => {
    const mk = (id: number, lastReview: string) =>
      card(id, {
        reps: MASTERY_REPETITIONS,
        scheduledDays: MASTERY_INTERVAL_DAYS,
        firstSeen: "2026-04-01",
        lastReview,
      });
    // 4 reviews within 7 days, then a gap, then 2 reviews close together.
    const cards = [
      mk(1, "2026-05-01"),
      mk(2, "2026-05-02"),
      mk(3, "2026-05-04"),
      mk(4, "2026-05-07"),
      mk(5, "2026-05-20"),
      mk(6, "2026-05-21"),
    ];
    const r = computeRecords(cards, [], [], MASTERY_REPETITIONS);
    expect(r.mostMasteredIn7d).toBe(4);
  });

  it("plumbs longestStreak and bestReviewDay from their inputs", () => {
    const r = computeRecords(
      [],
      [entry("2026-05-12"), entry("2026-05-12"), entry("2026-05-11")],
      ["2026-05-10", "2026-05-11", "2026-05-12"],
      MASTERY_REPETITIONS,
    );
    expect(r.longestStreak).toBe(3);
    expect(r.bestReviewDay).toBe(2);
  });

  describe("with forceAllMastered (superuser pretendAllMastered)", () => {
    it("avgDaysToMastery is 0 and mostMasteredIn7d equals card count", () => {
      const cards = [card(1), card(2), card(3)];
      const r = computeRecords(cards, [], [], MASTERY_REPETITIONS, true);
      expect(r.avgDaysToMastery).toBe(0);
      expect(r.mostMasteredIn7d).toBe(3);
    });

    it("still plumbs the honest longestStreak and bestReviewDay", () => {
      const cards = [card(1)];
      const r = computeRecords(
        cards,
        [entry("2026-05-12"), entry("2026-05-12"), entry("2026-05-11")],
        ["2026-05-10", "2026-05-11", "2026-05-12"],
        MASTERY_REPETITIONS,
        true,
      );
      expect(r.longestStreak).toBe(3);
      expect(r.bestReviewDay).toBe(2);
    });

    it("with zero cards, falls through to the honest computation", () => {
      // Edge case: forceAllMastered short-circuits only when there are cards
      // to project mastery onto; an empty card array still produces null.
      const r = computeRecords([], [], [], MASTERY_REPETITIONS, true);
      expect(r.avgDaysToMastery).toBeNull();
      expect(r.mostMasteredIn7d).toBeNull();
    });
  });
});
