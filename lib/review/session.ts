import type { ReviewState, Grade } from "@/lib/srs/scheduler";
import { initialReviewState } from "@/lib/srs/scheduler";
import type { SeedPokemon } from "@/lib/pokemon/seed";

export type { Grade };

export type ReviewCard = SeedPokemon & {
  state: ReviewState;
};

// Build a fresh session by initialising every seed card to default SM-2 state.
export function buildSession(seed: readonly SeedPokemon[]): ReviewCard[] {
  return seed.map((pokemon) => ({
    ...pokemon,
    state: initialReviewState(),
  }));
}

// Return the card with the earliest dueDate that is <= today (ISO date string).
// If multiple cards share the earliest dueDate, return the one with the lowest id (stable tiebreak).
// Return undefined if no cards are currently due.
export function getNextDueCard(
  cards: readonly ReviewCard[],
  now: Date,
): ReviewCard | undefined {
  const today = now.toISOString().slice(0, 10);

  const due = cards.filter((card) => card.state.dueDate <= today);

  if (due.length === 0) return undefined;

  return due.reduce((earliest, card) => {
    if (card.state.dueDate < earliest.state.dueDate) return card;
    if (card.state.dueDate === earliest.state.dueDate && card.id < earliest.id) return card;
    return earliest;
  });
}
