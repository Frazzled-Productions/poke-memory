/**
 * Unit tests for lib/mastery/proximity.ts.
 *
 * Partitioned into:
 *   - Basic filtering (only reviewed+unmastered name cards qualify)
 *   - Score ordering (higher reps+scheduledDays first; tie-break by id asc)
 *   - forceAllMastered: always returns []
 *   - Species-level mastery exclusion (both name+reverse legs required)
 *   - locale scoping
 *   - limit option
 */

import { describe, it, expect } from "vitest";
import { rankByMasteryProximity } from "./proximity";
import { MASTERY_REPETITIONS, MASTERY_INTERVAL_DAYS } from "@/lib/stats/derive";
import type { ReviewableCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(
  overrides: Partial<ReviewState> = {},
): ReviewState {
  return {
    stability: 1,
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

/** Build a name card (NameReviewCard shape, as ReviewableCard). */
function nameCard(
  id: number,
  overrides: Partial<ReviewState> = {},
  locale = "en",
): ReviewableCard {
  return {
    id,
    speciesId: id,
    cardType: "name",
    subjectKey: String(id),
    locale: locale as "en",
    name: `Pokemon-${id}`,
    spriteUrl: `/sprites/pokemon/${id}.png`,
    types: ["normal"],
    displayName: `Pokemon-${id}`,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    stats: { hp: 1, attack: 1, defense: 1, specialAttack: 1, specialDefense: 1, speed: 1 },
    flavorText: "",
    flavorTexts: [],
    evolutionChain: [],
    height: 1,
    weight: 1,
    baseExperience: 1,
    genus: null,
    generation: "generation-i",
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    state: makeState(overrides),
  } as ReviewableCard;
}

/** Build a reverse card for a species. */
function reverseCard(speciesId: number, overrides: Partial<ReviewState> = {}, locale = "en"): ReviewableCard {
  const REVERSE_ID_OFFSET = 2_000_000;
  return {
    cardType: "reverse",
    id: REVERSE_ID_OFFSET + speciesId,
    pokemonId: speciesId,
    speciesId,
    subjectKey: String(speciesId),
    locale: locale as "en",
    name: `Pokemon-${speciesId}`,
    spriteUrl: `/sprites/pokemon/${speciesId}.png`,
    types: ["normal"],
    displayName: `Pokemon-${speciesId}`,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    stats: { hp: 1, attack: 1, defense: 1, specialAttack: 1, specialDefense: 1, speed: 1 },
    flavorText: "",
    flavorTexts: [],
    evolutionChain: [],
    height: 1,
    weight: 1,
    baseExperience: 1,
    genus: null,
    generation: "generation-i",
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    state: makeState(overrides),
  } as ReviewableCard;
}

/** State that qualifies as mastered (reps >= threshold AND scheduledDays >= 21). */
const MASTERED_STATE: Partial<ReviewState> = {
  reps: MASTERY_REPETITIONS,
  scheduledDays: MASTERY_INTERVAL_DAYS,
  lastReview: "2024-01-01",
};

// ---------------------------------------------------------------------------
// Basic filtering
// ---------------------------------------------------------------------------

describe("rankByMasteryProximity — basic filtering", () => {
  it("returns empty array when there are no cards", () => {
    expect(rankByMasteryProximity([])).toEqual([]);
  });

  it("excludes never-reviewed cards (lastReview === null)", () => {
    const cards: ReviewableCard[] = [nameCard(1, { reps: 2, scheduledDays: 10 })];
    // No lastReview set → excluded
    expect(rankByMasteryProximity(cards)).toEqual([]);
  });

  it("includes reviewed-but-unmastered name cards", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, { reps: 2, scheduledDays: 10, lastReview: "2024-01-01" }),
    ];
    const result = rankByMasteryProximity(cards);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("excludes non-name card types (evolution, reverse, cry)", () => {
    const evo: ReviewableCard = {
      ...nameCard(1, { reps: 2, scheduledDays: 10, lastReview: "2024-01-01" }),
      cardType: "evolution" as "name",
    } as ReviewableCard;
    expect(rankByMasteryProximity([evo])).toHaveLength(0);
  });

  it("excludes species-mastered cards (name card cleared mastery gate)", () => {
    // Both name and reverse are mastered → species is mastered → excluded
    const cards: ReviewableCard[] = [
      nameCard(1, MASTERED_STATE),
      reverseCard(1, MASTERED_STATE),
    ];
    expect(rankByMasteryProximity(cards)).toEqual([]);
  });

  it("includes card whose name leg cleared mastery but reverse has not", () => {
    // Name card mastered but reverse card is NOT mastered → species NOT mastered → included
    const cards: ReviewableCard[] = [
      nameCard(1, MASTERED_STATE),
      reverseCard(1, { reps: 1, scheduledDays: 5, lastReview: "2024-01-01" }),
    ];
    const result = rankByMasteryProximity(cards);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Score ordering
// ---------------------------------------------------------------------------

describe("rankByMasteryProximity — score ordering", () => {
  it("orders by score (reps*1000+scheduledDays) descending", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, { reps: 1, scheduledDays: 5, lastReview: "2024-01-01" }),
      nameCard(2, { reps: 2, scheduledDays: 3, lastReview: "2024-01-01" }),
      nameCard(3, { reps: 0, scheduledDays: 0, lastReview: "2024-01-01" }),
    ];
    const result = rankByMasteryProximity(cards);
    // Scores: id1=1005, id2=2003, id3=0 → order: 2, 1, 3
    expect(result.map((e) => e.id)).toEqual([2, 1, 3]);
  });

  it("tie-breaks by id ascending when scores are equal", () => {
    const cards: ReviewableCard[] = [
      nameCard(3, { reps: 1, scheduledDays: 0, lastReview: "2024-01-01" }),
      nameCard(1, { reps: 1, scheduledDays: 0, lastReview: "2024-01-01" }),
      nameCard(2, { reps: 1, scheduledDays: 0, lastReview: "2024-01-01" }),
    ];
    const result = rankByMasteryProximity(cards);
    expect(result.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("includes correct score fields in each entry", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, { reps: 2, scheduledDays: 7, lastReview: "2024-01-01" }),
    ];
    const result = rankByMasteryProximity(cards);
    expect(result[0].reps).toBe(2);
    expect(result[0].scheduledDays).toBe(7);
    expect(result[0].score).toBe(2 * 1000 + 7);
  });

  it("includes correct name and spriteUrl fields", () => {
    const cards: ReviewableCard[] = [
      nameCard(42, { reps: 1, scheduledDays: 5, lastReview: "2024-01-01" }),
    ];
    const result = rankByMasteryProximity(cards);
    expect(result[0].name).toBe("Pokemon-42");
    expect(result[0].spriteUrl).toBe("/sprites/pokemon/42.png");
  });
});

// ---------------------------------------------------------------------------
// forceAllMastered
// ---------------------------------------------------------------------------

describe("rankByMasteryProximity — forceAllMastered", () => {
  it("always returns [] when forceAllMastered is true", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, { reps: 2, scheduledDays: 10, lastReview: "2024-01-01" }),
    ];
    expect(rankByMasteryProximity(cards, { forceAllMastered: true })).toEqual([]);
  });

  it("returns results when forceAllMastered is false (default)", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, { reps: 2, scheduledDays: 10, lastReview: "2024-01-01" }),
    ];
    expect(rankByMasteryProximity(cards, { forceAllMastered: false })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Species-level mastery (both legs required)
// ---------------------------------------------------------------------------

describe("rankByMasteryProximity — species-level mastery", () => {
  it("excludes a species when both name AND reverse are mastered", () => {
    const cards: ReviewableCard[] = [
      nameCard(5, MASTERED_STATE),
      reverseCard(5, MASTERED_STATE),
    ];
    expect(rankByMasteryProximity(cards)).toEqual([]);
  });

  it("includes a species when name is mastered but reverse is absent", () => {
    // No reverse card in session at all → reverse not mastered → species not mastered
    const cards: ReviewableCard[] = [nameCard(5, MASTERED_STATE)];
    const result = rankByMasteryProximity(cards);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(5);
  });

  it("includes a species when name is unmastered even if reverse is somehow mastered", () => {
    // Unusual case: reverse mastered but name is not → species not mastered
    const cards: ReviewableCard[] = [
      nameCard(5, { reps: 1, scheduledDays: 5, lastReview: "2024-01-01" }),
      reverseCard(5, MASTERED_STATE),
    ];
    const result = rankByMasteryProximity(cards);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Locale scoping
// ---------------------------------------------------------------------------

describe("rankByMasteryProximity — locale scoping", () => {
  it("only returns cards whose locale matches the requested locale", () => {
    const enCard = nameCard(1, { reps: 2, scheduledDays: 5, lastReview: "2024-01-01" }, "en");
    const jaCard = nameCard(2, { reps: 3, scheduledDays: 5, lastReview: "2024-01-01" }, "ja");
    const result = rankByMasteryProximity([enCard, jaCard], { locale: "en" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("returns ja-locale cards when locale is 'ja'", () => {
    const enCard = nameCard(1, { reps: 2, scheduledDays: 5, lastReview: "2024-01-01" }, "en");
    const jaCard = nameCard(2, { reps: 3, scheduledDays: 5, lastReview: "2024-01-01" }, "ja");
    const result = rankByMasteryProximity([enCard, jaCard], { locale: "ja" as "en" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// limit option
// ---------------------------------------------------------------------------

describe("rankByMasteryProximity — limit option", () => {
  it("returns all entries when limit is not specified", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, { reps: 2, scheduledDays: 5, lastReview: "2024-01-01" }),
      nameCard(2, { reps: 1, scheduledDays: 5, lastReview: "2024-01-01" }),
      nameCard(3, { reps: 0, scheduledDays: 0, lastReview: "2024-01-01" }),
    ];
    expect(rankByMasteryProximity(cards)).toHaveLength(3);
  });

  it("caps the result to the limit", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, { reps: 2, scheduledDays: 5, lastReview: "2024-01-01" }),
      nameCard(2, { reps: 1, scheduledDays: 5, lastReview: "2024-01-01" }),
      nameCard(3, { reps: 0, scheduledDays: 0, lastReview: "2024-01-01" }),
    ];
    const result = rankByMasteryProximity(cards, { limit: 2 });
    // Top 2: id1 (score 2005), id2 (score 1005)
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual([1, 2]);
  });

  it("returns all entries when limit exceeds the qualifying set size", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, { reps: 2, scheduledDays: 5, lastReview: "2024-01-01" }),
    ];
    expect(rankByMasteryProximity(cards, { limit: 10 })).toHaveLength(1);
  });

  it("returns [] when limit is 0", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, { reps: 2, scheduledDays: 5, lastReview: "2024-01-01" }),
    ];
    expect(rankByMasteryProximity(cards, { limit: 0 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// masteryRepetitions option
// ---------------------------------------------------------------------------

describe("rankByMasteryProximity — masteryRepetitions option", () => {
  it("uses MASTERY_REPETITIONS as the default threshold", () => {
    // Card with exactly MASTERY_REPETITIONS reps and >= 21 scheduledDays = mastered → excluded
    const mastered: Partial<ReviewState> = {
      reps: MASTERY_REPETITIONS,
      scheduledDays: MASTERY_INTERVAL_DAYS,
      lastReview: "2024-01-01",
    };
    const cards: ReviewableCard[] = [
      nameCard(1, mastered),
      reverseCard(1, mastered),
    ];
    expect(rankByMasteryProximity(cards)).toEqual([]);
  });

  it("applies a custom masteryRepetitions threshold", () => {
    // With threshold=5, a card at reps=3 is not yet mastered → included
    const customThreshold = 5;
    const cards: ReviewableCard[] = [
      nameCard(1, { reps: 3, scheduledDays: 21, lastReview: "2024-01-01" }),
      reverseCard(1, { reps: 3, scheduledDays: 21, lastReview: "2024-01-01" }),
    ];
    const result = rankByMasteryProximity(cards, { masteryRepetitions: customThreshold });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });
});
