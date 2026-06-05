import { describe, it, expect } from "vitest";
import {
  isMastered,
  justBecameMastered,
  filterMastered,
  markSeenInPasture,
} from "./arrivals";
import type { ReviewState } from "@/lib/srs/scheduler";
import type { ReviewableCard } from "@/lib/review/session";

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

/** A mastered state: reps >= 3, scheduledDays >= 21. */
const masteredState = makeState({
  reps: 3,
  scheduledDays: 21,
  lastReview: "2026-05-01",
  firstSeen: "2026-04-01",
  fsrsState: "review",
});

/** A non-mastered-but-introduced state. */
const learningState = makeState({
  reps: 2,
  scheduledDays: 10,
  lastReview: "2026-05-01",
  firstSeen: "2026-04-01",
  fsrsState: "review",
});

/** A brand-new state (no reviews yet). */
const newState = makeState();

function makeCard(
  id: number,
  cardType: "name" | "evolution" | "reverse" | "cry",
  state: ReviewState,
): ReviewableCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon ${id}`,
    cardType,
    subjectKey: String(id),
    name: `Pokemon ${id}`,
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
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    state,
  } as ReviewableCard;
}

// ---------------------------------------------------------------------------
// isMastered (re-exported from derive.ts)
// ---------------------------------------------------------------------------

describe("isMastered", () => {
  it("returns true when reps >= 3 and scheduledDays >= 21", () => {
    expect(isMastered(masteredState)).toBe(true);
  });

  it("returns false when reps < 3", () => {
    expect(isMastered(makeState({ reps: 2, scheduledDays: 21 }))).toBe(false);
  });

  it("returns false when scheduledDays < 21", () => {
    expect(isMastered(makeState({ reps: 3, scheduledDays: 20 }))).toBe(false);
  });

  it("returns false for a brand-new card", () => {
    expect(isMastered(newState)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// justBecameMastered
// ---------------------------------------------------------------------------

describe("justBecameMastered", () => {
  it("returns true when transitioning from non-mastered to mastered", () => {
    expect(justBecameMastered(learningState, masteredState)).toBe(true);
  });

  it("returns false when already mastered before", () => {
    expect(justBecameMastered(masteredState, masteredState)).toBe(false);
  });

  it("returns false when still not mastered after", () => {
    expect(justBecameMastered(learningState, learningState)).toBe(false);
  });

  it("returns false for new → learning (no mastery crossing)", () => {
    expect(justBecameMastered(newState, learningState)).toBe(false);
  });

  it("returns true from brand-new to mastered (Easy-first-grade edge case)", () => {
    expect(justBecameMastered(newState, masteredState)).toBe(true);
  });

  it("honours a higher masteryRepetitions threshold", () => {
    // masteredState has reps: 3 - mastered under the default but not under a
    // custom threshold of 5, so the transition no longer counts as a crossing.
    expect(justBecameMastered(learningState, masteredState, 5)).toBe(false);
  });

  it("honours a lower masteryRepetitions threshold", () => {
    // learningState has reps: 2, scheduledDays: 10 - not mastered under any
    // threshold because scheduledDays < 21. Use a state that crosses only once
    // the rep threshold drops to 2.
    const lowRepMastered = makeState({
      reps: 2,
      scheduledDays: 21,
      lastReview: "2026-05-01",
      firstSeen: "2026-04-01",
      fsrsState: "review",
    });
    // Under the default threshold of 3, lowRepMastered is not mastered, so the
    // transition from newState is not a crossing.
    expect(justBecameMastered(newState, lowRepMastered)).toBe(false);
    // Drop the threshold to 2 and the same transition becomes a crossing.
    expect(justBecameMastered(newState, lowRepMastered, 2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// filterMastered
// ---------------------------------------------------------------------------

describe("filterMastered", () => {
  it("returns only species-mastered name cards (both name and reverse mastered)", () => {
    // Since #1234, both name AND reverse must be mastered. Species 1 has both;
    // species 2 and 3 have name cards that are not mastered.
    const cards = [
      makeCard(1, "name", masteredState),
      makeCard(2_000_001, "reverse", masteredState), // paired reverse for species 1
      makeCard(2, "name", learningState),
      makeCard(2_000_002, "reverse", masteredState), // mastered reverse but name not - excluded
      makeCard(3, "name", newState),
    ];
    const result = filterMastered(cards);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("excludes mastered evolution cards (not a species-mastery leg)", () => {
    // The result set is name-cards only. Include the paired reverse so species 1
    // qualifies, but confirm the evolution card is never in the output.
    const cards = [
      makeCard(1, "name", masteredState),
      makeCard(2000001, "reverse", masteredState), // paired reverse - needed for species mastery
      makeCard(1500001, "evolution", masteredState),
    ];
    const result = filterMastered(cards);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("excludes non-name card types from the output but reverse contributes to mastery gate", () => {
    // Reverse card ID 2000001 corresponds to species 1.
    // Species 1 is mastered because BOTH name (id=1) and reverse (id=2000001) are mastered.
    // The output contains only the name card.
    const cards = [
      makeCard(1, "name", masteredState),
      makeCard(2000001, "reverse", masteredState),
    ];
    const result = filterMastered(cards);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("excludes mastered cry cards (not a species-mastery leg)", () => {
    // Include the paired reverse for species 1 so it is actually mastered.
    const cards = [
      makeCard(1, "name", masteredState),
      makeCard(2000001, "reverse", masteredState), // paired reverse
      makeCard(3000001, "cry", masteredState),
    ];
    const result = filterMastered(cards);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("returns empty array when no cards are mastered", () => {
    expect(filterMastered([makeCard(1, "name", learningState)])).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(filterMastered([])).toHaveLength(0);
  });

  it("forceAllMastered returns every name card even when none are mastered", () => {
    const cards = [
      makeCard(1, "name", learningState),
      makeCard(2, "name", newState),
      makeCard(3, "name", masteredState),
    ];
    const result = filterMastered(cards, true);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.id).sort()).toEqual([1, 2, 3]);
  });

  it("forceAllMastered still excludes non-name card types", () => {
    const cards = [
      makeCard(1, "name", newState),
      makeCard(1500001, "evolution", masteredState),
      makeCard(2000001, "reverse", masteredState),
      makeCard(3000001, "cry", masteredState),
    ];
    const result = filterMastered(cards, true);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("honours a higher masteryRepetitions threshold", () => {
    // reps: 3 satisfies the default threshold but not a custom threshold of 5.
    // Supply the paired reverse card too - both need to fail the higher threshold.
    const cards = [
      makeCard(1, "name", masteredState),
      makeCard(2000001, "reverse", masteredState),
    ];
    expect(filterMastered(cards, false, 5)).toHaveLength(0);
  });

  it("honours a lower masteryRepetitions threshold", () => {
    // reps: 2 is not mastered under the default threshold of 3, but is mastered
    // once the threshold drops to 2 (scheduledDays is already >= 21). Supply a
    // paired reverse card at the same state so BOTH legs clear the lower threshold.
    const lowRepState = makeState({
      reps: 2,
      scheduledDays: 21,
      lastReview: "2026-05-01",
      firstSeen: "2026-04-01",
      fsrsState: "review",
    });
    const lowRepCard = makeCard(1, "name", lowRepState);
    const lowRepReverse = makeCard(2000001, "reverse", lowRepState);
    expect(filterMastered([lowRepCard, lowRepReverse], false)).toHaveLength(0);
    expect(filterMastered([lowRepCard, lowRepReverse], false, 2)).toHaveLength(1);
  });

  it("forceAllMastered overrides a higher masteryRepetitions threshold", () => {
    const cards = [makeCard(1, "name", learningState)];
    // Even with a threshold the card cannot meet, forceAllMastered lets it through.
    expect(filterMastered(cards, true, 10)).toHaveLength(1);
  });

  it("locale scoping: only returns name cards whose locale matches (#1259)", () => {
    // Species 1 is mastered in "ja"; species 2 is mastered in "en".
    const jaName = { ...makeCard(1, "name", masteredState), locale: "ja" as const };
    const jaReverse = { ...makeCard(2_000_001, "reverse", masteredState), locale: "ja" as const };
    const enName = { ...makeCard(2, "name", masteredState), locale: "en" as const };
    const enReverse = { ...makeCard(2_000_002, "reverse", masteredState), locale: "en" as const };

    const all: ReturnType<typeof makeCard>[] = [jaName, jaReverse, enName, enReverse];

    const jaResult = filterMastered(all as ReturnType<typeof makeCard>[], false, 3, "ja");
    expect(jaResult).toHaveLength(1);
    expect(jaResult[0].id).toBe(1);

    const enResult = filterMastered(all as ReturnType<typeof makeCard>[], false, 3, "en");
    expect(enResult).toHaveLength(1);
    expect(enResult[0].id).toBe(2);
  });

  it("locale scoping: cards without locale field default to en (#1259)", () => {
    // Pre-#1259 cards have no locale - they default to "en".
    const cards = [
      makeCard(1, "name", masteredState),       // no locale → en
      makeCard(2_000_001, "reverse", masteredState), // no locale → en
    ];
    // Scoped to "en" - should find species 1
    expect(filterMastered(cards, false, 3, "en")).toHaveLength(1);
    // Scoped to "ja" - should find nothing
    expect(filterMastered(cards, false, 3, "ja")).toHaveLength(0);
  });

  it("forceAllMastered with locale: only returns name cards for the given locale (#1259)", () => {
    // forceAllMastered bypasses the FSRS gate but still respects locale.
    const jaName = { ...makeCard(1, "name", newState), locale: "ja" as const };
    const enName = { ...makeCard(2, "name", newState), locale: "en" as const };
    const cards = [jaName, enName];

    const jaResult = filterMastered(cards as ReturnType<typeof makeCard>[], true, 3, "ja");
    expect(jaResult).toHaveLength(1);
    expect(jaResult[0].id).toBe(1);

    const enResult = filterMastered(cards as ReturnType<typeof makeCard>[], true, 3, "en");
    expect(enResult).toHaveLength(1);
    expect(enResult[0].id).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// markSeenInPasture
// ---------------------------------------------------------------------------

describe("markSeenInPasture", () => {
  it("sets seenInPasture to true on the matching card", () => {
    const card = makeCard(42, "name", masteredState);
    const session = { cards: [card] };
    const updated = markSeenInPasture(42, session);
    expect(updated.cards[0].state.seenInPasture).toBe(true);
  });

  it("does not mutate the original session", () => {
    const card = makeCard(42, "name", masteredState);
    const session = { cards: [card] };
    markSeenInPasture(42, session);
    expect(session.cards[0].state.seenInPasture).toBe(false);
  });

  it("leaves other cards unchanged", () => {
    const card1 = makeCard(1, "name", masteredState);
    const card2 = makeCard(2, "name", masteredState);
    const session = { cards: [card1, card2] };
    const updated = markSeenInPasture(1, session);
    expect(updated.cards[0].state.seenInPasture).toBe(true);
    expect(updated.cards[1].state.seenInPasture).toBe(false);
  });

  it("is a no-op when cardId is not found", () => {
    const card = makeCard(1, "name", masteredState);
    const session = { cards: [card] };
    const updated = markSeenInPasture(999, session);
    expect(updated.cards[0].state.seenInPasture).toBe(false);
  });

  it("handles empty card array", () => {
    const session = { cards: [] };
    const updated = markSeenInPasture(1, session);
    expect(updated.cards).toHaveLength(0);
  });
});
