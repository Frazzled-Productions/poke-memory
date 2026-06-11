import { describe, it, expect } from "vitest";
import type { NameReviewCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";
import { initialReviewState } from "@/lib/srs/scheduler";
import { MASTERY_INTERVAL_DAYS } from "@/lib/stats/derive";
import {
  applyKnownGrades,
  eligibleCardsForKnownQuiz,
  isEligibleForKnownQuiz,
} from "@/lib/onboarding/applyKnownGrades";

const NOW = new Date("2026-05-20T12:00:00Z");
const TODAY = "2026-05-20";

function makeNameCard(id: number, state: ReviewState = initialReviewState(NOW)): NameReviewCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Mon ${id}`,
    name: `mon${id}`,
    spriteUrl: `https://example.com/${id}.png`,
    types: ["normal"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "Test fixture.",
    flavorTexts: undefined,
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Test Pokémon",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium-slow",
    habitat: "grassland",
    genderRate: 1,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    cardType: "name",
    subjectKey: String(id),
    state,
  };
}

describe("isEligibleForKnownQuiz", () => {
  it("returns true for a brand-new card (lastReview null, firstSeen null)", () => {
    const card = makeNameCard(1);
    expect(isEligibleForKnownQuiz(card)).toBe(true);
  });

  it("returns false when the card has been reviewed (lastReview set)", () => {
    const card = makeNameCard(1, {
      ...initialReviewState(NOW),
      lastReview: "2026-05-10",
      firstSeen: "2026-05-10",
      reps: 1,
    });
    expect(isEligibleForKnownQuiz(card)).toBe(false);
  });

  it("returns false when the card is mid-learning step (firstSeen set, lastReview null)", () => {
    const card = makeNameCard(1, {
      ...initialReviewState(NOW),
      firstSeen: TODAY,
      learningStep: 0,
      stepStartedAt: NOW.getTime(),
    });
    expect(isEligibleForKnownQuiz(card)).toBe(false);
  });
});

// Alternate-form name cards use species ids >= 10000 (PokéAPI convention).
// The ALT_FORM_ID_THRESHOLD constant from lib/eligibility mirrors this value.
const ALT_FORM_ID = 10100; // Alolan Raichu

function makeAltFormCard(state: ReviewState = initialReviewState(NOW)): NameReviewCard {
  return {
    ...makeNameCard(ALT_FORM_ID, state),
    speciesId: 26, // Alolan Raichu's parent species (Raichu) - matches real seed shape
    isDefaultForm: false,
    formCategory: "regional",
    formSlug: "alola",
    displayName: "Alolan Raichu",
    subjectKey: String(ALT_FORM_ID),
  };
}

describe("eligibleCardsForKnownQuiz", () => {
  it("returns only cards that have never been touched (no alternateFormsEnabled arg - defaults to true)", () => {
    const fresh = makeNameCard(1);
    const reviewed = makeNameCard(2, {
      ...initialReviewState(NOW),
      lastReview: "2026-05-10",
      firstSeen: "2026-05-10",
      reps: 1,
    });
    const inStep = makeNameCard(3, {
      ...initialReviewState(NOW),
      firstSeen: TODAY,
      learningStep: 0,
    });
    expect(eligibleCardsForKnownQuiz([fresh, reviewed, inStep]).map((c) => c.id)).toEqual([1]);
  });

  describe("alternateFormsEnabled gate (#1481)", () => {
    it("excludes alternate-form cards when alternateFormsEnabled is false", () => {
      const defaultForm = makeNameCard(1);
      const altForm = makeAltFormCard();

      const result = eligibleCardsForKnownQuiz([defaultForm, altForm], false);
      expect(result.map((c) => c.id)).toEqual([1]);
      // Alternate-form card must not appear
      expect(result.find((c) => c.id === ALT_FORM_ID)).toBeUndefined();
    });

    it("includes alternate-form cards when alternateFormsEnabled is true", () => {
      const defaultForm = makeNameCard(1);
      const altForm = makeAltFormCard();

      const result = eligibleCardsForKnownQuiz([defaultForm, altForm], true);
      expect(result.map((c) => c.id)).toEqual([1, ALT_FORM_ID]);
    });

    it("defaults to including alternate forms when alternateFormsEnabled is omitted", () => {
      // The default arg is true - callers that pre-date the parameter see no
      // behavioural change (backwards-compatible default).
      const altForm = makeAltFormCard();
      const result = eligibleCardsForKnownQuiz([altForm]);
      expect(result.map((c) => c.id)).toEqual([ALT_FORM_ID]);
    });

    it("still excludes already-reviewed alternate-form cards even when alternateFormsEnabled is true", () => {
      // The FSRS-state gate and the alt-forms gate are independent; both must
      // be satisfied for a card to appear.
      const reviewedAltForm = makeAltFormCard({
        ...initialReviewState(NOW),
        lastReview: "2026-05-10",
        firstSeen: "2026-05-10",
        reps: 1,
      });
      const result = eligibleCardsForKnownQuiz([reviewedAltForm], true);
      expect(result).toHaveLength(0);
    });
  });
});

describe("applyKnownGrades", () => {
  it("graduates a selected new card via the Easy path", () => {
    const cards = [makeNameCard(1), makeNameCard(2)];
    const { cards: next, gradedIds } = applyKnownGrades(cards, new Set([1]), NOW, "en");

    expect(gradedIds).toEqual([1]);
    const graded = next.find((c) => c.id === 1)!;
    const untouched = next.find((c) => c.id === 2)!;

    // The selected card is now graduated.
    expect(graded.state.lastReview).toBe(TODAY);
    expect(graded.state.firstSeen).toBe(TODAY);
    expect(graded.state.reps).toBe(1);
    expect(graded.state.fsrsState).toBe("review");
    expect(graded.state.learningStep).toBeNull();
    // FSRS Easy on a brand-new card gives a long initial interval (4+ days
    // under defaults), well below the 21-day mastery threshold.
    expect(graded.state.scheduledDays).toBeGreaterThan(0);
    expect(graded.state.scheduledDays).toBeLessThan(MASTERY_INTERVAL_DAYS);

    // The unselected card is untouched.
    expect(untouched.state).toEqual(cards[1].state);
  });

  it("does NOT push the card to mastery in one shot (correctness invariant)", () => {
    // The quiz must produce real graduated state, not a synthesised mastered
    // state - mastery requires reps >= masteryRepetitions and
    // scheduledDays >= 21, which one tap can't legitimately establish.
    const cards = [makeNameCard(1)];
    const { cards: next } = applyKnownGrades(cards, new Set([1]), NOW, "en");
    const graded = next[0];
    expect(graded.state.reps).toBe(1);
    expect(graded.state.scheduledDays).toBeLessThan(MASTERY_INTERVAL_DAYS);
  });

  it("skips cards that are not eligible (already touched)", () => {
    const reviewed = makeNameCard(1, {
      ...initialReviewState(NOW),
      lastReview: "2026-05-10",
      firstSeen: "2026-05-10",
      reps: 1,
      scheduledDays: 5,
    });
    const { cards: next, gradedIds } = applyKnownGrades([reviewed], new Set([1]), NOW, "en");
    expect(gradedIds).toEqual([]);
    // State must be identical to input - no regression of in-progress cards.
    expect(next[0].state).toEqual(reviewed.state);
  });

  it("returns input cards verbatim when nothing is selected", () => {
    const cards = [makeNameCard(1), makeNameCard(2)];
    const { cards: next, gradedIds } = applyKnownGrades(cards, new Set(), NOW, "en");
    expect(gradedIds).toEqual([]);
    expect(next).toEqual(cards);
  });

  it("honours retentionTarget when provided", () => {
    // A lower retention target produces a longer scheduled interval. The exact
    // numbers depend on the FSRS library; we only need to confirm the option
    // is plumbed through.
    const cards = [makeNameCard(1), makeNameCard(2)];
    const { cards: highRetention } = applyKnownGrades(cards, new Set([1]), NOW, "en", {
      retentionTarget: 0.97,
    });
    const { cards: lowRetention } = applyKnownGrades(cards, new Set([1]), NOW, "en", {
      retentionTarget: 0.8,
    });
    const high = highRetention.find((c) => c.id === 1)!.state.scheduledDays;
    const low = lowRetention.find((c) => c.id === 1)!.state.scheduledDays;
    // 0.8 (more forgetting tolerated) → longer interval than 0.97.
    expect(low).toBeGreaterThanOrEqual(high);
  });

  it("does not mutate the input array or card objects", () => {
    const cards = [makeNameCard(1), makeNameCard(2)];
    const originalState1 = { ...cards[0].state };
    const originalState2 = { ...cards[1].state };
    const { cards: next } = applyKnownGrades(cards, new Set([1, 2]), NOW, "en");
    expect(cards[0].state).toEqual(originalState1);
    expect(cards[1].state).toEqual(originalState2);
    expect(next).not.toBe(cards);
  });
});

// ---------------------------------------------------------------------------
// Locale guard (#1851)
// ---------------------------------------------------------------------------

describe("applyKnownGrades locale guard (#1851)", () => {
  it("grades only the requested locale's variant of a selected id", () => {
    // A multi-locale session holds one card per (id, locale) with the same
    // numeric id. Before #1851 one selection graded every locale's variant
    // and gradedIds double-counted.
    const en = makeNameCard(1);
    const ja = { ...makeNameCard(1), locale: "ja" as const };
    const { cards, gradedIds } = applyKnownGrades([en, ja], new Set([1]), NOW, "en");

    expect(gradedIds).toEqual([1]);
    expect(cards[0]!.state.lastReview).not.toBeNull();
    // The ja variant is untouched.
    expect(cards[1]!.state.lastReview).toBeNull();
  });
});
