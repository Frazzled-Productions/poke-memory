import { describe, it, expect } from "vitest";
import { computeMasteryOverTime } from "./mastery-over-time";
import type { ReviewableCard, NameReviewCard, ReverseReviewCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";
import { MASTERY_REPETITIONS, MASTERY_INTERVAL_DAYS } from "./derive";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";

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
function makeNameCard(
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
      // stability >= 21 is the mastery gate since #1765.
      stability: masteredOverride ? 21 : 0,
      scheduledDays: masteredOverride ? MASTERY_INTERVAL_DAYS : 0,
    }),
  };
}

/** Build a minimal ReverseReviewCard paired with a name card. */
function makeReverseCard(
  speciesId: number,
  lastReview: string | null,
  masteredOverride = true,
): ReverseReviewCard {
  const nameCardBase = makeNameCard(speciesId, lastReview, masteredOverride);
  const { id: _id, cardType: _ct, ...rest } = nameCardBase;
  return {
    ...rest,
    cardType: "reverse" as const,
    id: REVERSE_ID_OFFSET + speciesId,
    pokemonId: speciesId,
    subjectKey: String(speciesId),
    state: makeState({
      lastReview,
      firstSeen: lastReview ?? null,
      reps: masteredOverride ? MASTERY_REPETITIONS : 0,
      // stability >= 21 is the mastery gate since #1765.
      stability: masteredOverride ? 21 : 0,
      scheduledDays: masteredOverride ? MASTERY_INTERVAL_DAYS : 0,
    }),
  };
}

/** Build both legs (name + reverse) for a fully mastered species. */
function makeMasteredSpecies(
  id: number,
  nameMasteredDate: string,
  reverseMasteredDate: string,
): ReviewableCard[] {
  return [
    makeNameCard(id, nameMasteredDate, true),
    makeReverseCard(id, reverseMasteredDate, true),
  ];
}

// ---------------------------------------------------------------------------
// Tests: species-level mastery (both legs required, #1448)
// ---------------------------------------------------------------------------

describe("computeMasteryOverTime - species-level (both legs)", () => {
  it("returns empty array when no cards are present", () => {
    expect(computeMasteryOverTime([], TODAY, false, "en")).toEqual([]);
  });

  it("returns empty array when only name cards are mastered (no reverse leg)", () => {
    // The reverse leg is absent - species is NOT species-mastered.
    const cards: ReviewableCard[] = [makeNameCard(1, "2026-05-01", true)];
    expect(computeMasteryOverTime(cards, TODAY, false, "en")).toEqual([]);
  });

  it("returns empty array when only reverse cards are mastered (no name leg)", () => {
    const cards: ReviewableCard[] = [makeReverseCard(1, "2026-05-01", true)];
    expect(computeMasteryOverTime(cards, TODAY, false, "en")).toEqual([]);
  });

  it("returns empty array when name is mastered but reverse is not", () => {
    const cards: ReviewableCard[] = [
      makeNameCard(1, "2026-05-01", true),
      makeReverseCard(1, "2026-05-01", false), // reverse not mastered
    ];
    expect(computeMasteryOverTime(cards, TODAY, false, "en")).toEqual([]);
  });

  it("returns empty array when reverse is mastered but name is not", () => {
    const cards: ReviewableCard[] = [
      makeNameCard(1, "2026-05-01", false), // name not mastered
      makeReverseCard(1, "2026-05-01", true),
    ];
    expect(computeMasteryOverTime(cards, TODAY, false, "en")).toEqual([]);
  });

  it("returns a single point when one species has both legs mastered on the same date", () => {
    const cards = makeMasteredSpecies(1, "2026-05-01", "2026-05-01");
    const series = computeMasteryOverTime(cards, TODAY, false, "en");
    expect(series).toEqual([{ date: "2026-05-01", count: 1 }]);
  });

  it("uses the LATER of the two leg dates as the species masteredDate", () => {
    // Name mastered on May 1, reverse mastered on May 5 - species mastered on May 5.
    const cards = makeMasteredSpecies(1, "2026-05-01", "2026-05-05");
    const series = computeMasteryOverTime(cards, TODAY, false, "en");
    expect(series).toEqual([{ date: "2026-05-05", count: 1 }]);
  });

  it("uses the later date regardless of which leg comes last", () => {
    // Reverse mastered on May 3, name mastered on May 10 - species mastered on May 10.
    const cards = makeMasteredSpecies(1, "2026-05-10", "2026-05-03");
    const series = computeMasteryOverTime(cards, TODAY, false, "en");
    expect(series).toEqual([{ date: "2026-05-10", count: 1 }]);
  });

  it("returns cumulative counts in ascending date order for multiple mastered species", () => {
    const cards: ReviewableCard[] = [
      ...makeMasteredSpecies(1, "2026-04-01", "2026-04-01"),
      ...makeMasteredSpecies(2, "2026-04-10", "2026-04-10"),
      ...makeMasteredSpecies(3, "2026-04-10", "2026-04-10"),
      ...makeMasteredSpecies(4, "2026-05-01", "2026-05-01"),
    ];
    const series = computeMasteryOverTime(cards, TODAY, false, "en");
    expect(series).toEqual([
      { date: "2026-04-01", count: 1 },
      { date: "2026-04-10", count: 3 },
      { date: "2026-05-01", count: 4 },
    ]);
  });

  it("excludes species where only one leg is mastered", () => {
    const cards: ReviewableCard[] = [
      ...makeMasteredSpecies(1, "2026-04-01", "2026-04-01"),
      makeNameCard(2, "2026-04-10", true),   // name mastered, no paired reverse
    ];
    const series = computeMasteryOverTime(cards, TODAY, false, "en");
    expect(series).toHaveLength(1);
    expect(series[0].count).toBe(1);
  });

  it("excludes cards with null lastReview", () => {
    const cards: ReviewableCard[] = [
      makeNameCard(1, null, false),
      makeReverseCard(1, null, false),
    ];
    expect(computeMasteryOverTime(cards, TODAY, false, "en")).toEqual([]);
  });

  it("collapses multiple species mastered on the same date into one point", () => {
    const cards: ReviewableCard[] = [
      ...makeMasteredSpecies(1, "2026-05-01", "2026-05-01"),
      ...makeMasteredSpecies(2, "2026-05-01", "2026-05-01"),
      ...makeMasteredSpecies(3, "2026-05-01", "2026-05-01"),
    ];
    const series = computeMasteryOverTime(cards, TODAY, false, "en");
    expect(series).toHaveLength(1);
    expect(series[0]).toEqual({ date: "2026-05-01", count: 3 });
  });

  it("stability gate: stability >= 21 is mastered; stability < 21 is not (#1765)", () => {
    // stability=21 → mastered; stability=20 → not mastered.
    const masteredState = makeState({
      lastReview: "2026-05-01",
      firstSeen: "2026-04-01",
      reps: 3,
      stability: 21,
      scheduledDays: MASTERY_INTERVAL_DAYS,
    });
    const learningState = makeState({
      lastReview: "2026-05-01",
      firstSeen: "2026-04-01",
      reps: 3,
      // stability < 21 → not mastered.
      stability: 20,
      scheduledDays: MASTERY_INTERVAL_DAYS,
    });
    const masteredCards: ReviewableCard[] = [
      { ...makeNameCard(1, "2026-05-01", true), state: masteredState },
      { ...makeReverseCard(1, "2026-05-01", true), state: masteredState },
    ];
    const learningCards: ReviewableCard[] = [
      { ...makeNameCard(2, "2026-05-01", true), state: learningState },
      { ...makeReverseCard(2, "2026-05-01", true), state: learningState },
    ];

    // stability=21 meets the gate → 1 species mastered.
    expect(computeMasteryOverTime(masteredCards, TODAY, false, "en")).toHaveLength(1);

    // stability=20 does not meet the gate → 0 species mastered.
    expect(computeMasteryOverTime(learningCards, TODAY, false, "en")).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // forceAllMastered (superuser pretendAllMastered)
  // ---------------------------------------------------------------------------

  it("forceAllMastered: returns a single point at today with count === name card count", () => {
    const cards: ReviewableCard[] = [
      makeNameCard(1, null, false),
      makeNameCard(2, null, false),
      makeNameCard(3, "2026-04-01", true),
      // Reverse cards - they must not inflate the species count.
      makeReverseCard(1, null, false),
      makeReverseCard(2, null, false),
      makeReverseCard(3, "2026-04-01", true),
    ];
    const series = computeMasteryOverTime(cards, TODAY, true, "en");
    // 3 name cards → count should be 3 (not 6).
    expect(series).toEqual([{ date: TODAY, count: 3 }]);
  });

  it("forceAllMastered: returns the full name-card count even when nothing is mastered", () => {
    const cards: ReviewableCard[] = [makeNameCard(1, null, false), makeNameCard(2, null, false)];
    const series = computeMasteryOverTime(cards, TODAY, true, "en");
    expect(series).toEqual([{ date: TODAY, count: 2 }]);
  });

  it("forceAllMastered: empty card list returns a single point at 0", () => {
    const series = computeMasteryOverTime([], TODAY, true, "en");
    expect(series).toEqual([{ date: TODAY, count: 0 }]);
  });

  it("produces points in strictly ascending date order", () => {
    const cards: ReviewableCard[] = [
      ...makeMasteredSpecies(3, "2026-05-10", "2026-05-10"),
      ...makeMasteredSpecies(1, "2026-04-01", "2026-04-01"),
      ...makeMasteredSpecies(2, "2026-04-20", "2026-04-20"),
    ];
    const series = computeMasteryOverTime(cards, TODAY, false, "en");
    for (let i = 1; i < series.length; i++) {
      expect(series[i].date > series[i - 1].date).toBe(true);
    }
  });

  it("cumulative count never decreases", () => {
    const cards: ReviewableCard[] = [
      ...makeMasteredSpecies(1, "2026-04-01", "2026-04-01"),
      ...makeMasteredSpecies(2, "2026-04-10", "2026-04-10"),
      ...makeMasteredSpecies(3, "2026-05-01", "2026-05-01"),
    ];
    const series = computeMasteryOverTime(cards, TODAY, false, "en");
    for (let i = 1; i < series.length; i++) {
      expect(series[i].count).toBeGreaterThanOrEqual(series[i - 1].count);
    }
  });
});

// ---------------------------------------------------------------------------
// forceAllMastered overlay locale scoping (#1851)
// ---------------------------------------------------------------------------

describe("computeMasteryOverTime forceAllMastered locale scoping (#1851)", () => {
  it("counts only the active locale's name cards in the overlay", () => {
    const cards = [
      makeNameCard(1, null),
      makeNameCard(2, null),
      { ...makeNameCard(3, null), locale: "ja" as const },
    ];
    // Two en cards + one ja card: the en overlay must report 2, not 3
    // (previously the overlay had no locale filter and a two-locale QA
    // session showed roughly double the species count).
    const enOverlay = computeMasteryOverTime(cards, TODAY, true, "en");
    expect(enOverlay).toHaveLength(1);
    expect(enOverlay[0]?.count).toBe(2);

    const jaOverlay = computeMasteryOverTime(cards, TODAY, true, "ja");
    expect(jaOverlay[0]?.count).toBe(1);
  });
});
