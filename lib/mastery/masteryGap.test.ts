/**
 * Unit tests for computeMasteryGap (lib/mastery/masteryGap.ts).
 *
 * Covers:
 *   1. Empty result when forceAllMastered is true.
 *   2. Empty result when no reverse cards are in the session.
 *   3. Empty result when all species are fully mastered.
 *   4. Returns only species where name card has graduated (scheduledDays >= 21)
 *      but reverse card has not yet mastered.
 *   5. Ordering: highest reverseScheduledDays first, then reverseReps, then
 *      speciesId ascending.
 *   6. Respects the limit parameter.
 *   7. Species where reverse card IS mastered are excluded.
 *   8. Species where name card has NOT graduated are excluded.
 */

import { describe, it, expect } from "vitest";
import { computeMasteryGap } from "./masteryGap";
import type { NameReviewCard, ReverseReviewCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";

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
    dueDate: "2099-01-01",
    lastReview: null,
    firstSeen: null,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
    ...overrides,
  };
}

function makeNameCard(id: number, scheduledDays: number, reps = 5): NameReviewCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon${id}`,
    name: `Pokemon${id}`,
    spriteUrl: `/sprites/pokemon/${id}.png`,
    types: ["normal"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "A Pokémon.",
    flavorTexts: ["A Pokémon."],
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Seed Pokémon",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium-slow",
    habitat: "grassland",
    genderRate: 1,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    cardType: "name",
    subjectKey: String(id),
    state: makeState({ scheduledDays, reps, lastReview: "2025-01-01", firstSeen: "2024-01-01" }),
  };
}

function makeReverseCard(pokemonId: number, scheduledDays: number, reps = 0): ReverseReviewCard {
  return {
    id: 2_000_000 + pokemonId,
    pokemonId,
    speciesId: pokemonId,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon${pokemonId}`,
    name: `Pokemon${pokemonId}`,
    spriteUrl: `/sprites/pokemon/${pokemonId}.png`,
    types: ["normal"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "A Pokémon.",
    flavorTexts: ["A Pokémon."],
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Seed Pokémon",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium-slow",
    habitat: "grassland",
    genderRate: 1,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    cardType: "reverse",
    subjectKey: String(pokemonId),
    state: makeState({
      scheduledDays,
      reps,
      lastReview: reps > 0 ? "2025-01-01" : null,
      firstSeen: reps > 0 ? "2024-01-01" : null,
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeMasteryGap", () => {
  it("returns empty array when forceAllMastered is true", () => {
    const cards = [
      makeNameCard(1, 25),
      makeReverseCard(1, 5),
    ];
    expect(computeMasteryGap(cards, 3, true)).toEqual([]);
  });

  it("returns empty array when there are no reverse cards in the session", () => {
    const cards = [makeNameCard(1, 25)];
    expect(computeMasteryGap(cards, 3, false)).toEqual([]);
  });

  it("returns empty array when all species are fully mastered", () => {
    const cards = [
      makeNameCard(1, 25, 5),
      makeReverseCard(1, 25, 5), // reps=5 >= 3, scheduledDays=25 >= 21
    ];
    expect(computeMasteryGap(cards, 3, false)).toEqual([]);
  });

  it("returns species where name card graduated but reverse card is not mastered", () => {
    const cards = [
      makeNameCard(1, 25, 5),
      makeReverseCard(1, 10, 2), // not mastered: reps=2 < 3 and scheduledDays=10 < 21
    ];
    const result = computeMasteryGap(cards, 3, false);
    expect(result).toHaveLength(1);
    expect(result[0].speciesId).toBe(1);
    expect(result[0].name).toBe("Pokemon1");
    expect(result[0].spriteUrl).toBe("/sprites/pokemon/1.png");
    expect(result[0].reverseReps).toBe(2);
    expect(result[0].reverseScheduledDays).toBe(10);
  });

  it("excludes species where name card has not graduated (scheduledDays < 21)", () => {
    const cards = [
      makeNameCard(1, 15, 5), // scheduledDays=15 < 21 — not graduated
      makeReverseCard(1, 5, 0),
    ];
    expect(computeMasteryGap(cards, 3, false)).toEqual([]);
  });

  it("excludes species where reverse card is already mastered", () => {
    const cards = [
      makeNameCard(1, 30, 5),
      makeReverseCard(1, 25, 4), // reps=4 >= 3, scheduledDays=25 >= 21 — mastered
    ];
    expect(computeMasteryGap(cards, 3, false)).toEqual([]);
  });

  it("orders by reverseScheduledDays descending (closest to mastery first)", () => {
    const cards = [
      makeNameCard(1, 30),
      makeReverseCard(1, 5, 1),   // lowest
      makeNameCard(2, 30),
      makeReverseCard(2, 18, 2),  // highest
      makeNameCard(3, 30),
      makeReverseCard(3, 12, 1),  // middle
    ];
    const result = computeMasteryGap(cards, 3, false);
    expect(result.map((e) => e.speciesId)).toEqual([2, 3, 1]);
  });

  it("breaks ties in reverseScheduledDays by reverseReps descending", () => {
    const cards = [
      makeNameCard(1, 30),
      makeReverseCard(1, 10, 1),
      makeNameCard(2, 30),
      makeReverseCard(2, 10, 2), // same days, more reps
    ];
    const result = computeMasteryGap(cards, 3, false);
    expect(result.map((e) => e.speciesId)).toEqual([2, 1]);
  });

  it("breaks remaining ties by speciesId ascending", () => {
    const cards = [
      makeNameCard(3, 30),
      makeReverseCard(3, 10, 1),
      makeNameCard(1, 30),
      makeReverseCard(1, 10, 1),
    ];
    const result = computeMasteryGap(cards, 3, false);
    expect(result.map((e) => e.speciesId)).toEqual([1, 3]);
  });

  it("respects the limit parameter", () => {
    const cards = [
      makeNameCard(1, 30), makeReverseCard(1, 5),
      makeNameCard(2, 30), makeReverseCard(2, 5),
      makeNameCard(3, 30), makeReverseCard(3, 5),
      makeNameCard(4, 30), makeReverseCard(4, 5),
    ];
    const result = computeMasteryGap(cards, 3, false, 2);
    expect(result).toHaveLength(2);
  });

  it("default limit is 10", () => {
    const cards = Array.from({ length: 15 }, (_, i) => [
      makeNameCard(i + 1, 30),
      makeReverseCard(i + 1, 5),
    ]).flat();
    const result = computeMasteryGap(cards, 3, false);
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("respects custom masteryRepetitions threshold", () => {
    // With masteryRepetitions=5, a reverse card with reps=4 and scheduledDays=25
    // is not yet mastered even though it would be under the default threshold of 3.
    const cards = [
      makeNameCard(1, 30, 6),
      makeReverseCard(1, 25, 4),
    ];
    const result = computeMasteryGap(cards, 5, false);
    expect(result).toHaveLength(1);
    expect(result[0].speciesId).toBe(1);
  });

  it("handles a mix of graduated and non-graduated name cards correctly", () => {
    const cards = [
      makeNameCard(1, 25), makeReverseCard(1, 5),   // in gap
      makeNameCard(2, 10), makeReverseCard(2, 5),   // name not graduated — excluded
      makeNameCard(3, 30), makeReverseCard(3, 22, 4), // reverse mastered — excluded
    ];
    const result = computeMasteryGap(cards, 3, false);
    expect(result).toHaveLength(1);
    expect(result[0].speciesId).toBe(1);
  });
});
