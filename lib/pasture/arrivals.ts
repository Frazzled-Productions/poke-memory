/**
 * Pure helpers for the Pasture feature (#350).
 *
 * The pasture page shows Pokémon the user has mastered, arranged by habitat
 * zone. This module provides the predicates and transforms the UI needs to
 * determine which Pokémon belong in the pasture and to track which have been
 * acknowledged.
 */

export { isMastered } from "@/lib/stats/derive";
import { isMastered, MASTERY_REPETITIONS } from "@/lib/stats/derive";
import type { ReviewableCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";

/**
 * The ReviewSession shape as stored in localStorage / passed through sync.
 * Deliberately minimal — only the fields this module touches.
 */
export type ReviewSession = {
  cards: ReviewableCard[];
};

/**
 * Returns true when the card has just crossed the mastery threshold:
 * before the grade it was not mastered, after it is.
 */
export function justBecameMastered(
  before: ReviewState,
  after: ReviewState,
): boolean {
  return !isMastered(before) && isMastered(after);
}

/**
 * Filters a card array to mastered name-cards only. Evolution, reverse, and
 * cry cards are excluded — the pasture shows one entry per species, keyed on
 * the name card.
 *
 * When `forceAllMastered` is true (superuser `pretendAllMastered` flag), the
 * mastery predicate is bypassed and every name-type card flows through. The
 * cardType filter still applies so the pasture stays one entry per species.
 *
 * `masteryRepetitions` is the user's configured mastery threshold (from
 * `loadSettings().masteryRepetitions`). It defaults to `MASTERY_REPETITIONS`
 * for backward-compatibility, but callers that have the user's settings to
 * hand must pass it through so the pasture honours a custom threshold.
 */
export function filterMastered(
  cards: ReviewableCard[],
  forceAllMastered = false,
  masteryRepetitions: number = MASTERY_REPETITIONS,
): ReviewableCard[] {
  return cards.filter((card) => {
    if (card.cardType !== "name") return false;
    return forceAllMastered || isMastered(card.state, masteryRepetitions);
  });
}

/**
 * Returns a new session with the named card's `seenInPasture` flag set to
 * true. Pure function — the caller is responsible for persisting the result
 * and pushing to the cloud via existing helpers.
 */
export function markSeenInPasture(
  cardId: number,
  session: ReviewSession,
): ReviewSession {
  return {
    ...session,
    cards: session.cards.map((card) =>
      card.id === cardId
        ? { ...card, state: { ...card.state, seenInPasture: true } }
        : card,
    ),
  };
}
