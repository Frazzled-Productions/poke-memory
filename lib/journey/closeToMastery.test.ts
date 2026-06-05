import { describe, it, expect } from "vitest";
import { deriveCloseToMastery } from "./closeToMastery";
import type { NameReviewCard, ReverseReviewCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function baseState(overrides: Partial<ReviewState> = {}): ReviewState {
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

/** A state that satisfies the mastery gate (reps >= 3 AND scheduledDays >= 21). */
function masteredState(overrides: Partial<ReviewState> = {}): ReviewState {
  return baseState({
    scheduledDays: 28,
    reps: 4,
    lastReview: "2026-01-01",
    firstSeen: "2025-12-01",
    fsrsState: "review",
    ...overrides,
  });
}

function nameCard(id: number, stateOverrides: Partial<ReviewState> = {}): NameReviewCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon ${id}`,
    name: `Pokemon ${id}`,
    spriteUrl: `/sprites/pokemon/${id}.png`,
    types: ["normal"],
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "A pokemon.",
    flavorTexts: ["A pokemon."],
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Pokémon",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium-slow",
    habitat: null,
    genderRate: 0,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    cardType: "name",
    subjectKey: String(id),
    state: baseState(stateOverrides),
  };
}

function reverseCard(pokemonId: number, stateOverrides: Partial<ReviewState> = {}): ReverseReviewCard {
  return {
    id: REVERSE_ID_OFFSET + pokemonId,
    pokemonId,
    speciesId: pokemonId,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon ${pokemonId}`,
    name: `Pokemon ${pokemonId}`,
    spriteUrl: `/sprites/pokemon/${pokemonId}.png`,
    types: ["normal"],
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "A pokemon.",
    flavorTexts: ["A pokemon."],
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Pokémon",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium-slow",
    habitat: null,
    genderRate: 0,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    cardType: "reverse",
    subjectKey: String(pokemonId),
    state: baseState(stateOverrides),
  };
}

// ---------------------------------------------------------------------------
// Tests: basic derivation
// ---------------------------------------------------------------------------

describe("deriveCloseToMastery - no results", () => {
  it("returns empty array when there are no cards", () => {
    expect(deriveCloseToMastery([])).toHaveLength(0);
  });

  it("returns empty array when name card is not yet mastered", () => {
    const cards = [
      nameCard(1, { reps: 2, scheduledDays: 10, lastReview: "2026-01-01" }),
    ];
    expect(deriveCloseToMastery(cards)).toHaveLength(0);
  });

  it("returns empty array when both name and reverse cards are mastered", () => {
    const cards = [
      nameCard(1, masteredState()),
      reverseCard(1, masteredState()),
    ];
    expect(deriveCloseToMastery(cards)).toHaveLength(0);
  });

  it("returns empty array when forceAllMastered is true, even with qualifying species", () => {
    const cards = [
      nameCard(1, masteredState()),
      reverseCard(1, { reps: 1, scheduledDays: 5, lastReview: "2026-01-01" }),
    ];
    expect(deriveCloseToMastery(cards, 3, true)).toHaveLength(0);
  });
});

describe("deriveCloseToMastery - results present", () => {
  it("includes a species whose name card is mastered but has no reverse card", () => {
    const cards = [nameCard(1, masteredState())];
    const result = deriveCloseToMastery(cards);
    expect(result).toHaveLength(1);
    expect(result[0]!.speciesId).toBe(1);
  });

  it("includes a species whose name card is mastered but reverse card is not yet mastered", () => {
    const cards = [
      nameCard(1, masteredState()),
      reverseCard(1, { reps: 1, scheduledDays: 10, lastReview: "2026-01-01" }),
    ];
    const result = deriveCloseToMastery(cards);
    expect(result).toHaveLength(1);
    expect(result[0]!.speciesId).toBe(1);
  });

  it("populates entry fields from the card data", () => {
    const cards = [nameCard(25, masteredState())];
    const [entry] = deriveCloseToMastery(cards);
    expect(entry!.speciesId).toBe(25);
    expect(entry!.englishName).toBe("Pokemon 25");
    expect(entry!.spriteUrl).toBe("/sprites/pokemon/25.png");
    expect(entry!.reverseScheduledDays).toBe(0);
    expect(entry!.reverseReps).toBe(0);
    expect(entry!.reverseIntroduced).toBe(false);
  });

  it("reflects the actual reverse card stats when the card exists but is not mastered", () => {
    const cards = [
      nameCard(7, masteredState()),
      reverseCard(7, { reps: 2, scheduledDays: 15, lastReview: "2026-01-01" }),
    ];
    const [entry] = deriveCloseToMastery(cards);
    expect(entry!.reverseScheduledDays).toBe(15);
    expect(entry!.reverseReps).toBe(2);
    expect(entry!.reverseIntroduced).toBe(true);
  });

  it("reverseIntroduced is false when reverse card lastReview is null", () => {
    const cards = [
      nameCard(4, masteredState()),
      reverseCard(4, { reps: 0, scheduledDays: 0, lastReview: null }),
    ];
    const [entry] = deriveCloseToMastery(cards);
    expect(entry!.reverseIntroduced).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: sorting
// ---------------------------------------------------------------------------

describe("deriveCloseToMastery - sort order", () => {
  it("sorts by reverseScheduledDays descending (closest to gate first)", () => {
    const cards = [
      nameCard(1, masteredState()),
      nameCard(2, masteredState()),
      nameCard(3, masteredState()),
      reverseCard(1, { reps: 2, scheduledDays: 5, lastReview: "2026-01-01" }),
      reverseCard(2, { reps: 2, scheduledDays: 18, lastReview: "2026-01-01" }),
      reverseCard(3, { reps: 1, scheduledDays: 10, lastReview: "2026-01-01" }),
    ];
    const result = deriveCloseToMastery(cards);
    expect(result.map((e) => e.speciesId)).toEqual([2, 3, 1]);
  });

  it("tie-breaks by reverseReps descending then speciesId ascending", () => {
    // Species 5 and 6 both have scheduledDays 10; species 5 has more reps.
    const cards = [
      nameCard(5, masteredState()),
      nameCard(6, masteredState()),
      reverseCard(5, { reps: 3, scheduledDays: 10, lastReview: "2026-01-01" }),
      reverseCard(6, { reps: 1, scheduledDays: 10, lastReview: "2026-01-01" }),
    ];
    const result = deriveCloseToMastery(cards);
    // Species 5 wins the tie (more reps), but note: reps=3 with scheduledDays=10
    // does not pass the mastery gate (scheduledDays must be >= 21), so both
    // appear in the list. Species 5 comes first (higher reps).
    expect(result[0]!.speciesId).toBe(5);
    expect(result[1]!.speciesId).toBe(6);
  });

  it("tie-breaks identical scheduledDays and reps by speciesId ascending", () => {
    const cards = [
      nameCard(10, masteredState()),
      nameCard(7, masteredState()),
      reverseCard(10, { reps: 1, scheduledDays: 8, lastReview: "2026-01-01" }),
      reverseCard(7, { reps: 1, scheduledDays: 8, lastReview: "2026-01-01" }),
    ];
    const result = deriveCloseToMastery(cards);
    expect(result[0]!.speciesId).toBe(7);
    expect(result[1]!.speciesId).toBe(10);
  });

  it("species with no reverse card sorts after species with a high-scheduledDays reverse card", () => {
    // Species 1: mastered name, reverse scheduledDays 18.
    // Species 2: mastered name, no reverse card (scheduledDays 0).
    const cards = [
      nameCard(1, masteredState()),
      nameCard(2, masteredState()),
      reverseCard(1, { reps: 2, scheduledDays: 18, lastReview: "2026-01-01" }),
    ];
    const result = deriveCloseToMastery(cards);
    expect(result[0]!.speciesId).toBe(1);
    expect(result[1]!.speciesId).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: custom masteryRepetitions
// ---------------------------------------------------------------------------

describe("deriveCloseToMastery - custom masteryRepetitions", () => {
  it("respects a higher masteryRepetitions threshold", () => {
    // With masteryRepetitions = 5, reps=4 is not mastered for name card.
    const cards = [
      nameCard(1, { reps: 4, scheduledDays: 28, lastReview: "2026-01-01" }),
    ];
    // Default threshold: reps 4 >= 3, so qualifies. Custom threshold: reps 4 < 5, excluded.
    expect(deriveCloseToMastery(cards, 3)).toHaveLength(1);
    expect(deriveCloseToMastery(cards, 5)).toHaveLength(0);
  });
});
