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
});

// ---------------------------------------------------------------------------
// filterMastered
// ---------------------------------------------------------------------------

describe("filterMastered", () => {
  it("returns only mastered name cards", () => {
    const cards = [
      makeCard(1, "name", masteredState),
      makeCard(2, "name", learningState),
      makeCard(3, "name", newState),
    ];
    const result = filterMastered(cards);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("excludes mastered evolution cards", () => {
    const cards = [
      makeCard(1, "name", masteredState),
      makeCard(1500001, "evolution", masteredState),
    ];
    // Evolution cards don't have cardType="name" so only the name card passes.
    // Note: makeCard above puts cardType on the top-level object correctly.
    const result = filterMastered(cards);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("excludes mastered reverse cards", () => {
    const cards = [
      makeCard(1, "name", masteredState),
      makeCard(2000001, "reverse", masteredState),
    ];
    const result = filterMastered(cards);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("excludes mastered cry cards", () => {
    const cards = [
      makeCard(1, "name", masteredState),
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
