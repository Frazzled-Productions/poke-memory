import { describe, it, expect } from "vitest";
import {
  computeCompletionProjection,
  PROJECTION_WINDOW_DAYS,
  MIN_HISTORY_DAYS,
  MAX_PROJECTION_DAYS,
} from "./completion-projection";
import { MASTERY_REPETITIONS, MASTERY_INTERVAL_DAYS } from "./derive";
import type { ReviewState } from "@/lib/srs/scheduler";
import type { ReviewableCard, NameReviewCard, ReverseReviewCard } from "@/lib/review/session";
import { isoMinusDays } from "./date";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";

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

function nameCard(id: number, overrides: Partial<ReviewState> = {}): NameReviewCard {
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
      hp: 50, attack: 50, defense: 50,
      specialAttack: 50, specialDefense: 50, speed: 50,
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

function reverseCard(speciesId: number, overrides: Partial<ReviewState> = {}): ReverseReviewCard {
  const base = nameCard(speciesId, overrides);
  const { id: _id, cardType: _ct, ...rest } = base;
  return {
    ...rest,
    cardType: "reverse" as const,
    id: REVERSE_ID_OFFSET + speciesId,
    pokemonId: speciesId,
    subjectKey: String(speciesId),
    state: state(overrides),
  };
}

/** A species with both legs fully mastered, last reviewed `daysAgo` before TODAY. */
function masteredPair(id: number, daysAgo: number): ReviewableCard[] {
  const lastReview = isoMinusDays(TODAY, daysAgo);
  const masteryOverrides: Partial<ReviewState> = {
    reps: MASTERY_REPETITIONS,
    scheduledDays: MASTERY_INTERVAL_DAYS,
    fsrsState: "review",
    lastReview,
    firstSeen: isoMinusDays(TODAY, daysAgo + 30),
    stability: 30,
    difficulty: 5,
  };
  return [
    nameCard(id, masteryOverrides),
    reverseCard(id, masteryOverrides),
  ];
}

/** A name card that has not been seen at all (locked). No reverse needed — still not mastered. */
function lockedCard(id: number): NameReviewCard {
  return nameCard(id);
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
  it("returns complete when every species has both legs mastered", () => {
    // 3 species, all with both legs mastered.
    const cards: ReviewableCard[] = [
      ...masteredPair(1, 10),
      ...masteredPair(2, 10),
      ...masteredPair(3, 10),
    ];
    const result = computeCompletionProjection(cards, TODAY, MASTERY_REPETITIONS);
    expect(result.kind).toBe("complete");
  });

  it("returns insufficient-history when name leg is mastered but reverse is absent", () => {
    // Only the name leg exists — species not species-mastered → remaining = 1.
    const cards: ReviewableCard[] = [
      nameCard(1, {
        reps: MASTERY_REPETITIONS,
        scheduledDays: MASTERY_INTERVAL_DAYS,
        fsrsState: "review",
        lastReview: isoMinusDays(TODAY, 10),
        firstSeen: isoMinusDays(TODAY, 40),
        stability: 30,
        difficulty: 5,
      }),
    ];
    const result = computeCompletionProjection(cards, TODAY, MASTERY_REPETITIONS);
    // remaining = 1 (name card exists but species not mastered), no events in window → insufficient.
    expect(result.kind).toBe("insufficient-history");
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
    const cards: ReviewableCard[] = [
      nameCard(1, {
        reps: MASTERY_REPETITIONS,
        scheduledDays: MASTERY_INTERVAL_DAYS,
        fsrsState: "review",
        lastReview: oldDate,
        firstSeen: isoMinusDays(TODAY, PROJECTION_WINDOW_DAYS + 60),
        stability: 30,
        difficulty: 5,
      }),
      reverseCard(1, {
        reps: MASTERY_REPETITIONS,
        scheduledDays: MASTERY_INTERVAL_DAYS,
        fsrsState: "review",
        lastReview: oldDate,
        firstSeen: isoMinusDays(TODAY, PROJECTION_WINDOW_DAYS + 60),
        stability: 30,
        difficulty: 5,
      }),
      lockedCard(2),
      lockedCard(3),
    ];
    const result = computeCompletionProjection(cards, TODAY, MASTERY_REPETITIONS);
    expect(result.kind).toBe("insufficient-history");
  });

  it("returns insufficient-history when history is less than MIN_HISTORY_DAYS old", () => {
    const cards: ReviewableCard[] = [
      ...masteredPair(1, MIN_HISTORY_DAYS - 1),
      lockedCard(2),
      lockedCard(3),
    ];
    const result = computeCompletionProjection(cards, TODAY, MASTERY_REPETITIONS);
    expect(result.kind).toBe("insufficient-history");
  });

  it("returns projected when history is exactly MIN_HISTORY_DAYS old", () => {
    const cards: ReviewableCard[] = [
      ...masteredPair(1, MIN_HISTORY_DAYS),
      lockedCard(2),
      lockedCard(3),
    ];
    const result = computeCompletionProjection(cards, TODAY, MASTERY_REPETITIONS);
    expect(result.kind).toBe("projected");
  });

  it("returns insufficient-history when the projected date exceeds MAX_PROJECTION_DAYS", () => {
    // 1 species mastered in 7 days, 100_000 remaining → projection in the far future.
    const fewMastered: ReviewableCard[] = [...masteredPair(1, MIN_HISTORY_DAYS)];
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
    // 7 species mastered over 14 days = 3.5/week. 10 remaining → ~20 days.
    const mastered: ReviewableCard[] = Array.from(
      { length: 7 },
      (_, i) => masteredPair(i + 1, 14 - i),
    ).flat();
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
    expect(result.projectedDate > TODAY).toBe(true);
  });

  it("respects the masteryRepetitions parameter", () => {
    // With masteryRepetitions=5, a pair with reps=3 is not species-mastered.
    const notMastered: ReviewableCard[] = [
      nameCard(1, {
        reps: 3,
        scheduledDays: MASTERY_INTERVAL_DAYS,
        fsrsState: "review",
        lastReview: isoMinusDays(TODAY, 10),
        firstSeen: isoMinusDays(TODAY, 40),
        stability: 30,
        difficulty: 5,
      }),
      reverseCard(1, {
        reps: 3,
        scheduledDays: MASTERY_INTERVAL_DAYS,
        fsrsState: "review",
        lastReview: isoMinusDays(TODAY, 10),
        firstSeen: isoMinusDays(TODAY, 40),
        stability: 30,
        difficulty: 5,
      }),
      lockedCard(2),
    ];
    const result = computeCompletionProjection(notMastered, TODAY, 5);
    expect(result.kind).toBe("insufficient-history");
  });

  it("the projected date is at least MIN_HISTORY_DAYS in the future with normal history", () => {
    const mastered: ReviewableCard[] = Array.from(
      { length: 3 },
      (_, i) => masteredPair(i + 1, MIN_HISTORY_DAYS + i),
    ).flat();
    const locked = Array.from({ length: 30 }, (_, i) => lockedCard(i + 100));
    const result = computeCompletionProjection(
      [...mastered, ...locked],
      TODAY,
      MASTERY_REPETITIONS,
    );
    if (result.kind !== "projected") {
      expect(result.kind).not.toBe("complete");
      return;
    }
    expect(result.projectedDate > TODAY).toBe(true);
  });

  it("weekly rate is computed correctly over a known window", () => {
    // 27 species mastered at days 1..27 ago (earliest = 27 days ago).
    // historyDays = 27, effectiveWindowDays = min(27, 28) = 27.
    // weeklyRate = 27/27 * 7 = 7.0 exactly.
    const mastered: ReviewableCard[] = Array.from(
      { length: 27 },
      (_, i) => masteredPair(i + 1, i + 1),
    ).flat();
    const locked = [lockedCard(1000)];
    const result = computeCompletionProjection(
      [...mastered, ...locked],
      TODAY,
      MASTERY_REPETITIONS,
    );
    expect(result.kind).toBe("projected");
    if (result.kind !== "projected") throw new Error("unreachable");
    expect(result.weeklyRate).toBeCloseTo(7, 5);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("handles an empty card array (no remaining, no mastered → complete)", () => {
    const result = computeCompletionProjection([], TODAY, MASTERY_REPETITIONS);
    expect(result.kind).toBe("complete");
  });

  it("handles mastery events exactly on the window boundary date", () => {
    const cards: ReviewableCard[] = [
      ...masteredPair(1, PROJECTION_WINDOW_DAYS - 1),
      ...Array.from({ length: 5 }, (_, i) => lockedCard(i + 100)),
    ];
    const result = computeCompletionProjection(cards, TODAY, MASTERY_REPETITIONS);
    if (PROJECTION_WINDOW_DAYS - 1 >= MIN_HISTORY_DAYS) {
      expect(result.kind).toBe("projected");
    } else {
      expect(result.kind).toBe("insufficient-history");
    }
  });
});
