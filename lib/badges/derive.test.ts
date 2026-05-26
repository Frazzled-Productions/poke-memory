import { describe, it, expect } from "vitest";
import type { ReviewableCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";
import { masteredSpeciesIds } from "./derive";

function mkState(reps: number, scheduledDays: number): ReviewState {
  return {
    stability: 0,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays,
    reps,
    lapses: 0,
    fsrsState: "review",
    dueDate: "2026-05-13",
    lastReview: "2026-05-13",
    firstSeen: "2026-05-13",
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  };
}

function nameCard(id: number, state: ReviewState): ReviewableCard {
  // Cast is fine for tests — the helper only reads cardType, id, and state.
  return { id, cardType: "name", state } as unknown as ReviewableCard;
}

function reverseCard(id: number, state: ReviewState): ReviewableCard {
  return { id, cardType: "reverse", state } as unknown as ReviewableCard;
}

describe("masteredSpeciesIds", () => {
  it("returns an empty set when the cards array is empty", () => {
    expect([...masteredSpeciesIds([], 3, false)]).toEqual([]);
  });

  it("returns an empty set when all cards are non-name directions", () => {
    const cards: ReviewableCard[] = [
      reverseCard(2_000_001, mkState(99, 99)),
      reverseCard(2_000_004, mkState(99, 99)),
    ];
    expect([...masteredSpeciesIds(cards, 3, false)]).toEqual([]);
  });

  it("returns only species whose name card meets the mastery rule", () => {
    // Since #1234, species mastery requires BOTH name AND reverse to be mastered.
    // Supply paired reverse cards (id = 2_000_000 + speciesId) for ids 1 and 25.
    const cards: ReviewableCard[] = [
      nameCard(1, mkState(3, 21)),       // name mastered — exactly at both thresholds
      reverseCard(2_000_001, mkState(3, 21)), // reverse mastered — species 1 fully mastered
      nameCard(4, mkState(2, 21)),       // name: reps one below threshold (N-1) — not mastered
      reverseCard(2_000_004, mkState(3, 21)), // reverse mastered — but name not, so species not
      nameCard(7, mkState(3, 20)),       // name: scheduledDays one below threshold (N-1) — not mastered
      reverseCard(2_000_007, mkState(3, 21)), // reverse mastered — but name not
      nameCard(25, mkState(5, 60)),      // name mastered — comfortably above both
      reverseCard(2_000_025, mkState(5, 60)), // reverse mastered — species 25 fully mastered
    ];
    expect([...masteredSpeciesIds(cards, 3, false)].sort((a, b) => a - b)).toEqual([1, 25]);
  });

  it("ignores non-name card directions when computing the result set", () => {
    // Since #1234, both name AND reverse must be mastered for species mastery.
    // A mastered name card with a mastered reverse → species 1 in the set.
    // A mastered reverse with no name card → not in the set.
    const cards: ReviewableCard[] = [
      nameCard(1, mkState(3, 21)),
      reverseCard(2_000_001, mkState(99, 99)), // paired reverse — both mastered
      // No name card for species 4 — reverse alone is not enough.
      reverseCard(2_000_004, mkState(99, 99)),
    ];
    expect([...masteredSpeciesIds(cards, 3, false)]).toEqual([1]);
  });

  it("includes every name-card species when forceAllMastered is true", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, mkState(0, 0)),
      nameCard(4, mkState(0, 0)),
      reverseCard(2_000_001, mkState(0, 0)),
    ];
    expect([...masteredSpeciesIds(cards, 3, true)].sort((a, b) => a - b)).toEqual([1, 4]);
  });

  it("returns an empty set when forceAllMastered is true but cards is empty", () => {
    expect([...masteredSpeciesIds([], 3, true)]).toEqual([]);
  });

  it("respects a custom masteryRepetitions threshold", () => {
    // Supply paired reverse cards so the two-leg mastery rule is satisfied
    // for the species that qualify. At threshold 4, only id 4's name card
    // meets the reps gate — id 1 has reps=3 which is below 4.
    const cards: ReviewableCard[] = [
      nameCard(1, mkState(3, 21)),
      reverseCard(2_000_001, mkState(4, 21)),
      nameCard(4, mkState(4, 21)),
      reverseCard(2_000_004, mkState(4, 21)),
    ];
    // Requires reps >= 4 — only id 4 qualifies (name reps=4 and reverse reps=4).
    expect([...masteredSpeciesIds(cards, 4, false)]).toEqual([4]);
  });
});
