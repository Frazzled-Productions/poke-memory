import { describe, it, expect } from "vitest";
import type { ReviewableCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";
import { masteredSpeciesIds } from "./derive";
import { MASTERY_STABILITY_DAYS } from "@/lib/stats/derive";

/** Build a ReviewState that passes the stability mastery gate. */
function mkMasteredState(): ReviewState {
  return {
    stability: MASTERY_STABILITY_DAYS,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 28,
    reps: 4,
    lapses: 0,
    fsrsState: "review",
    dueDate: "2026-05-20",
    lastReview: "2026-05-13",
    firstSeen: "2026-04-01",
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  };
}

/** Build a ReviewState that does NOT pass the stability mastery gate. */
function mkLearningState(): ReviewState {
  return {
    stability: 5,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 10,
    reps: 2,
    lapses: 0,
    fsrsState: "review",
    dueDate: "2026-05-20",
    lastReview: "2026-05-13",
    firstSeen: "2026-04-01",
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  };
}

/** A new-card state (never reviewed). */
function mkNewState(): ReviewState {
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
  };
}

function nameCard(id: number, state: ReviewState): ReviewableCard {
  // Cast is fine for tests - the helper only reads cardType, id, and state.
  return { id, cardType: "name", state } as unknown as ReviewableCard;
}

function reverseCard(id: number, state: ReviewState): ReviewableCard {
  return { id, cardType: "reverse", state } as unknown as ReviewableCard;
}

describe("masteredSpeciesIds", () => {
  it("returns an empty set when the cards array is empty", () => {
    expect([...masteredSpeciesIds([], false)]).toEqual([]);
  });

  it("returns an empty set when all cards are non-name directions", () => {
    // Reverse cards alone do not produce output: the function only adds species
    // whose NAME card passes the mastery gate.
    const cards: ReviewableCard[] = [
      reverseCard(2_000_001, mkMasteredState()),
      reverseCard(2_000_004, mkMasteredState()),
    ];
    expect([...masteredSpeciesIds(cards, false)]).toEqual([]);
  });

  it("returns only species whose name AND reverse cards satisfy the stability gate (#1765)", () => {
    // Since #1234, species mastery requires BOTH name AND reverse to be mastered.
    // Since #1765, mastery uses stability >= MASTERY_STABILITY_DAYS (not reps gate).
    const cards: ReviewableCard[] = [
      nameCard(1, mkMasteredState()),          // name mastered
      reverseCard(2_000_001, mkMasteredState()), // reverse mastered → species 1 mastered
      nameCard(4, mkLearningState()),          // name not mastered (low stability)
      reverseCard(2_000_004, mkMasteredState()), // reverse mastered but name not → excluded
      nameCard(25, mkMasteredState()),         // name mastered
      reverseCard(2_000_025, mkMasteredState()), // reverse mastered → species 25 mastered
    ];
    expect([...masteredSpeciesIds(cards, false)].sort((a, b) => a - b)).toEqual([1, 25]);
  });

  it("ignores non-name card directions when computing the result set", () => {
    // A mastered name card with a mastered reverse → species 1 in the set.
    // A mastered reverse with no name card → not in the set.
    const cards: ReviewableCard[] = [
      nameCard(1, mkMasteredState()),
      reverseCard(2_000_001, mkMasteredState()), // paired reverse - both mastered
      // No name card for species 4 - reverse alone is not enough.
      reverseCard(2_000_004, mkMasteredState()),
    ];
    expect([...masteredSpeciesIds(cards, false)]).toEqual([1]);
  });

  it("includes every name-card species when forceAllMastered is true", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, mkNewState()),
      nameCard(4, mkNewState()),
      reverseCard(2_000_001, mkNewState()),
    ];
    expect([...masteredSpeciesIds(cards, true)].sort((a, b) => a - b)).toEqual([1, 4]);
  });

  it("returns an empty set when forceAllMastered is true but cards is empty", () => {
    expect([...masteredSpeciesIds([], true)]).toEqual([]);
  });

  it("does NOT count a species whose name stability is below MASTERY_STABILITY_DAYS (#1765)", () => {
    // Old reps gate would have passed reps=3, scheduledDays=21; new stability gate does not.
    const lowStability: ReviewState = { ...mkLearningState(), reps: 10, scheduledDays: 60, stability: MASTERY_STABILITY_DAYS - 1 };
    const cards: ReviewableCard[] = [
      nameCard(7, lowStability),
      reverseCard(2_000_007, mkMasteredState()),
    ];
    expect([...masteredSpeciesIds(cards, false)]).toEqual([]);
  });

  it("locale scoping: only counts name+reverse pairs with matching locale (#1259)", () => {
    // Species 1 is mastered in "ja" only; species 4 is mastered in "en" only.
    const jaName = { id: 1, cardType: "name" as const, state: mkMasteredState(), locale: "ja" as const } as unknown as ReviewableCard;
    const jaReverse = { id: 2_000_001, cardType: "reverse" as const, state: mkMasteredState(), locale: "ja" as const } as unknown as ReviewableCard;
    const enName = { id: 4, cardType: "name" as const, state: mkMasteredState(), locale: "en" as const } as unknown as ReviewableCard;
    const enReverse = { id: 2_000_004, cardType: "reverse" as const, state: mkMasteredState(), locale: "en" as const } as unknown as ReviewableCard;

    const all: ReviewableCard[] = [jaName, jaReverse, enName, enReverse];

    expect([...masteredSpeciesIds(all, false, "ja")]).toEqual([1]);
    expect([...masteredSpeciesIds(all, false, "en")]).toEqual([4]);
  });

  it("locale scoping: cards without locale field default to en (#1259)", () => {
    // Pre-#1259 cards have no locale field - they default to "en".
    const cards: ReviewableCard[] = [
      nameCard(1, mkMasteredState()),
      reverseCard(2_000_001, mkMasteredState()),
    ];
    // Scoped to "en" - should find species 1
    expect([...masteredSpeciesIds(cards, false, "en")]).toEqual([1]);
    // Scoped to "ja" - should find nothing (both cards have no locale, default "en")
    expect([...masteredSpeciesIds(cards, false, "ja")]).toEqual([]);
  });
});
