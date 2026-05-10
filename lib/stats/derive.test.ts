import { describe, it, expect } from "vitest";
import {
  isMastered,
  classifyCard,
  computeStats,
  MASTERY_REPETITIONS,
  MASTERY_INTERVAL_DAYS,
} from "./derive";
import type { ReviewState } from "@/lib/srs/scheduler";
import type { NameReviewCard } from "@/lib/review/session";

const TODAY = "2026-05-10";

function state(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    repetitions: 0,
    interval: 0,
    easeFactor: 2.5,
    dueDate: TODAY,
    lastReview: null,
    firstSeen: null,
    learningStep: null,
    stepStartedAt: null,
    ...overrides,
  };
}

function card(id: number, overrides: Partial<ReviewState> = {}): NameReviewCard {
  return {
    id,
    name: `Pokemon ${id}`,
    spriteUrl: "",
    cardType: "name",
    state: state(overrides),
  };
}

// ---------------------------------------------------------------------------
// isMastered
// ---------------------------------------------------------------------------

describe("isMastered", () => {
  it("returns false for never-reviewed card", () => {
    expect(isMastered(state())).toBe(false);
  });

  it("returns false when reps met but interval below threshold", () => {
    expect(isMastered(state({ repetitions: MASTERY_REPETITIONS, interval: MASTERY_INTERVAL_DAYS - 1 }))).toBe(false);
  });

  it("returns false when interval met but reps below threshold", () => {
    expect(isMastered(state({ repetitions: MASTERY_REPETITIONS - 1, interval: MASTERY_INTERVAL_DAYS }))).toBe(false);
  });

  it("returns true when both reps and interval meet thresholds exactly", () => {
    expect(isMastered(state({ repetitions: MASTERY_REPETITIONS, interval: MASTERY_INTERVAL_DAYS }))).toBe(true);
  });

  it("returns true when both exceed thresholds", () => {
    expect(isMastered(state({ repetitions: 5, interval: 60 }))).toBe(true);
  });

  it("respects a custom masteryRepetitions parameter", () => {
    const s = state({ repetitions: 5, interval: MASTERY_INTERVAL_DAYS });
    expect(isMastered(s, 5)).toBe(true);
    expect(isMastered(s, 6)).toBe(false);
  });

  it("cards with high reps but interval < 21 are NOT mastered (regressions from old single-threshold gate)", () => {
    expect(isMastered(state({ repetitions: 10, interval: 20 }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyCard
// ---------------------------------------------------------------------------

describe("classifyCard", () => {
  it("classifies never-reviewed card as locked", () => {
    expect(classifyCard(card(1))).toBe("locked");
  });

  it("classifies card reviewed once but below mastery as learning", () => {
    expect(classifyCard(card(1, { lastReview: TODAY, repetitions: 1, interval: 1 }))).toBe("learning");
  });

  it("classifies card with high reps but low interval as learning", () => {
    expect(classifyCard(card(1, { lastReview: TODAY, repetitions: MASTERY_REPETITIONS, interval: MASTERY_INTERVAL_DAYS - 1 }))).toBe("learning");
  });

  it("classifies card meeting both thresholds as mastered", () => {
    expect(classifyCard(card(1, { lastReview: TODAY, repetitions: MASTERY_REPETITIONS, interval: MASTERY_INTERVAL_DAYS }))).toBe("mastered");
  });

  it("respects custom masteryRepetitions", () => {
    const c = card(1, { lastReview: TODAY, repetitions: 3, interval: MASTERY_INTERVAL_DAYS });
    expect(classifyCard(c, 3)).toBe("mastered");
    expect(classifyCard(c, 4)).toBe("learning");
  });
});

// ---------------------------------------------------------------------------
// computeStats — mastery boundary
// ---------------------------------------------------------------------------

describe("computeStats mastery boundary", () => {
  it("does not count card with reps >= threshold but interval < 21 as mastered", () => {
    const cards = [card(1, { lastReview: TODAY, repetitions: MASTERY_REPETITIONS, interval: MASTERY_INTERVAL_DAYS - 1 })];
    const result = computeStats(cards, TODAY);
    expect(result.mastered).toBe(0);
    expect(result.learning).toBe(1);
  });

  it("counts card meeting both thresholds as mastered", () => {
    const cards = [card(1, { lastReview: TODAY, repetitions: MASTERY_REPETITIONS, interval: MASTERY_INTERVAL_DAYS })];
    const result = computeStats(cards, TODAY);
    expect(result.mastered).toBe(1);
    expect(result.learning).toBe(0);
  });

  it("respects caller-supplied masteryRepetitions parameter", () => {
    const cards = [card(1, { lastReview: TODAY, repetitions: 3, interval: MASTERY_INTERVAL_DAYS })];
    expect(computeStats(cards, TODAY, 10, 3).mastered).toBe(1);
    expect(computeStats(cards, TODAY, 10, 4).mastered).toBe(0);
  });
});
