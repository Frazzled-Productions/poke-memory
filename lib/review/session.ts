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

// Merge any seed cards not yet in the saved session (e.g. after a seed
// regeneration that added new species). Existing cards keep their progress;
// missing seed entries are appended at initialReviewState — due immediately.
export function hydrateSession(
  saved: readonly ReviewCard[],
  seed: readonly SeedPokemon[],
  now: Date = new Date(),
): ReviewCard[] {
  const savedIds = new Set(saved.map((card) => card.id));
  const additions = seed
    .filter((pokemon) => !savedIds.has(pokemon.id))
    .map((pokemon) => ({ ...pokemon, state: initialReviewState(now) }));
  if (additions.length === 0) return [...saved];
  return [...saved, ...additions];
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
