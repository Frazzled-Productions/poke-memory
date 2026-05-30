import { describe, it, expect } from "vitest";
import {
  computeLongestStreak,
  computeBestReviewDay,
  computeRecords,
} from "./records";
import { MASTERY_REPETITIONS, MASTERY_INTERVAL_DAYS } from "./derive";
import type { ReviewState } from "@/lib/srs/scheduler";
import type { ReviewableCard, NameReviewCard, ReverseReviewCard } from "@/lib/review/session";
import type { GradeLog } from "@/lib/gradelog/persistence";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";

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

function nameCard(id: number, overrides: Partial<ReviewState> = {}): NameReviewCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `P${id}`,
    name: `P${id}`, spriteUrl: "", types: ["normal"],
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "", flavorTexts: [""], evolutionChain: [],
    height: 10, weight: 100, baseExperience: 64, genus: "",
    generation: "generation-i", captureRate: 45, baseHappiness: 50,
    growthRate: "medium", habitat: null, genderRate: 0,
    isLegendary: false, isMythical: false, cryUrl: null,
    cardType: "name", subjectKey: String(id), state: state(overrides),
  };
}

function reverseCard(speciesId: number, overrides: Partial<ReviewState> = {}): ReverseReviewCard {
  const base = nameCard(speciesId, overrides);
  const { id: _id, cardType: _ct, ...rest } = base;
  return {
    ...rest,
    cardType: "reverse" as const,
    id: REVERSE_ID_OFFSET + speciesId,
    pokemonId: speciesId,
    subjectKey: String(speciesId),
    state: state(overrides),
  };
}

/** Build a fully mastered species pair (both legs mastered). */
function masteredPair(
  id: number,
  nameOverrides: Partial<ReviewState> = {},
  reverseOverrides: Partial<ReviewState> = {},
): ReviewableCard[] {
  const masteryState = {
    reps: MASTERY_REPETITIONS,
    scheduledDays: MASTERY_INTERVAL_DAYS,
  };
  return [
    nameCard(id, { ...masteryState, ...nameOverrides }),
    reverseCard(id, { ...masteryState, ...reverseOverrides }),
  ];
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

  it("single-day log — all reviews on one day — returns that day's count", () => {
    const log: GradeLog = [entry("2026-05-12"), entry("2026-05-12")];
    expect(computeBestReviewDay(log)).toBe(2);
  });
});

describe("computeRecords — species-level mastery (both legs, #1448)", () => {
  it("empty inputs produce zeros and nulls", () => {
    const r = computeRecords([], [], [], MASTERY_REPETITIONS);
    expect(r).toEqual({
      longestStreak: 0,
      bestReviewDay: 0,
      avgDaysToMastery: null,
      mostMasteredIn7d: null,
    });
  });

  it("name-only mastered cards produce null (reverse leg absent — not species-mastered)", () => {
    // Per #1448: name-card mastery alone does not count as species mastery.
    const cards: ReviewableCard[] = [
      nameCard(1, {
        reps: MASTERY_REPETITIONS,
        scheduledDays: MASTERY_INTERVAL_DAYS,
        firstSeen: "2026-05-02",
        lastReview: "2026-05-12",
      }),
    ];
    const r = computeRecords(cards, [], [], MASTERY_REPETITIONS);
    expect(r.avgDaysToMastery).toBeNull();
    expect(r.mostMasteredIn7d).toBeNull();
  });

  it("avgDaysToMastery averages (masteredDate - nameCard.firstSeen) over mastered species", () => {
    // Species 1: name firstSeen=May 2, both legs lastReview=May 12 → 10 days.
    // Species 2: name firstSeen=Apr 22, both legs lastReview=May 12 → 20 days.
    // Species 3: name mastered, reverse NOT mastered → excluded.
    const cards: ReviewableCard[] = [
      ...masteredPair(1,
        { firstSeen: "2026-05-02", lastReview: "2026-05-12" },
        { firstSeen: "2026-05-02", lastReview: "2026-05-12" },
      ),
      ...masteredPair(2,
        { firstSeen: "2026-04-22", lastReview: "2026-05-12" },
        { firstSeen: "2026-04-22", lastReview: "2026-05-12" },
      ),
      nameCard(3, {
        reps: MASTERY_REPETITIONS,
        scheduledDays: MASTERY_INTERVAL_DAYS,
        firstSeen: "2026-05-01",
        lastReview: "2026-05-12",
      }),
      reverseCard(3, { reps: 1, scheduledDays: 1 }), // not mastered
    ];
    const r = computeRecords(cards, [], [], MASTERY_REPETITIONS);
    expect(r.avgDaysToMastery).toBe(15);
  });

  it("avgDaysToMastery uses the later of the two leg dates as masteredDate", () => {
    // Name leg: firstSeen=May 1, lastReview=May 5.
    // Reverse leg: lastReview=May 10 (later).
    // masteredDate = May 10; days from May 1 → May 10 = 9.
    const cards: ReviewableCard[] = [
      ...masteredPair(1,
        { firstSeen: "2026-05-01", lastReview: "2026-05-05" },
        { firstSeen: "2026-05-01", lastReview: "2026-05-10" },
      ),
    ];
    const r = computeRecords(cards, [], [], MASTERY_REPETITIONS);
    expect(r.avgDaysToMastery).toBe(9);
  });

  it("avgDaysToMastery is 0 when firstSeen equals masteredDate", () => {
    const cards: ReviewableCard[] = [
      ...masteredPair(1,
        { firstSeen: "2026-05-12", lastReview: "2026-05-12" },
        { firstSeen: "2026-05-12", lastReview: "2026-05-12" },
      ),
    ];
    const r = computeRecords(cards, [], [], MASTERY_REPETITIONS);
    expect(r.avgDaysToMastery).toBe(0);
  });

  it("mostMasteredIn7d finds the densest 7-day window of species mastery dates", () => {
    const mk = (id: number, lastReview: string) =>
      masteredPair(id,
        { firstSeen: "2026-04-01", lastReview },
        { firstSeen: "2026-04-01", lastReview },
      );
    const cards: ReviewableCard[] = [
      ...mk(1, "2026-05-01"),
      ...mk(2, "2026-05-02"),
      ...mk(3, "2026-05-04"),
      ...mk(4, "2026-05-07"),
      ...mk(5, "2026-05-20"),
      ...mk(6, "2026-05-21"),
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
    it("avgDaysToMastery is 0 and mostMasteredIn7d equals name-card count", () => {
      const cards: ReviewableCard[] = [nameCard(1), nameCard(2), nameCard(3)];
      const r = computeRecords(cards, [], [], MASTERY_REPETITIONS, true);
      expect(r.avgDaysToMastery).toBe(0);
      expect(r.mostMasteredIn7d).toBe(3);
    });

    it("still plumbs the honest longestStreak and bestReviewDay", () => {
      const cards: ReviewableCard[] = [nameCard(1)];
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

    it("with zero cards, falls through to the honest computation (null)", () => {
      const r = computeRecords([], [], [], MASTERY_REPETITIONS, true);
      expect(r.avgDaysToMastery).toBeNull();
      expect(r.mostMasteredIn7d).toBeNull();
    });
  });
});
