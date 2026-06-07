import { describe, it, expect } from "vitest";
import { computeSpeciesLegStatuses } from "./legStatus";
import type { ReviewState } from "@/lib/srs/scheduler";
import type { NameReviewCard, ReverseReviewCard } from "@/lib/review/session";
import { MASTERY_STABILITY_DAYS } from "@/lib/stats/derive";

// The reverse-card offset used throughout the codebase.
const REVERSE_ID_OFFSET = 2_000_000;

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

function masteredState(overrides: Partial<ReviewState> = {}): ReviewState {
  return baseState({
    stability: MASTERY_STABILITY_DAYS,
    reps: 4,
    scheduledDays: 28,
    lastReview: "2026-01-01",
    firstSeen: "2025-12-01",
    fsrsState: "review",
    ...overrides,
  });
}

function learningState(overrides: Partial<ReviewState> = {}): ReviewState {
  return baseState({
    stability: 5,
    reps: 2,
    scheduledDays: 7,
    lastReview: "2026-01-01",
    firstSeen: "2025-12-01",
    fsrsState: "review",
    ...overrides,
  });
}

function nameCard(id: number, state: ReturnType<typeof baseState>): NameReviewCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon ${id}`,
    name: `Pokemon ${id}`,
    spriteUrl: `/sprites/${id}.png`,
    types: ["normal"],
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "A pokemon.",
    flavorTexts: ["A pokemon."],
    evolutionChain: [],
    height: 7,
    weight: 69,
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
    cardType: "name",
    subjectKey: String(id),
    state,
  };
}

function reverseCard(pokemonId: number, state: ReturnType<typeof baseState>): ReverseReviewCard {
  return {
    id: REVERSE_ID_OFFSET + pokemonId,
    pokemonId,
    speciesId: pokemonId,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon ${pokemonId}`,
    name: `Pokemon ${pokemonId}`,
    spriteUrl: `/sprites/${pokemonId}.png`,
    types: ["normal"],
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "A pokemon.",
    flavorTexts: ["A pokemon."],
    evolutionChain: [],
    height: 7,
    weight: 69,
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
    cardType: "reverse",
    subjectKey: String(pokemonId),
    state,
  };
}

// ---------------------------------------------------------------------------
// Tests: empty and trivial cases
// ---------------------------------------------------------------------------

describe("computeSpeciesLegStatuses - empty input", () => {
  it("returns an empty map for empty card array", () => {
    const result = computeSpeciesLegStatuses([]);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: the #1766 test matrix
// ---------------------------------------------------------------------------

describe("computeSpeciesLegStatuses - #1766 test matrix", () => {
  it("name mastered + no reverse -> blockingLeg = reverse", () => {
    const cards = [nameCard(1, masteredState())];
    const result = computeSpeciesLegStatuses(cards);
    const entry = result.get(1)!;
    expect(entry.name).toBe("mastered");
    expect(entry.reverse).toBe("locked");
    expect(entry.isBlocked).toBe(true);
    expect(entry.blockingLeg).toBe("reverse");
  });

  it("both mastered -> isBlocked false, blockingLeg null", () => {
    const cards = [
      nameCard(2, masteredState()),
      reverseCard(2, masteredState()),
    ];
    const result = computeSpeciesLegStatuses(cards);
    const entry = result.get(2)!;
    expect(entry.name).toBe("mastered");
    expect(entry.reverse).toBe("mastered");
    expect(entry.isBlocked).toBe(false);
    expect(entry.blockingLeg).toBe(null);
  });

  it("reverse mastered + name learning -> blockingLeg = name", () => {
    const cards = [
      nameCard(3, learningState()),
      reverseCard(3, masteredState()),
    ];
    const result = computeSpeciesLegStatuses(cards);
    const entry = result.get(3)!;
    expect(entry.name).toBe("learning");
    expect(entry.reverse).toBe("mastered");
    expect(entry.isBlocked).toBe(true);
    expect(entry.blockingLeg).toBe("name");
  });

  it("both locked -> isBlocked false, blockingLeg null", () => {
    // Two legs, neither graded.
    const cards = [
      nameCard(4, baseState()),
      reverseCard(4, baseState()),
    ];
    const result = computeSpeciesLegStatuses(cards);
    const entry = result.get(4)!;
    expect(entry.name).toBe("locked");
    expect(entry.reverse).toBe("locked");
    expect(entry.isBlocked).toBe(false);
    expect(entry.blockingLeg).toBe(null);
  });

  it("forceAllMastered -> all mastered, not blocked", () => {
    const cards = [
      nameCard(5, baseState()),           // would be locked normally
      reverseCard(5, learningState()),    // would be learning normally
    ];
    const result = computeSpeciesLegStatuses(cards, "en", true);
    const entry = result.get(5)!;
    expect(entry.name).toBe("mastered");
    expect(entry.reverse).toBe("mastered");
    expect(entry.isBlocked).toBe(false);
    expect(entry.blockingLeg).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Tests: leg classification states
// ---------------------------------------------------------------------------

describe("computeSpeciesLegStatuses - leg classification", () => {
  it("lastReview null on name card -> name leg is locked", () => {
    const cards = [nameCard(10, baseState({ lastReview: null }))];
    const entry = computeSpeciesLegStatuses(cards).get(10)!;
    expect(entry.name).toBe("locked");
  });

  it("lastReview set, stability below threshold -> learning", () => {
    const cards = [nameCard(11, learningState())];
    const entry = computeSpeciesLegStatuses(cards).get(11)!;
    expect(entry.name).toBe("learning");
  });

  it("stability >= MASTERY_STABILITY_DAYS -> mastered", () => {
    const cards = [nameCard(12, masteredState())];
    const entry = computeSpeciesLegStatuses(cards).get(12)!;
    expect(entry.name).toBe("mastered");
  });

  it("no reverse card in session -> reverse leg is locked", () => {
    const cards = [nameCard(13, masteredState())];
    const entry = computeSpeciesLegStatuses(cards).get(13)!;
    expect(entry.reverse).toBe("locked");
  });
});

// ---------------------------------------------------------------------------
// Tests: locale scoping
// ---------------------------------------------------------------------------

describe("computeSpeciesLegStatuses - locale scoping", () => {
  it("only counts cards matching the given locale", () => {
    const enName = { ...nameCard(20, masteredState()), locale: "en" as const };
    const jaName = { ...nameCard(21, masteredState()), locale: "ja" as const };

    // Scoped to "en" - only species 20 should appear.
    const enResult = computeSpeciesLegStatuses([enName, jaName], "en");
    expect(enResult.has(20)).toBe(true);
    expect(enResult.has(21)).toBe(false);

    // Scoped to "ja" - only species 21 should appear.
    const jaResult = computeSpeciesLegStatuses([enName, jaName], "ja");
    expect(jaResult.has(20)).toBe(false);
    expect(jaResult.has(21)).toBe(true);
  });

  it("cards without locale field default to en", () => {
    // No locale field set - should match the default "en" scope.
    const cards = [nameCard(30, masteredState())];
    const result = computeSpeciesLegStatuses(cards, "en");
    expect(result.has(30)).toBe(true);

    const jaResult = computeSpeciesLegStatuses(cards, "ja");
    expect(jaResult.has(30)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: isBlocked semantics
// ---------------------------------------------------------------------------

describe("computeSpeciesLegStatuses - isBlocked", () => {
  it("both legs learning -> isBlocked false (neither mastered)", () => {
    const cards = [
      nameCard(40, learningState()),
      reverseCard(40, learningState()),
    ];
    const entry = computeSpeciesLegStatuses(cards).get(40)!;
    expect(entry.isBlocked).toBe(false);
    expect(entry.blockingLeg).toBe(null);
  });

  it("one leg mastered, other learning -> isBlocked true", () => {
    const cards = [
      nameCard(41, masteredState()),
      reverseCard(41, learningState()),
    ];
    const entry = computeSpeciesLegStatuses(cards).get(41)!;
    expect(entry.isBlocked).toBe(true);
    expect(entry.blockingLeg).toBe("reverse");
  });
});
