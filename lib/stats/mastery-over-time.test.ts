import { describe, it, expect } from "vitest";
import { computeMasteryOverTime } from "./mastery-over-time";
import type { NameReviewCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";
import { MASTERY_REPETITIONS, MASTERY_INTERVAL_DAYS } from "./derive";

const TODAY = "2026-05-17";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    stability: 0,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    fsrsState: "new",
    dueDate: TODAY,
    lastReview: null,
    firstSeen: null,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
    ...overrides,
  };
}

/** Build a minimal NameReviewCard for testing. */
function makeCard(
  id: number,
  lastReview: string | null,
  masteredOverride = true,
): NameReviewCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon${id}`,
    name: `Pokemon${id}`,
    spriteUrl: `/sprites/${id}.png`,
    cryUrl: null,
    types: ["normal"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "",
    flavorTexts: undefined,
    evolutionChain: [],
    height: null,
    weight: null,
    baseExperience: null,
    genus: null,
    generation: null,
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cardType: "name" as const,
    subjectKey: String(id),
    state: makeState({
      lastReview,
      firstSeen: lastReview ?? null,
      reps: masteredOverride ? MASTERY_REPETITIONS : 0,
      scheduledDays: masteredOverride ? MASTERY_INTERVAL_DAYS : 0,
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeMasteryOverTime", () => {
  it("returns empty array when no cards are mastered", () => {
    const cards = [makeCard(1, null), makeCard(2, null)];
    expect(computeMasteryOverTime(cards, TODAY)).toEqual([]);
  });

  it("returns empty array when no cards have been reviewed at all", () => {
    const cards = [makeCard(1, null, false), makeCard(2, null, false)];
    expect(computeMasteryOverTime(cards, TODAY)).toEqual([]);
  });

  it("returns a single point for one mastered card", () => {
    const cards = [makeCard(1, "2026-05-01")];
    const series = computeMasteryOverTime(cards, TODAY);
    expect(series).toEqual([{ date: "2026-05-01", count: 1 }]);
  });

  it("returns cumulative counts in ascending date order", () => {
    const cards = [
      makeCard(1, "2026-04-01"),
      makeCard(2, "2026-04-10"),
      makeCard(3, "2026-04-10"),
      makeCard(4, "2026-05-01"),
    ];
    const series = computeMasteryOverTime(cards, TODAY);
    expect(series).toEqual([
      { date: "2026-04-01", count: 1 },
      { date: "2026-04-10", count: 3 },
      { date: "2026-05-01", count: 4 },
    ]);
  });

  it("excludes cards that are not currently mastered", () => {
    const cards = [
      makeCard(1, "2026-04-01"),             // mastered
      makeCard(2, "2026-04-10", false),       // introduced but not mastered
    ];
    const series = computeMasteryOverTime(cards, TODAY);
    // Only the mastered card should appear.
    expect(series).toHaveLength(1);
    expect(series[0].count).toBe(1);
  });

  it("excludes cards with null lastReview even if mistakenly mastered", () => {
    // Edge case: isMastered would be false for null lastReview anyway,
    // but we guard defensively in the implementation.
    const cards = [makeCard(1, null)];
    expect(computeMasteryOverTime(cards, TODAY)).toEqual([]);
  });

  it("collapses multiple mastered cards on the same date into one point", () => {
    const cards = [
      makeCard(1, "2026-05-01"),
      makeCard(2, "2026-05-01"),
      makeCard(3, "2026-05-01"),
    ];
    const series = computeMasteryOverTime(cards, TODAY);
    expect(series).toHaveLength(1);
    expect(series[0]).toEqual({ date: "2026-05-01", count: 3 });
  });

  it("respects a custom masteryRepetitions threshold", () => {
    // Card has reps === 5, scheduledDays === MASTERY_INTERVAL_DAYS.
    // With default threshold (3) it is mastered; with threshold 10 it is not.
    const card: NameReviewCard = {
      ...makeCard(1, "2026-05-01"),
      state: makeState({
        lastReview: "2026-05-01",
        firstSeen: "2026-04-01",
        reps: 5,
        scheduledDays: MASTERY_INTERVAL_DAYS,
      }),
    };
    const seriesDefault = computeMasteryOverTime([card], TODAY);
    expect(seriesDefault).toHaveLength(1);

    const seriesHighThreshold = computeMasteryOverTime([card], TODAY, 10);
    expect(seriesHighThreshold).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // forceAllMastered (superuser pretendAllMastered)
  // ---------------------------------------------------------------------------

  it("forceAllMastered: returns a single point at today with count === cards.length", () => {
    const cards = [
      makeCard(1, null, false),
      makeCard(2, null, false),
      makeCard(3, "2026-04-01"),
    ];
    const series = computeMasteryOverTime(cards, TODAY, MASTERY_REPETITIONS, true);
    expect(series).toEqual([{ date: TODAY, count: 3 }]);
  });

  it("forceAllMastered: returns the full population even when no cards are mastered", () => {
    const cards = [makeCard(1, null, false), makeCard(2, null, false)];
    const series = computeMasteryOverTime(cards, TODAY, MASTERY_REPETITIONS, true);
    expect(series).toEqual([{ date: TODAY, count: 2 }]);
  });

  it("forceAllMastered: empty card list returns a single point at 0", () => {
    const series = computeMasteryOverTime([], TODAY, MASTERY_REPETITIONS, true);
    expect(series).toEqual([{ date: TODAY, count: 0 }]);
  });

  it("produces points in strictly ascending date order regardless of card order", () => {
    const cards = [
      makeCard(3, "2026-05-10"),
      makeCard(1, "2026-04-01"),
      makeCard(2, "2026-04-20"),
    ];
    const series = computeMasteryOverTime(cards, TODAY);
    for (let i = 1; i < series.length; i++) {
      expect(series[i].date > series[i - 1].date).toBe(true);
    }
  });

  it("cumulative count never decreases", () => {
    const cards = [
      makeCard(1, "2026-04-01"),
      makeCard(2, "2026-04-10"),
      makeCard(3, "2026-05-01"),
    ];
    const series = computeMasteryOverTime(cards, TODAY);
    for (let i = 1; i < series.length; i++) {
      expect(series[i].count).toBeGreaterThanOrEqual(series[i - 1].count);
    }
  });
});
