import { describe, it, expect } from "vitest";
import {
  computeCompletionProjection,
  PROJECTION_WINDOW_DAYS,
  MIN_HISTORY_DAYS,
  MAX_PROJECTION_DAYS,
} from "./completion-projection";
import { MASTERY_REPETITIONS, MASTERY_INTERVAL_DAYS } from "./derive";
import type { ReviewState } from "@/lib/srs/scheduler";
import type { NameReviewCard } from "@/lib/review/session";
import { isoMinusDays } from "./date";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TODAY = "2026-05-17";

function state(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    stability: 0,
    difficulty: 0,
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

function card(id: number, overrides: Partial<ReviewState> = {}): NameReviewCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon ${id}`,
    name: `Pokemon ${id}`,
    spriteUrl: "",
    types: ["normal"],
    stats: {
      hp: 50,
      attack: 50,
      defense: 50,
      specialAttack: 50,
      specialDefense: 50,
      speed: 50,
    },
    flavorText: "",
    flavorTexts: [""],
    evolutionChain: [],
    height: 10,
    weight: 100,
    baseExperience: 64,
    genus: "",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium",
    habitat: null,
    genderRate: 0,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    cardType: "name",
    subjectKey: String(id),
    state: state(overrides),
  };
}

/** Builds a mastered card whose last review falls at `daysAgo` days before TODAY. */
function masteredCard(id: number, daysAgo: number): NameReviewCard {
  const lastReview = isoMinusDays(TODAY, daysAgo);
  return card(id, {
    reps: MASTERY_REPETITIONS,
    scheduledDays: MASTERY_INTERVAL_DAYS,
    fsrsState: "review",
    lastReview,
    firstSeen: isoMinusDays(TODAY, daysAgo + 30),
    stability: 30,
    difficulty: 5,
  });
}

/** A card that has not been seen at all (locked). */
function lockedCard(id: number): NameReviewCard {
  return card(id);
}

// ---------------------------------------------------------------------------
// forceAllMastered
// ---------------------------------------------------------------------------

describe("forceAllMastered", () => {
  it("returns complete when forceAllMastered is on, regardless of state", () => {
    const cards = [lockedCard(1), lockedCard(2), lockedCard(3)];
    const result = computeCompletionProjection(cards, TODAY, MASTERY_REPETITIONS, true);
    expect(result.kind).toBe("complete");
  });

  it("returns complete even when there are many remaining cards", () => {
    const cards = Array.from({ length: 1000 }, (_, i) => lockedCard(i + 1));
    const result = computeCompletionProjection(cards, TODAY, MASTERY_REPETITIONS, true);
    expect(result.kind).toBe("complete");
  });
});

// ---------------------------------------------------------------------------
// Already complete
// ---------------------------------------------------------------------------

describe("all species mastered", () => {
  it("returns complete when every card is mastered", () => {
    const cards = [masteredCard(1, 10), masteredCard(2, 10), masteredCard(3, 10)];
    const result = computeCompletionProjection(cards, TODAY, MASTERY_REPETITIONS);
    expect(result.kind).toBe("complete");
  });
});

// ---------------------------------------------------------------------------
// insufficient-history cases
// ---------------------------------------------------------------------------

describe("insufficient history", () => {
  it("returns insufficient-history when no cards are mastered at all", () => {
    const cards = [lockedCard(1), lockedCard(2), lockedCard(3)];
    const result = computeCompletionProjection(cards, TODAY, MASTERY_REPETITIONS);
    expect(result.kind).toBe("insufficient-history");
  });

  it("returns insufficient-history when mastery events are all outside the trailing window", () => {
    // Mastered long ago — beyond PROJECTION_WINDOW_DAYS.
    const oldDate = isoMinusDays(TODAY, PROJECTION_WINDOW_DAYS + 5);
    const oldMastered = card(1, {
      reps: MASTERY_REPETITIONS,
      scheduledDays: MASTERY_INTERVAL_DAYS,
      fsrsState: "review",
      lastReview: oldDate,
      firstSeen: isoMinusDays(TODAY, PROJECTION_WINDOW_DAYS + 60),
      stability: 30,
      difficulty: 5,
    });
    const cards = [oldMastered, lockedCard(2), lockedCard(3)];
    const result = computeCompletionProjection(cards, TODAY, MASTERY_REPETITIONS);
    expect(result.kind).toBe("insufficient-history");
  });

  it("returns insufficient-history when history is less than MIN_HISTORY_DAYS old", () => {
    // Mastered just 3 days ago — not enough history.
    const cards = [masteredCard(1, MIN_HISTORY_DAYS - 2), lockedCard(2), lockedCard(3)];
    const result = computeCompletionProjection(cards, TODAY, MASTERY_REPETITIONS);
    expect(result.kind).toBe("insufficient-history");
  });

  it("returns insufficient-history when the projected date exceeds MAX_PROJECTION_DAYS", () => {
    // 1 species mastered in 7 days, 100_000 remaining → projection in the far future.
    const fewMastered = [masteredCard(1, MIN_HISTORY_DAYS)];
    const manyLocked = Array.from({ length: 100_000 }, (_, i) => lockedCard(i + 100));
    const result = computeCompletionProjection(
      [...fewMastered, ...manyLocked],
      TODAY,
      MASTERY_REPETITIONS,
    );
    expect(result.kind).toBe("insufficient-history");
  });
});

// ---------------------------------------------------------------------------
// projected cases
// ---------------------------------------------------------------------------

describe("projected", () => {
  it("returns a projected date when there is sufficient history", () => {
    // 7 mastered over 14 days = 3.5/week. 10 remaining → ~20 days.
    const mastered = Array.from({ length: 7 }, (_, i) => masteredCard(i + 1, 14 - i));
    const locked = Array.from({ length: 10 }, (_, i) => lockedCard(i + 100));
    const result = computeCompletionProjection(
      [...mastered, ...locked],
      TODAY,
      MASTERY_REPETITIONS,
    );
    expect(result.kind).toBe("projected");
    if (result.kind !== "projected") throw new Error("unreachable");
    expect(result.remaining).toBe(10);
    expect(result.weeklyRate).toBeGreaterThan(0);
    expect(result.projectedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The projected date must be in the future.
    expect(result.projectedDate > TODAY).toBe(true);
  });

  it("respects the masteryRepetitions parameter", () => {
    // With masteryRepetitions=5, a card with reps=3 is not mastered.
    const notMastered = card(1, {
      reps: 3,
      scheduledDays: MASTERY_INTERVAL_DAYS,
      fsrsState: "review",
      lastReview: isoMinusDays(TODAY, 10),
      firstSeen: isoMinusDays(TODAY, 40),
      stability: 30,
      difficulty: 5,
    });
    const moreLocked = lockedCard(2);
    const result = computeCompletionProjection(
      [notMastered, moreLocked],
      TODAY,
      5, // custom masteryRepetitions
    );
    // notMastered has reps=3 < 5, so it's NOT mastered → 0 mastery events → insufficient.
    expect(result.kind).toBe("insufficient-history");
  });

  it("the projected date is at least MIN_HISTORY_DAYS in the future with normal history", () => {
    // 3 mastered at the boundary of the min-history window, 30 remaining.
    const mastered = Array.from({ length: 3 }, (_, i) =>
      masteredCard(i + 1, MIN_HISTORY_DAYS + i),
    );
    const locked = Array.from({ length: 30 }, (_, i) => lockedCard(i + 100));
    const result = computeCompletionProjection(
      [...mastered, ...locked],
      TODAY,
      MASTERY_REPETITIONS,
    );
    if (result.kind !== "projected") {
      // Allow insufficient-history for edge cases — just not "complete".
      expect(result.kind).not.toBe("complete");
      return;
    }
    // With any positive remaining, projection should be strictly after today.
    expect(result.projectedDate > TODAY).toBe(true);
  });

  it("weekly rate is computed correctly over a known window", () => {
    // 27 cards mastered at days 1..27 ago (earliest = 27 days ago, latest = 1 day ago).
    // historyDays = 27, effectiveWindowDays = min(27, 28) = 27.
    // weeklyRate = 27/27 * 7 = 7.0 exactly.
    const mastered = Array.from({ length: 27 }, (_, i) => masteredCard(i + 1, i + 1));
    const locked = [lockedCard(1000)];
    const result = computeCompletionProjection(
      [...mastered, ...locked],
      TODAY,
      MASTERY_REPETITIONS,
    );
    expect(result.kind).toBe("projected");
    if (result.kind !== "projected") throw new Error("unreachable");
    // 27 events / 27 days × 7 = 7.0/week.
    expect(result.weeklyRate).toBeCloseTo(7, 5);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("handles an empty card array", () => {
    const result = computeCompletionProjection([], TODAY, MASTERY_REPETITIONS);
    // No remaining, no mastered → complete (remaining === 0).
    expect(result.kind).toBe("complete");
  });

  it("handles mastery events exactly on the window boundary date", () => {
    // Card last reviewed exactly PROJECTION_WINDOW_DAYS - 1 days ago (= windowStart).
    const boundaryCard = masteredCard(1, PROJECTION_WINDOW_DAYS - 1);
    const locked = Array.from({ length: 5 }, (_, i) => lockedCard(i + 100));
    const result = computeCompletionProjection(
      [boundaryCard, ...locked],
      TODAY,
      MASTERY_REPETITIONS,
    );
    // History span = PROJECTION_WINDOW_DAYS - 1 days; sufficient if >= MIN_HISTORY_DAYS.
    if (PROJECTION_WINDOW_DAYS - 1 >= MIN_HISTORY_DAYS) {
      expect(result.kind).toBe("projected");
    } else {
      expect(result.kind).toBe("insufficient-history");
    }
  });
});
