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

/**
 * A state mastered at threshold 2 but not at threshold 3.
 * reps=2, scheduledDays=21 — passes filterMastered(masteryRepetitions=2),
 * but would fail isMastered() with the default MASTERY_REPETITIONS=3.
 */
function masteredAtThreshold2State(firstSeen = "2026-04-01"): ReviewState {
  return makeState({
    reps: 2,
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

  it("counts all cards passed in allMasteredCards (caller pre-filters mastery)", () => {
    // biomeStats trusts the caller to pass only mastered cards — it does not
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

  it("cards with isDefaultForm=true are counted (regression: unhydrated seed had undefined)", () => {
    // When cards come from a QA seed (minimal shape), isDefaultForm is undefined/falsy.
    // The pasture page now calls hydrateSession before filterMastered, so all cards
    // flowing into biomeStats have isDefaultForm set from SEED_POKEMON.
    // This test documents the expected (post-hydration) behaviour: only cards with
    // isDefaultForm=true are counted.
    const cards = [
      makeCard(10, "Caterpie", "forest"), // isDefaultForm: true — should count
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
// biomeStats — masteryRepetitions below default (regression: #1013)
// ---------------------------------------------------------------------------

describe("biomeStats — masteryRepetitions < 3 (regression #1013)", () => {
  it("counts a card with reps=2 when the caller pre-filters at masteryRepetitions=2", () => {
    // This is the exact scenario that was broken: a user sets masteryRepetitions=2.
    // filterMastered passes the card (reps >= 2 && scheduledDays >= 21).
    // biomeStats must count it — not silently drop it via a hardcoded isMastered() re-check.
    // Since #1234, both name AND reverse must pass the threshold for species mastery.
    const threshold2State = masteredAtThreshold2State();
    const allCards: ReviewableCard[] = [
      makeCard(1, "Bulbasaur", "grassland", threshold2State),
      makeReverseCard(1, threshold2State), // paired reverse at the same threshold
    ];
    // Simulate what the caller does: pre-filter at masteryRepetitions=2.
    const preFiltered = filterMastered(allCards, false, 2) as NameReviewCard[];
    expect(preFiltered.length).toBe(1); // confirm the pre-filter passes the card

    const stats = biomeStats("grassland", preFiltered);
    expect(stats.masteredCount).toBe(1);
  });

  it("counts a card with reps=1 when the caller pre-filters at masteryRepetitions=1", () => {
    // Since #1234, supply a paired reverse card at the same threshold.
    const at1RepState = makeState({ reps: 1, scheduledDays: 21, firstSeen: "2026-04-01", fsrsState: "review" });
    const cardAt1Rep: NameReviewCard = makeCard(
      4,
      "Charmander",
      "mountain",
      at1RepState,
    );
    const reverseAt1Rep = makeReverseCard(4, at1RepState);
    const preFiltered = filterMastered([cardAt1Rep, reverseAt1Rep], false, 1) as NameReviewCard[];
    expect(preFiltered.length).toBe(1);

    const stats = biomeStats("mountain", preFiltered);
    expect(stats.masteredCount).toBe(1);
  });

  it("returns zero masteredCount for a card excluded by the caller's pre-filter (interval too short)", () => {
    // scheduledDays < 21 means the card is not mastered regardless of masteryRepetitions.
    // filterMastered at masteryRepetitions=2 should exclude it, so biomeStats
    // sees an empty input and returns masteredCount=0.
    const card = makeCard(10, "Caterpie", "forest", learningState()); // reps=2, scheduledDays=10
    const preFiltered = filterMastered([card], false, 2) as NameReviewCard[];
    expect(preFiltered.length).toBe(0);

    const stats = biomeStats("forest", preFiltered);
    expect(stats.masteredCount).toBe(0);
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
