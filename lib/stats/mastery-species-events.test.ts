/**
 * Unit tests for lib/stats/mastery-species-events.ts (issue #1523).
 *
 * Covers:
 *   - Empty card array → empty events list, no crash.
 *   - Null lastReview on either leg → species excluded from events.
 *   - forceAllMastered flag → every name-card species counted even without a
 *     reverse leg, and the sentinel date "1970-01-01" is used when both
 *     lastReview values are null.
 *   - Locale filtering → only cards matching the requested locale contribute.
 *   - nameCardsForLocale helper → locale filtering and empty-input edge cases.
 */

import { describe, it, expect } from "vitest";
import {
  masteredSpeciesEvents,
  nameCardsForLocale,
} from "./mastery-species-events";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";
import {
  MASTERY_REPETITIONS,
  MASTERY_INTERVAL_DAYS,
} from "@/lib/stats/derive";
import type { ReviewableCard, NameReviewCard, ReverseReviewCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TODAY = "2026-05-10";

function baseState(overrides: Partial<ReviewState> = {}): ReviewState {
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

function masteredState(lastReview = TODAY): Partial<ReviewState> {
  return {
    reps: MASTERY_REPETITIONS,
    scheduledDays: MASTERY_INTERVAL_DAYS,
    lastReview,
    fsrsState: "review",
  };
}

function makeNameCard(
  id: number,
  stateOverrides: Partial<ReviewState> = {},
  locale: "en" | "ja" | "zh-Hans" | "zh-Hant" = "en",
): NameReviewCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon ${id}`,
    name: `Pokemon ${id}`,
    spriteUrl: "",
    cardType: "name",
    subjectKey: String(id),
    locale,
    types: ["normal"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "",
    flavorTexts: [""],
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Seed",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium-slow",
    habitat: null,
    genderRate: 1,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    state: baseState(stateOverrides),
  };
}

function makeReverseCard(
  speciesId: number,
  stateOverrides: Partial<ReviewState> = {},
  locale: "en" | "ja" | "zh-Hans" | "zh-Hant" = "en",
): ReverseReviewCard {
  const base = makeNameCard(speciesId, stateOverrides, locale);
  return {
    ...base,
    cardType: "reverse",
    id: REVERSE_ID_OFFSET + speciesId,
    pokemonId: speciesId,
    subjectKey: String(speciesId),
    state: base.state,
  };
}

// ---------------------------------------------------------------------------
// masteredSpeciesEvents — empty input
// ---------------------------------------------------------------------------

describe("masteredSpeciesEvents — empty input", () => {
  it("returns an empty array for an empty card list, no crash", () => {
    const result = masteredSpeciesEvents([], MASTERY_REPETITIONS, false);
    expect(result).toEqual([]);
  });

  it("returns an empty array for an empty card list with forceAllMastered=true", () => {
    const result = masteredSpeciesEvents([], MASTERY_REPETITIONS, true);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// masteredSpeciesEvents — null lastReview
// ---------------------------------------------------------------------------

describe("masteredSpeciesEvents — null lastReview", () => {
  it("excludes a species when the name card has null lastReview (not mastered)", () => {
    // Name card has lastReview=null (never reviewed) → isMastered returns false.
    const nameCard = makeNameCard(1);
    const reverseCard = makeReverseCard(1, masteredState());
    const result = masteredSpeciesEvents([nameCard, reverseCard], MASTERY_REPETITIONS, false);
    expect(result).toHaveLength(0);
  });

  it("excludes a species when the reverse card has null lastReview (not mastered)", () => {
    // Name card is mastered, but reverse has never been reviewed.
    const nameCard = makeNameCard(1, masteredState("2026-04-01"));
    const reverseCard = makeReverseCard(1); // lastReview = null (default)
    const result = masteredSpeciesEvents([nameCard, reverseCard], MASTERY_REPETITIONS, false);
    expect(result).toHaveLength(0);
  });

  it("excludes a species when both legs have null lastReview", () => {
    const nameCard = makeNameCard(1);
    const reverseCard = makeReverseCard(1);
    const result = masteredSpeciesEvents([nameCard, reverseCard], MASTERY_REPETITIONS, false);
    expect(result).toHaveLength(0);
  });

  it("includes the species when both lastReview dates are present and both legs are mastered", () => {
    const nameCard = makeNameCard(1, masteredState("2026-04-01"));
    const reverseCard = makeReverseCard(1, masteredState("2026-04-05"));
    const result = masteredSpeciesEvents([nameCard, reverseCard], MASTERY_REPETITIONS, false);
    expect(result).toHaveLength(1);
    expect(result[0].speciesId).toBe(1);
    // masteredDate is the LATER of the two dates.
    expect(result[0].masteredDate).toBe("2026-04-05");
  });

  it("masteredDate is the later of name-card and reverse-card lastReview", () => {
    // Reverse crossed the gate later than the name card.
    const nameCard = makeNameCard(7, masteredState("2026-03-01"));
    const reverseCard = makeReverseCard(7, masteredState("2026-05-01"));
    const result = masteredSpeciesEvents([nameCard, reverseCard], MASTERY_REPETITIONS, false);
    expect(result[0].masteredDate).toBe("2026-05-01");

    // Name card crossed the gate later.
    const nameFirst = makeNameCard(8, masteredState("2026-05-10"));
    const revFirst = makeReverseCard(8, masteredState("2026-04-01"));
    const result2 = masteredSpeciesEvents([nameFirst, revFirst], MASTERY_REPETITIONS, false);
    expect(result2[0].masteredDate).toBe("2026-05-10");
  });
});

// ---------------------------------------------------------------------------
// masteredSpeciesEvents — forceAllMastered flag
// ---------------------------------------------------------------------------

describe("masteredSpeciesEvents — forceAllMastered flag", () => {
  it("counts every name-card species when forceAllMastered=true, even with no reverse leg", () => {
    // Three name cards, no reverse legs.
    const cards: ReviewableCard[] = [
      makeNameCard(1, masteredState("2026-04-01")),
      makeNameCard(2, masteredState("2026-04-02")),
      makeNameCard(3, { lastReview: "2026-04-03", reps: 1 }), // not naturally mastered
    ];
    const result = masteredSpeciesEvents(cards, MASTERY_REPETITIONS, true);
    expect(result).toHaveLength(3);
    const ids = result.map((e) => e.speciesId).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3]);
  });

  it("uses the sentinel date '1970-01-01' when both lastReview values are null in forceAllMastered mode", () => {
    const nameCard = makeNameCard(1); // lastReview = null
    const result = masteredSpeciesEvents([nameCard], MASTERY_REPETITIONS, true);
    expect(result).toHaveLength(1);
    expect(result[0].masteredDate).toBe("1970-01-01");
  });

  it("uses the available date when only the name lastReview is present in forceAllMastered mode", () => {
    const nameCard = makeNameCard(5, masteredState("2026-04-10"));
    // No reverse card — rev?.lastReview is null.
    const result = masteredSpeciesEvents([nameCard], MASTERY_REPETITIONS, true);
    expect(result).toHaveLength(1);
    expect(result[0].masteredDate).toBe("2026-04-10");
  });

  it("forceAllMastered: masteredDate is the later of name and reverse lastReview", () => {
    const nameCard = makeNameCard(3, masteredState("2026-03-01"));
    const reverseCard = makeReverseCard(3, { lastReview: "2026-04-15" });
    const result = masteredSpeciesEvents([nameCard, reverseCard], MASTERY_REPETITIONS, true);
    expect(result).toHaveLength(1);
    expect(result[0].masteredDate).toBe("2026-04-15");
  });

  it("forceAllMastered=false vs forceAllMastered=true: same cards, different counts", () => {
    // One species: name mastered, NO reverse leg → excluded in normal mode,
    // included in forceAllMastered mode.
    const cards: ReviewableCard[] = [makeNameCard(1, masteredState())];
    const normalResult = masteredSpeciesEvents(cards, MASTERY_REPETITIONS, false);
    const forcedResult = masteredSpeciesEvents(cards, MASTERY_REPETITIONS, true);
    expect(normalResult).toHaveLength(0);
    expect(forcedResult).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// masteredSpeciesEvents — locale filtering
// ---------------------------------------------------------------------------

describe("masteredSpeciesEvents — locale filtering", () => {
  it('only counts name and reverse cards matching the requested locale (default "en")', () => {
    // English species 1: both legs mastered.
    const enName = makeNameCard(1, masteredState("2026-04-01"), "en");
    const enReverse = makeReverseCard(1, masteredState("2026-04-02"), "en");
    // Japanese species 1: both legs mastered but different locale row.
    const jaName = makeNameCard(1, masteredState("2026-04-01"), "ja");
    const jaReverse = makeReverseCard(1, masteredState("2026-04-02"), "ja");

    // Asking for "en" locale: only the "en" pair counts.
    const enResult = masteredSpeciesEvents(
      [enName, enReverse, jaName, jaReverse],
      MASTERY_REPETITIONS,
      false,
      "en",
    );
    expect(enResult).toHaveLength(1);

    // Asking for "ja" locale: only the "ja" pair counts.
    const jaResult = masteredSpeciesEvents(
      [enName, enReverse, jaName, jaReverse],
      MASTERY_REPETITIONS,
      false,
      "ja",
    );
    expect(jaResult).toHaveLength(1);
  });

  it("returns empty array when no cards match the requested locale", () => {
    const enName = makeNameCard(1, masteredState(), "en");
    const enReverse = makeReverseCard(1, masteredState(), "en");
    // Requesting zh-Hans but only "en" cards exist.
    const result = masteredSpeciesEvents(
      [enName, enReverse],
      MASTERY_REPETITIONS,
      false,
      "zh-Hans",
    );
    expect(result).toHaveLength(0);
  });

  it("counts zh-Hant locale cards independently from en", () => {
    const zhHantName = makeNameCard(2, masteredState("2026-04-20"), "zh-Hant");
    const zhHantReverse = makeReverseCard(2, masteredState("2026-04-21"), "zh-Hant");
    const enName = makeNameCard(2, { lastReview: null }, "en"); // en row not mastered
    const result = masteredSpeciesEvents(
      [zhHantName, zhHantReverse, enName],
      MASTERY_REPETITIONS,
      false,
      "zh-Hant",
    );
    expect(result).toHaveLength(1);
    expect(result[0].speciesId).toBe(2);
    expect(result[0].masteredDate).toBe("2026-04-21");
  });

  it('cards with no explicit locale are treated as "en" by default', () => {
    // Omit the locale field (undefined) — should be treated as "en".
    const nameNoLocale: NameReviewCard = {
      ...makeNameCard(4, masteredState("2026-04-01")),
      locale: undefined,
    };
    const reverseNoLocale: ReverseReviewCard = {
      ...makeReverseCard(4, masteredState("2026-04-05")),
      locale: undefined,
    };
    const result = masteredSpeciesEvents(
      [nameNoLocale, reverseNoLocale],
      MASTERY_REPETITIONS,
      false,
      "en",
    );
    expect(result).toHaveLength(1);
    expect(result[0].speciesId).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// nameCardsForLocale
// ---------------------------------------------------------------------------

describe("nameCardsForLocale", () => {
  it("returns an empty array for an empty card list", () => {
    const result = nameCardsForLocale([], "en");
    expect(result).toHaveLength(0);
  });

  it('returns only name cards matching the requested locale ("en")', () => {
    const enName = makeNameCard(1, {}, "en");
    const jaName = makeNameCard(2, {}, "ja");
    const reverseEn = makeReverseCard(1, {}, "en");

    const result = nameCardsForLocale([enName, jaName, reverseEn], "en");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('returns Japanese name cards when locale is "ja"', () => {
    const enName = makeNameCard(1, {}, "en");
    const jaName1 = makeNameCard(2, {}, "ja");
    const jaName2 = makeNameCard(3, {}, "ja");

    const result = nameCardsForLocale([enName, jaName1, jaName2], "ja");
    expect(result).toHaveLength(2);
    const ids = result.map((c) => c.id).sort((a, b) => a - b);
    expect(ids).toEqual([2, 3]);
  });

  it('treats cards with no explicit locale as "en"', () => {
    const nameNoLocale: NameReviewCard = {
      ...makeNameCard(5, {}),
      locale: undefined,
    };
    const result = nameCardsForLocale([nameNoLocale], "en");
    expect(result).toHaveLength(1);
  });

  it("excludes reverse cards even when their locale matches", () => {
    const reverseCard = makeReverseCard(1, {}, "en");
    const result = nameCardsForLocale([reverseCard], "en");
    expect(result).toHaveLength(0);
  });

  it("returns an empty array when no cards match the requested locale", () => {
    const enName = makeNameCard(1, {}, "en");
    const result = nameCardsForLocale([enName], "zh-Hans");
    expect(result).toHaveLength(0);
  });
});
