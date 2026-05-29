/**
 * Unit tests for lib/stats/perGame.ts (issue #1313).
 *
 * Runs in the `node` vitest project (no DOM). All card factory helpers are
 * inlined here so the test has no dependency on the real SEED_POKEMON.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock SEED_POKEMON so we can control the versionGroups membership precisely
// without depending on the real 1 000+ entry seed.
//
// `vi.mock` factories are hoisted to the top of the file, so the mock data
// must be defined via `vi.hoisted` so it is initialised before the factory runs.
// ---------------------------------------------------------------------------

const { mockSeed, MOCK_REVERSE_ID_OFFSET } = vi.hoisted(() => {
  const MOCK_REVERSE_ID_OFFSET = 2_000_000;
  const mockSeed = [
    // Species 1 — default form, in red-blue and gold-silver
    {
      id: 1,
      speciesId: 1,
      isDefaultForm: true,
      formCategory: "default",
      formSlug: null,
      displayName: "Bulbasaur",
      name: "bulbasaur",
      spriteUrl: "/sprites/1.png",
      types: ["grass", "poison"],
      stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
      flavorText: "",
      flavorTexts: [],
      evolutionChain: [],
      height: 7,
      weight: 69,
      baseExperience: 64,
      genus: "Seed",
      generation: "generation-i",
      captureRate: 45,
      baseHappiness: 50,
      growthRate: "medium-slow",
      habitat: "grassland",
      genderRate: 1,
      isLegendary: false,
      isMythical: false,
      cryUrl: null,
      versionGroups: ["red-blue", "gold-silver"],
    },
    // Species 2 — default form, in red-blue only
    {
      id: 2,
      speciesId: 2,
      isDefaultForm: true,
      formCategory: "default",
      formSlug: null,
      displayName: "Ivysaur",
      name: "ivysaur",
      spriteUrl: "/sprites/2.png",
      types: ["grass", "poison"],
      stats: { hp: 60, attack: 62, defense: 63, specialAttack: 80, specialDefense: 80, speed: 60 },
      flavorText: "",
      flavorTexts: [],
      evolutionChain: [],
      height: 10,
      weight: 130,
      baseExperience: 142,
      genus: "Seed",
      generation: "generation-i",
      captureRate: 45,
      baseHappiness: 50,
      growthRate: "medium-slow",
      habitat: "grassland",
      genderRate: 1,
      isLegendary: false,
      isMythical: false,
      cryUrl: null,
      versionGroups: ["red-blue"],
    },
    // Species 3 — alternate form (isDefaultForm: false), should be excluded from totals
    {
      id: 10001,
      speciesId: 1,
      isDefaultForm: false,
      formCategory: "regional",
      formSlug: "alola",
      displayName: "Alolan Bulbasaur",
      name: "bulbasaur-alola",
      spriteUrl: "/sprites/10001.png",
      types: ["grass"],
      stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
      flavorText: "",
      flavorTexts: [],
      evolutionChain: [],
      height: 7,
      weight: 69,
      baseExperience: 64,
      genus: "Seed",
      generation: "generation-i",
      captureRate: 45,
      baseHappiness: 50,
      growthRate: "medium-slow",
      habitat: "grassland",
      genderRate: 1,
      isLegendary: false,
      isMythical: false,
      cryUrl: null,
      versionGroups: ["red-blue"],
    },
  ];
  return { mockSeed, MOCK_REVERSE_ID_OFFSET };
});

vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: mockSeed,
  REVERSE_ID_OFFSET: MOCK_REVERSE_ID_OFFSET,
}));

// ---------------------------------------------------------------------------
// Helper factories
// The factories use MOCK_REVERSE_ID_OFFSET rather than importing the real
// constant so they remain consistent even though seed is mocked.
// ---------------------------------------------------------------------------

import type { ReviewableCard } from "@/lib/review/session";

function makeNameCard(id: number, mastered = false): ReviewableCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default" as const,
    formSlug: null,
    displayName: `Pokemon${id}`,
    name: `Pokemon${id}`,
    spriteUrl: `/sprites/${id}.png`,
    types: ["normal"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "",
    flavorTexts: [],
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Seed",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium-slow",
    habitat: "grassland",
    genderRate: 1,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    cardType: "name" as const,
    subjectKey: String(id),
    state: {
      stability: mastered ? 30 : 0,
      difficulty: mastered ? 5 : 0,
      elapsedDays: 0,
      scheduledDays: mastered ? 25 : 0,
      reps: mastered ? 3 : 0,
      lapses: 0,
      fsrsState: mastered ? ("review" as const) : ("new" as const),
      dueDate: "2099-01-01",
      lastReview: mastered ? "2026-01-01" : null,
      firstSeen: mastered ? "2025-12-01" : null,
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
  } as unknown as ReviewableCard;
}

function makeReverseCard(speciesId: number, mastered = false): ReviewableCard {
  const id = MOCK_REVERSE_ID_OFFSET + speciesId;
  return {
    id,
    speciesId,
    isDefaultForm: true,
    formCategory: "default" as const,
    formSlug: null,
    displayName: `Pokemon${speciesId} reverse`,
    name: `Pokemon${speciesId}`,
    spriteUrl: `/sprites/${speciesId}.png`,
    types: ["normal"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "",
    flavorTexts: [],
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Seed",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium-slow",
    habitat: "grassland",
    genderRate: 1,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    cardType: "reverse" as const,
    subjectKey: String(speciesId),
    state: {
      stability: mastered ? 30 : 0,
      difficulty: mastered ? 5 : 0,
      elapsedDays: 0,
      scheduledDays: mastered ? 25 : 0,
      reps: mastered ? 3 : 0,
      lapses: 0,
      fsrsState: mastered ? ("review" as const) : ("new" as const),
      dueDate: "2099-01-01",
      lastReview: mastered ? "2026-01-01" : null,
      firstSeen: mastered ? "2025-12-01" : null,
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
  } as unknown as ReviewableCard;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { computePerGameStats, seedVersionGroupSlugs } from "@/lib/stats/perGame";

describe("seedVersionGroupSlugs", () => {
  it("returns all slugs present in the seed (excluding alternate forms)", () => {
    const slugs = seedVersionGroupSlugs();
    // red-blue and gold-silver from species 1; red-blue from species 2; alternate form excluded
    expect(slugs).toContain("red-blue");
    expect(slugs).toContain("gold-silver");
    expect(slugs).toHaveLength(2);
  });
});

describe("computePerGameStats — no cards", () => {
  it("returns the games present in seed with 0 mastered", () => {
    const result = computePerGameStats([]);
    expect(result.length).toBe(2);

    const rb = result.find((g) => g.slug === "red-blue");
    expect(rb).toBeDefined();
    expect(rb?.total).toBe(2); // species 1 and 2 are in red-blue (alternate form excluded)
    expect(rb?.mastered).toBe(0);
    expect(rb?.label).toBe("Pokémon Red/Blue");
    expect(rb?.generation).toBe(1);

    const gs = result.find((g) => g.slug === "gold-silver");
    expect(gs).toBeDefined();
    expect(gs?.total).toBe(1); // only species 1 in gold-silver
    expect(gs?.mastered).toBe(0);
  });
});

describe("computePerGameStats — partial mastery", () => {
  it("counts a species as mastered only when both name and reverse cards pass the gate", () => {
    // Species 1: name mastered, reverse mastered — should count
    // Species 2: name mastered, no reverse card — should NOT count
    const cards: ReviewableCard[] = [
      makeNameCard(1, true),
      makeReverseCard(1, true),
      makeNameCard(2, true),
      // no reverse card for species 2
    ];

    const result = computePerGameStats(cards);

    const rb = result.find((g) => g.slug === "red-blue");
    expect(rb?.mastered).toBe(1); // only species 1 is fully mastered

    const gs = result.find((g) => g.slug === "gold-silver");
    expect(gs?.mastered).toBe(1); // species 1 is also in gold-silver
  });

  it("counts 0 mastered when name card passes but reverse does not", () => {
    const cards: ReviewableCard[] = [
      makeNameCard(1, true),
      makeReverseCard(1, false), // reverse not mastered
    ];

    const result = computePerGameStats(cards);
    const rb = result.find((g) => g.slug === "red-blue");
    expect(rb?.mastered).toBe(0);
  });
});

describe("computePerGameStats — forceAllMastered", () => {
  it("counts every species in every game as mastered when forceAllMastered=true", () => {
    // No cards — but forceAllMastered overrides
    const result = computePerGameStats([], 3, true);

    const rb = result.find((g) => g.slug === "red-blue");
    expect(rb?.mastered).toBe(rb?.total);
    expect(rb?.mastered).toBe(2);

    const gs = result.find((g) => g.slug === "gold-silver");
    expect(gs?.mastered).toBe(gs?.total);
    expect(gs?.mastered).toBe(1);
  });

  it("forceAllMastered with real cards still returns all mastered", () => {
    const cards: ReviewableCard[] = [
      makeNameCard(1, false),
      makeReverseCard(1, false),
    ];

    const result = computePerGameStats(cards, 3, true);
    const rb = result.find((g) => g.slug === "red-blue");
    expect(rb?.mastered).toBe(2);
  });
});

describe("computePerGameStats — custom masteryRepetitions", () => {
  it("respects a custom masteryRepetitions threshold", () => {
    // Species 1: reps=3, scheduledDays=25 — mastered at threshold=3, not at threshold=5
    const cards: ReviewableCard[] = [
      makeNameCard(1, true),  // reps=3
      makeReverseCard(1, true), // reps=3
    ];

    // Default threshold (3): should be mastered
    const atDefault = computePerGameStats(cards, 3);
    const rb3 = atDefault.find((g) => g.slug === "red-blue");
    expect(rb3?.mastered).toBe(1);

    // Higher threshold (5): should NOT be mastered (reps=3 < 5)
    const atFive = computePerGameStats(cards, 5);
    const rb5 = atFive.find((g) => g.slug === "red-blue");
    expect(rb5?.mastered).toBe(0);
  });
});

describe("computePerGameStats — ordering", () => {
  beforeEach(() => {
    // Reset the module-level memoisation between tests so slug list is fresh.
    // (The seed mock is stable, so this is just a guard.)
  });

  it("returns games in generation + release order", () => {
    const result = computePerGameStats([]);
    const slugs = result.map((g) => g.slug);
    const rbIdx = slugs.indexOf("red-blue");
    const gsIdx = slugs.indexOf("gold-silver");
    // red-blue (Gen I) should come before gold-silver (Gen II)
    expect(rbIdx).toBeGreaterThanOrEqual(0);
    expect(gsIdx).toBeGreaterThan(rbIdx);
  });
});
