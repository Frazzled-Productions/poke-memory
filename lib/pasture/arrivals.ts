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
import type { AppLocale } from "@/i18n/locales";

/** The numeric offset added to a pokémon ID to produce its reverse-card ID. */
const REVERSE_ID_OFFSET = 2_000_000;

/**
 * The ReviewSession shape as stored in localStorage / passed through sync.
 * Deliberately minimal - only the fields this module touches.
 */
export type ReviewSession = {
  cards: ReviewableCard[];
};

/**
 * Returns true when the card has just crossed the mastery threshold:
 * before the grade it was not mastered, after it is.
 *
 * `masteryRepetitions` is the user's configured mastery threshold (from
 * `loadSettings().masteryRepetitions`). It defaults to `MASTERY_REPETITIONS`
 * for backward-compatibility, but callers that have the user's settings to
 * hand must pass it through so the comparison honours a custom threshold.
 */
export function justBecameMastered(
  before: ReviewState,
  after: ReviewState,
  masteryRepetitions: number = MASTERY_REPETITIONS,
): boolean {
  return (
    !isMastered(before, masteryRepetitions) &&
    isMastered(after, masteryRepetitions)
  );
}

/**
 * Filters a card array to species-mastered name-cards only. Evolution, reverse,
 * and cry cards are excluded - the pasture shows one entry per species, keyed
 * on the name card.
 *
 * Since #1234, a species is mastered when BOTH its name card AND its paired
 * reverse card have cleared the FSRS mastery gate. A name card alone is not
 * sufficient.
 *
 * Since #1259, mastery is scoped to the user's current `pokemonNameLocale`.
 * Only cards whose `locale` matches the given `locale` parameter are counted.
 * When `forceAllMastered` is true (superuser `pretendAllMastered` flag), the
 * mastery predicate is bypassed and every name-type card whose locale matches
 * flows through. The cardType filter still applies so the pasture stays one
 * entry per species.
 *
 * `masteryRepetitions` is the user's configured mastery threshold (from
 * `loadSettings().masteryRepetitions`). It defaults to `MASTERY_REPETITIONS`
 * for backward-compatibility, but callers that have the user's settings to
 * hand must pass it through so the pasture honours a custom threshold.
 *
 * `locale` defaults to `"en"` for backward-compatibility.
 */
export function filterMastered(
  cards: ReviewableCard[],
  forceAllMastered = false,
  masteryRepetitions: number = MASTERY_REPETITIONS,
  locale: AppLocale = "en",
): ReviewableCard[] {
  // Build a quick set of species IDs whose reverse card is mastered in this locale.
  // Reverse card ID = REVERSE_ID_OFFSET + pokemonId.
  const masteredReverseSpecies = new Set<number>();
  for (const card of cards) {
    if (card.cardType !== "reverse") continue;
    if ((card.locale ?? "en") !== locale) continue;
    const speciesId = card.id - REVERSE_ID_OFFSET;
    if (speciesId > 0 && (forceAllMastered || isMastered(card.state, masteryRepetitions))) {
      masteredReverseSpecies.add(speciesId);
    }
  }

  return cards.filter((card) => {
    if (card.cardType !== "name") return false;
    if ((card.locale ?? "en") !== locale) return false;
    if (forceAllMastered) return true;
    // Both name and reverse must be mastered for species-level mastery (#1234).
    return (
      isMastered(card.state, masteryRepetitions) &&
      masteredReverseSpecies.has(card.id)
    );
  });
}

/**
 * Returns a new session with the named card's `seenInPasture` flag set to
 * true. Pure function - the caller is responsible for persisting the result
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
