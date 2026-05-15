import { describe, it, expect } from "vitest";
import { biomeStats } from "./stats";
import type { ReviewState } from "@/lib/srs/scheduler";
import type { NameReviewCard } from "@/lib/review/session";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    fsrsState: "new",
    dueDate: "2026-05-13",
    lastReview: null,
    firstSeen: null,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
    ...overrides,
  };
}

/** A state that satisfies the mastery predicate (reps >= 3, scheduledDays >= 21). */
function masteredState(firstSeen = "2026-04-01"): ReviewState {
  return makeState({
    reps: 3,
    scheduledDays: 21,
    lastReview: "2026-05-01",
    firstSeen,
    fsrsState: "review",
  });
}

function learningState(): ReviewState {
  return makeState({
    reps: 2,
    scheduledDays: 10,
    firstSeen: "2026-04-01",
    fsrsState: "review",
  });
}

function makeCard(
  id: number,
  name: string,
  habitat: string | null,
  state: ReviewState = masteredState(),
): NameReviewCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: name,
    cardType: "name",
    subjectKey: String(id),
    name,
    spriteUrl: `/sprites/${id}.png`,
    types: ["normal"],
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "Test.",
    flavorTexts: ["Test."],
    evolutionChain: [],
    height: null,
    weight: null,
    baseExperience: null,
    genus: null,
    generation: null,
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    state,
  } as NameReviewCard;
}

// ---------------------------------------------------------------------------
// biomeStats — basic operation
// ---------------------------------------------------------------------------

describe("biomeStats", () => {
  it("returns zero masteredCount and null latestAddition for an empty card list", () => {
    const stats = biomeStats("forest", []);
    expect(stats.masteredCount).toBe(0);
    expect(stats.latestAddition).toBeNull();
  });

  it("counts only cards matching the given habitat", () => {
    const cards = [
      makeCard(10, "Caterpie", "forest"),
      makeCard(72, "Tentacool", "sea"),
      makeCard(74, "Geodude", "mountain"),
    ];
    const stats = biomeStats("forest", cards);
    expect(stats.masteredCount).toBe(1);
  });

  it("maps null habitat to 'unknown' biome", () => {
    const cards = [
      makeCard(1, "Bulbasaur", null),
      makeCard(10, "Caterpie", "forest"),
    ];
    const unknownStats = biomeStats("unknown", cards);
    expect(unknownStats.masteredCount).toBe(1);
  });

  it("includes a positive totalCount from seed data for a known biome", () => {
    // forest has 71 default-form species in the seed data (per zones.ts comment)
    const stats = biomeStats("forest", []);
    expect(stats.totalCount).toBeGreaterThan(0);
  });

  it("computes capturedPercent as 0 when no cards are mastered", () => {
    const stats = biomeStats("forest", []);
    expect(stats.capturedPercent).toBe(0);
  });

  it("does not include non-mastered cards in the count", () => {
    const cards = [
      makeCard(10, "Caterpie", "forest", masteredState()),
      makeCard(11, "Metapod", "forest", learningState()),
    ];
    const stats = biomeStats("forest", cards);
    expect(stats.masteredCount).toBe(1);
  });

  it("returns the most recently firstSeen card as latestAddition", () => {
    const cards = [
      makeCard(10, "Caterpie", "forest", masteredState("2026-01-01")),
      makeCard(11, "Metapod", "forest", masteredState("2026-03-15")),
      makeCard(12, "Butterfree", "forest", masteredState("2026-02-10")),
    ];
    const stats = biomeStats("forest", cards);
    expect(stats.latestAddition).toBe("Metapod");
  });

  it("capturedPercent is at most 100 and at least 0", () => {
    const cards = Array.from({ length: 5 }, (_, i) =>
      makeCard(i + 10, `Pokémon ${i}`, "forest"),
    );
    const stats = biomeStats("forest", cards);
    expect(stats.capturedPercent).toBeGreaterThanOrEqual(0);
    expect(stats.capturedPercent).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// biomeStats — forceAllMastered (superuser flag)
// ---------------------------------------------------------------------------

describe("biomeStats — forceAllMastered", () => {
  it("sets masteredCount equal to totalCount when forceAllMastered is true", () => {
    const cards: NameReviewCard[] = []; // empty — QA mode supplies the total
    const stats = biomeStats("forest", cards, true);
    expect(stats.masteredCount).toBe(stats.totalCount);
    expect(stats.masteredCount).toBeGreaterThan(0);
  });

  it("sets capturedPercent to 100 when forceAllMastered is true", () => {
    const stats = biomeStats("forest", [], true);
    expect(stats.capturedPercent).toBe(100);
  });

  it("includes a latestAddition from the provided mastered cards when forceAllMastered is true", () => {
    // In QA mode allMasteredCards is populated from SEED_POKEMON (synthesised),
    // but here we just pass a known card to test the surface.
    const cards = [
      makeCard(10, "Caterpie", "forest", masteredState("2026-04-01")),
    ];
    const stats = biomeStats("forest", cards, true);
    expect(stats.latestAddition).toBe("Caterpie");
  });

  it("returns null latestAddition when forceAllMastered but no cards are provided for the biome", () => {
    // e.g. a rare biome with no cards in the provided list
    const stats = biomeStats("rare", [], true);
    expect(stats.latestAddition).toBeNull();
  });
});
