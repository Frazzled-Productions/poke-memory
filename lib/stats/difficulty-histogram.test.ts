import { describe, it, expect } from "vitest";
import {
  computeDifficultyHistogram,
  totalHistogramCards,
  meanDifficulty,
} from "./difficulty-histogram";
import type { ReviewState } from "@/lib/srs/scheduler";
import type { NameReviewCard } from "@/lib/review/session";

const TODAY = "2026-05-12";

function state(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    stability: 0,
    difficulty: 0,
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

function card(id: number, overrides: Partial<ReviewState> = {}): NameReviewCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon ${id}`,
    cardType: "name",
    subjectKey: String(id),
    name: `Pokemon ${id}`,
    spriteUrl: "",
    types: ["normal"],
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "A pokemon.",
    flavorTexts: ["A pokemon."],
    evolutionChain: [],
    height: 10,
    weight: 100,
    baseExperience: 64,
    genus: "Generic",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium",
    habitat: null,
    genderRate: 0,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    state: state(overrides),
  };
}

/** A card is "introduced" once firstSeen is set. */
function introduced(id: number, difficulty: number): NameReviewCard {
  return card(id, { firstSeen: TODAY, lastReview: TODAY, difficulty });
}

describe("computeDifficultyHistogram", () => {
  it("always returns the nine fixed buckets in ascending order", () => {
    const buckets = computeDifficultyHistogram([]);
    expect(buckets).toHaveLength(9);
    expect(buckets.map((b) => b.label)).toEqual([
      "1-2", "2-3", "3-4", "4-5", "5-6", "6-7", "7-8", "8-9", "9-10",
    ]);
  });

  it("an empty population gives all-zero counts", () => {
    const buckets = computeDifficultyHistogram([]);
    expect(totalHistogramCards(buckets)).toBe(0);
  });

  it("ignores cards that have never been introduced", () => {
    const buckets = computeDifficultyHistogram([
      card(1, { difficulty: 5 }), // firstSeen null -> not introduced
      card(2, { difficulty: 8 }),
    ]);
    expect(totalHistogramCards(buckets)).toBe(0);
  });

  it("buckets introduced cards by floor(difficulty)", () => {
    const buckets = computeDifficultyHistogram([
      introduced(1, 1.0),  // bucket 1-2
      introduced(2, 1.9),  // bucket 1-2
      introduced(3, 5.2),  // bucket 5-6
      introduced(4, 7.5),  // bucket 7-8
    ]);
    expect(buckets[0].count).toBe(2); // 1-2
    expect(buckets[4].count).toBe(1); // 5-6
    expect(buckets[6].count).toBe(1); // 7-8
    expect(totalHistogramCards(buckets)).toBe(4);
  });

  it("places a card at difficulty 10 in the last (closed) bucket", () => {
    const buckets = computeDifficultyHistogram([introduced(1, 10)]);
    expect(buckets[8].count).toBe(1);
  });

  it("clamps out-of-range difficulty defensively", () => {
    const buckets = computeDifficultyHistogram([
      introduced(1, 0.5), // below 1 -> first bucket
      introduced(2, 99),  // above 10 -> last bucket
    ]);
    expect(buckets[0].count).toBe(1);
    expect(buckets[8].count).toBe(1);
  });

  it("treats the population as empty when forceAllMastered is true", () => {
    const buckets = computeDifficultyHistogram(
      [introduced(1, 8), introduced(2, 9)],
      true,
    );
    expect(totalHistogramCards(buckets)).toBe(0);
  });
});

describe("meanDifficulty", () => {
  it("returns null for an empty population", () => {
    expect(meanDifficulty([])).toBeNull();
  });

  it("averages difficulty across introduced cards only", () => {
    const mean = meanDifficulty([
      introduced(1, 4),
      introduced(2, 6),
      card(3, { difficulty: 10 }), // not introduced -> excluded
    ]);
    expect(mean).toBeCloseTo(5);
  });

  it("returns null when forceAllMastered is true", () => {
    expect(meanDifficulty([introduced(1, 7)], true)).toBeNull();
  });
});
