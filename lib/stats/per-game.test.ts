import { describe, it, expect } from "vitest";
import { computePerGameStats } from "./per-game";
import type { ReviewableCard, NameReviewCard } from "@/lib/review/session";
import type { SeedPokemon } from "@/lib/pokemon/seed";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";
import type { ReviewState } from "@/lib/srs/scheduler";

// ---------------------------------------------------------------------------
// Fixtures
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
    dueDate: "2026-01-01",
    lastReview: null,
    firstSeen: null,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
    ...overrides,
  };
}

const MASTERED_STATE: Partial<ReviewState> = {
  stability: 30,
  difficulty: 5,
  scheduledDays: 30,
  reps: 3,
  fsrsState: "review",
  lastReview: "2025-12-01",
  firstSeen: "2025-11-01",
};

function makeNameCard(id: number, stateOverrides: Partial<ReviewState> = {}): NameReviewCard {
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
    cardType: "name",
    subjectKey: String(id),
    locale: "en",
    state: makeState(stateOverrides),
  };
}

function makeReverseCard(speciesId: number, stateOverrides: Partial<ReviewState> = {}): ReviewableCard {
  return {
    id: REVERSE_ID_OFFSET + speciesId,
    cardType: "reverse",
    speciesId,
    subjectKey: String(speciesId),
    name: `Pokemon ${speciesId}`,
    spriteUrl: `/sprites/pokemon/${speciesId}.png`,
    types: ["normal"],
    state: makeState(stateOverrides),
  } as unknown as ReviewableCard;
}

function makeSeedPokemon(id: number, versionGroups: string[], isDefaultForm = true): SeedPokemon {
  return {
    id,
    speciesId: id,
    isDefaultForm,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon ${id}`,
    name: `Pokemon ${id}`,
    spriteUrl: `/sprites/pokemon/${id}.png`,
    types: ["normal"],
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "A pokemon.",
    flavorTexts: undefined,
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
    versionGroups,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computePerGameStats", () => {
  it("returns an empty array when the seed is empty", () => {
    const result = computePerGameStats([], []);
    expect(result).toEqual([]);
  });

  it("counts all species as total=1 when no cards have been introduced", () => {
    const seed = [makeSeedPokemon(1, ["red-blue"]), makeSeedPokemon(2, ["red-blue"])];
    const result = computePerGameStats([], seed);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ slug: "red-blue", total: 2, introduced: 0, mastered: 0 });
  });

  it("counts an introduced species (lastReview !== null)", () => {
    const seed = [makeSeedPokemon(1, ["red-blue"])];
    const cards: ReviewableCard[] = [makeNameCard(1, { lastReview: "2025-01-01", firstSeen: "2025-01-01" })];
    const result = computePerGameStats(cards, seed);
    expect(result[0]).toMatchObject({ slug: "red-blue", total: 1, introduced: 1, mastered: 0 });
  });

  it("requires BOTH name and reverse cards mastered to count a species as mastered", () => {
    const seed = [makeSeedPokemon(1, ["red-blue"])];
    // Name card mastered but no reverse card.
    const cards: ReviewableCard[] = [makeNameCard(1, MASTERED_STATE)];
    const result = computePerGameStats(cards, seed);
    expect(result[0]).toMatchObject({ mastered: 0 });
  });

  it("counts species as mastered when both name and reverse cards pass the gate", () => {
    const seed = [makeSeedPokemon(1, ["red-blue"])];
    const cards: ReviewableCard[] = [
      makeNameCard(1, MASTERED_STATE),
      makeReverseCard(1, MASTERED_STATE),
    ];
    const result = computePerGameStats(cards, seed);
    expect(result[0]).toMatchObject({ slug: "red-blue", total: 1, introduced: 1, mastered: 1 });
  });

  it("counts a species in every game it belongs to", () => {
    const seed = [makeSeedPokemon(1, ["red-blue", "gold-silver", "x-y"])];
    const cards: ReviewableCard[] = [
      makeNameCard(1, MASTERED_STATE),
      makeReverseCard(1, MASTERED_STATE),
    ];
    const result = computePerGameStats(cards, seed);
    const slugs = result.map((r) => r.slug);
    expect(slugs).toContain("red-blue");
    expect(slugs).toContain("gold-silver");
    expect(slugs).toContain("x-y");
    for (const r of result) {
      expect(r).toMatchObject({ total: 1, introduced: 1, mastered: 1 });
    }
  });

  it("skips alternate-form seed entries (isDefaultForm === false)", () => {
    const seed = [
      makeSeedPokemon(26, ["red-blue"], true),        // default Raichu
      makeSeedPokemon(10100, ["sun-moon"], false),     // Alolan Raichu (alternate form)
    ];
    const result = computePerGameStats([], seed);
    const slugs = result.map((r) => r.slug);
    expect(slugs).toContain("red-blue");
    // Alolan Raichu (alternate form) must NOT contribute to any game count.
    expect(slugs).not.toContain("sun-moon");
  });

  it("skips seed entries with no versionGroups", () => {
    const seed = [makeSeedPokemon(1, [])];
    const result = computePerGameStats([], seed);
    expect(result).toHaveLength(0);
  });

  it("forceAllMastered overrides everything - all species are mastered", () => {
    const seed = [makeSeedPokemon(1, ["red-blue"]), makeSeedPokemon(2, ["red-blue"])];
    // No cards at all - yet with forceAllMastered every species counts.
    const result = computePerGameStats([], seed, /* forceAllMastered = */ true);
    expect(result[0]).toMatchObject({ slug: "red-blue", total: 2, introduced: 0, mastered: 2 });
  });

  it("stability gate: mastered when stability >= 21; not mastered when stability < 21 (#1765)", () => {
    const seed = [makeSeedPokemon(1, ["red-blue"])];
    // MASTERED_STATE has stability=30 → mastered under the stability gate.
    const masteredCards: ReviewableCard[] = [
      makeNameCard(1, MASTERED_STATE),
      makeReverseCard(1, MASTERED_STATE),
    ];
    const masteredResult = computePerGameStats(masteredCards, seed);
    expect(masteredResult[0]?.mastered).toBe(1);

    // stability < 21 → not mastered.
    const lowStabilityState: Partial<ReviewState> = { ...MASTERED_STATE, stability: 10 };
    const learningCards: ReviewableCard[] = [
      makeNameCard(1, lowStabilityState),
      makeReverseCard(1, lowStabilityState),
    ];
    const learningResult = computePerGameStats(learningCards, seed);
    expect(learningResult[0]?.mastered).toBe(0);
  });

  it("ignores non-English locale name cards to avoid double-counting", () => {
    const seed = [makeSeedPokemon(1, ["red-blue"])];
    // A Japanese name card for the same species should not count as "introduced"
    // because computePerGameStats operates on the "en" locale only, matching computeStats.
    const jaCard: ReviewableCard = {
      ...makeNameCard(1, { lastReview: "2025-01-01", firstSeen: "2025-01-01" }),
      locale: "ja" as const,
    } as ReviewableCard;
    const result = computePerGameStats([jaCard], seed);
    // The "ja" name card must not count as introduced.
    expect(result[0]).toMatchObject({ total: 1, introduced: 0, mastered: 0 });
  });

  it("aggregates correctly across multiple games with mixed mastery", () => {
    // Pokemon 1: mastered, in red-blue and gold-silver
    // Pokemon 2: introduced only, in gold-silver
    // Pokemon 3: locked, in x-y
    const seed = [
      makeSeedPokemon(1, ["red-blue", "gold-silver"]),
      makeSeedPokemon(2, ["gold-silver"]),
      makeSeedPokemon(3, ["x-y"]),
    ];
    const cards: ReviewableCard[] = [
      makeNameCard(1, MASTERED_STATE),
      makeReverseCard(1, MASTERED_STATE),
      makeNameCard(2, { lastReview: "2025-01-01", firstSeen: "2025-01-01", reps: 1, scheduledDays: 1 }),
    ];
    const result = computePerGameStats(cards, seed);
    const bySlug = Object.fromEntries(result.map((r) => [r.slug, r]));

    expect(bySlug["red-blue"]).toMatchObject({ total: 1, introduced: 1, mastered: 1 });
    expect(bySlug["gold-silver"]).toMatchObject({ total: 2, introduced: 2, mastered: 1 });
    expect(bySlug["x-y"]).toMatchObject({ total: 1, introduced: 0, mastered: 0 });
  });
});
