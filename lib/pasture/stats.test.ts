import { describe, it, expect } from "vitest";
import { biomeStats } from "./stats";
import { filterMastered } from "./arrivals";
import type { ReviewState } from "@/lib/srs/scheduler";
import type { NameReviewCard, ReviewableCard } from "@/lib/review/session";

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

/** A state that satisfies the mastery predicate (stability >= 21, #1765). */
function masteredState(firstSeen = "2026-04-01"): ReviewState {
  return makeState({
    reps: 3,
    stability: 21,
    scheduledDays: 21,
    lastReview: "2026-05-01",
    firstSeen,
    fsrsState: "review",
  });
}

/**
 * A state that is mastered (stability >= 21) but was introduced with fewer
 * reps. Preserved for test-fixture variety; stability is the sole gate (#1765).
 */
function masteredAtThreshold2State(firstSeen = "2026-04-01"): ReviewState {
  return makeState({
    reps: 2,
    stability: 21,
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

/**
 * Build a reverse card for a given species ID. The reverse card ID is
 * REVERSE_ID_OFFSET (2_000_000) + speciesId, matching the convention in
 * lib/pasture/arrivals.ts.
 */
function makeReverseCard(speciesId: number, state: ReviewState): ReviewableCard {
  return {
    id: 2_000_000 + speciesId,
    speciesId,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon ${speciesId} (reverse)`,
    cardType: "reverse",
    subjectKey: String(speciesId),
    name: `Pokemon ${speciesId}`,
    spriteUrl: `/sprites/${speciesId}.png`,
    types: ["normal"],
    state,
  } as unknown as ReviewableCard;
}

// ---------------------------------------------------------------------------
// biomeStats - basic operation
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

  it("counts all cards passed in allMasteredCards (caller pre-filters mastery)", () => {
    // biomeStats trusts the caller to pass only mastered cards - it does not
    // re-apply an isMastered() predicate. Both cards are counted.
    const cards = [
      makeCard(10, "Caterpie", "forest", masteredState()),
      makeCard(11, "Metapod", "forest", masteredState()),
    ];
    const stats = biomeStats("forest", cards);
    expect(stats.masteredCount).toBe(2);
  });

  it("returns the most recently firstSeen card as latestAddition", () => {
    const cards = [
      makeCard(10, "Caterpie", "forest", masteredState("2026-01-01")),
      makeCard(11, "Metapod", "forest", masteredState("2026-03-15")),
      makeCard(12, "Butterfree", "forest", masteredState("2026-02-10")),
    ];
    const stats = biomeStats("forest", cards);
    // Carries both speciesId (for locale resolution, #1662) and the English name.
    expect(stats.latestAddition).toEqual({ speciesId: 11, name: "Metapod" });
  });

  it("capturedPercent is at most 100 and at least 0", () => {
    const cards = Array.from({ length: 5 }, (_, i) =>
      makeCard(i + 10, `Pokémon ${i}`, "forest"),
    );
    const stats = biomeStats("forest", cards);
    expect(stats.capturedPercent).toBeGreaterThanOrEqual(0);
    expect(stats.capturedPercent).toBeLessThanOrEqual(100);
  });

  it("cards with isDefaultForm=true are counted (regression: unhydrated seed had undefined)", () => {
    // When cards come from a QA seed (minimal shape), isDefaultForm is undefined/falsy.
    // The pasture page now calls hydrateSession before filterMastered, so all cards
    // flowing into biomeStats have isDefaultForm set from SEED_POKEMON.
    // This test documents the expected (post-hydration) behaviour: only cards with
    // isDefaultForm=true are counted.
    const cards = [
      makeCard(10, "Caterpie", "forest"), // isDefaultForm: true - should count
    ];
    const stats = biomeStats("forest", cards);
    expect(stats.masteredCount).toBe(1);
  });

  it("non-default-form cards are not counted toward masteredCount or capturedPercent", () => {
    // A mastered alternate forme (isDefaultForm: false) in the forest habitat
    // must not inflate masteredCount above the default-form denominator.
    const nonDefaultCard: NameReviewCard = {
      ...makeCard(10001, "Wormadam-Sandy", "forest"),
      isDefaultForm: false,
    };
    // Mix in a real default-form mastered card so the count is non-zero.
    const defaultCard = makeCard(10, "Caterpie", "forest");
    const stats = biomeStats("forest", [nonDefaultCard, defaultCard]);
    // Only the default-form Caterpie should be counted.
    expect(stats.masteredCount).toBe(1);
    // capturedPercent must stay ≤ 100.
    expect(stats.capturedPercent).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// biomeStats - stability-based mastery gate (#1765)
// ---------------------------------------------------------------------------

describe("biomeStats - stability-based mastery gate (#1765)", () => {
  it("counts a species when both legs have stability >= 21 (mastered)", () => {
    // Since #1765 mastery is stability >= 21; since #1234 both name + reverse must pass.
    const fullyMastered = masteredAtThreshold2State(); // stability=21
    const allCards: ReviewableCard[] = [
      makeCard(1, "Bulbasaur", "grassland", fullyMastered),
      makeReverseCard(1, fullyMastered),
    ];
    const preFiltered = filterMastered(allCards, false) as NameReviewCard[];
    expect(preFiltered.length).toBe(1); // confirm pre-filter passes the card

    const stats = biomeStats("grassland", preFiltered);
    expect(stats.masteredCount).toBe(1);
  });

  it("counts a species mastered via stability even with low reps", () => {
    // stability >= 21 is the only gate; reps count is irrelevant for mastery (#1765).
    const lowRepsHighStability = makeState({
      reps: 1,
      stability: 21,
      scheduledDays: 21,
      firstSeen: "2026-04-01",
      fsrsState: "review",
      lastReview: "2026-05-01",
    });
    const cardLowReps: NameReviewCard = makeCard(4, "Charmander", "mountain", lowRepsHighStability);
    const reverseLowReps = makeReverseCard(4, lowRepsHighStability);
    const preFiltered = filterMastered([cardLowReps, reverseLowReps], false) as NameReviewCard[];
    expect(preFiltered.length).toBe(1);

    const stats = biomeStats("mountain", preFiltered);
    expect(stats.masteredCount).toBe(1);
  });

  it("returns zero masteredCount when stability < 21 (not mastered)", () => {
    // stability = 10 means not mastered, so filterMastered excludes it.
    const card = makeCard(10, "Caterpie", "forest", learningState()); // stability=0
    const preFiltered = filterMastered([card], false) as NameReviewCard[];
    expect(preFiltered.length).toBe(0);

    const stats = biomeStats("forest", preFiltered);
    expect(stats.masteredCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// biomeStats - forceAllMastered (superuser flag)
// ---------------------------------------------------------------------------

describe("biomeStats - forceAllMastered", () => {
  it("sets masteredCount equal to totalCount when forceAllMastered is true", () => {
    const cards: NameReviewCard[] = []; // empty - QA mode supplies the total
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
    expect(stats.latestAddition).toEqual({ speciesId: 10, name: "Caterpie" });
  });

  it("returns null latestAddition when forceAllMastered but no cards are provided for the biome", () => {
    // e.g. a rare biome with no cards in the provided list
    const stats = biomeStats("rare", [], true);
    expect(stats.latestAddition).toBeNull();
  });
});
