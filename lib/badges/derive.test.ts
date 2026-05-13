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
  it("returns only species whose name card meets the mastery rule", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, mkState(3, 21)), // mastered
      nameCard(4, mkState(2, 21)), // reps below threshold
      nameCard(7, mkState(3, 20)), // interval below threshold
      nameCard(25, mkState(5, 60)), // mastered
    ];
    expect([...masteredSpeciesIds(cards, 3, false)].sort((a, b) => a - b)).toEqual([1, 25]);
  });

  it("ignores non-name card directions", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, mkState(3, 21)),
      // Reverse card for the same species — should not double-count or
      // contribute if the name card were missing.
      reverseCard(2_000_001, mkState(99, 99)),
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

  it("respects a custom masteryRepetitions threshold", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, mkState(3, 21)),
      nameCard(4, mkState(4, 21)),
    ];
    // Requires reps >= 4 — only id 4 qualifies.
    expect([...masteredSpeciesIds(cards, 4, false)]).toEqual([4]);
  });
});
