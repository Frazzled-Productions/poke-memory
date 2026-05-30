/**
 * Pure helper for the "Next arrivals" Pasture feature (#1316).
 *
 * Ranks unmastered but reviewed/seen species by how close they are to joining
 * the Pasture. The ranking uses a composite score: higher reps first, then
 * nearest (earliest) due date to break ties.
 *
 * Only name-type cards are considered — the strip shows one entry per species,
 * consistent with the pasture itself. The locale parameter ensures we rank
 * cards in the user's current locale, matching the filterMastered convention.
 *
 * When forceAllMastered is true (superuser pretendAllMastered flag), every
 * species is already mastered so there are no arrivals — the function returns
 * an empty array and the UI renders an all-caught-up state.
 */

import { isMastered } from "@/lib/stats/derive";
import type { ReviewableCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";
import { MASTERY_REPETITIONS } from "@/lib/stats/derive";
import type { AppLocale } from "@/i18n/locales";

/** The numeric offset added to a Pokémon ID to produce its reverse-card ID. */
const REVERSE_ID_OFFSET = 2_000_000;

/**
 * A minimal descriptor for a "next arrival" species — only the fields the
 * strip component needs to render a sprite and name.
 */
export type NextArrival = {
  /** The name-card ID (equals the species ID for name cards). */
  id: number;
  speciesId: number;
  name: string;
  spriteUrl: string;
  state: ReviewState;
};

/**
 * Returns up to `limit` upcoming species sorted by proximity to mastery:
 *
 * 1. Must be a name-type card in the given locale.
 * 2. Must have been seen at least once (firstSeen !== null) — "reviewed/seen".
 * 3. Must not already be mastered (honours masteryRepetitions threshold).
 * 4. Must not have a mastered reverse card — once both legs are mastered the
 *    species is in the Pasture, not the arrivals list.
 *
 * Sort order: highest reps first; for equal reps, earliest dueDate first
 * (nearest upcoming review = closest to graduating).
 *
 * Returns an empty array when forceAllMastered is true, because every species
 * is considered mastered in superuser mode.
 */
export function nextArrivals(
  cards: ReviewableCard[],
  forceAllMastered = false,
  masteryRepetitions: number = MASTERY_REPETITIONS,
  locale: AppLocale = "en",
  limit = 5,
): NextArrival[] {
  // Superuser pretendAllMastered: every species is mastered → no arrivals.
  if (forceAllMastered) return [];

  // Build set of species IDs whose reverse card is mastered in this locale.
  const masteredReverseSpecies = new Set<number>();
  for (const card of cards) {
    if (card.cardType !== "reverse") continue;
    if ((card.locale ?? "en") !== locale) continue;
    const speciesId = card.id - REVERSE_ID_OFFSET;
    if (speciesId > 0 && isMastered(card.state, masteryRepetitions)) {
      masteredReverseSpecies.add(speciesId);
    }
  }

  const candidates: NextArrival[] = [];

  for (const card of cards) {
    // Only name-type cards in the right locale.
    if (card.cardType !== "name") continue;
    if ((card.locale ?? "en") !== locale) continue;

    // Must have been seen at least once.
    if (!card.state.firstSeen) continue;

    // Skip already-mastered name cards.
    if (isMastered(card.state, masteryRepetitions)) continue;

    // Skip species where the reverse is also mastered — that species is fully
    // mastered and belongs in the Pasture, not the arrivals list.
    if (masteredReverseSpecies.has(card.id)) continue;

    candidates.push({
      id: card.id,
      speciesId: card.speciesId ?? card.id,
      name: card.name,
      spriteUrl: card.spriteUrl,
      state: card.state,
    });
  }

  // Sort: highest reps first; earliest dueDate breaks ties.
  candidates.sort((a, b) => {
    const repsDiff = b.state.reps - a.state.reps;
    if (repsDiff !== 0) return repsDiff;
    // String comparison is valid for ISO "YYYY-MM-DD" dates.
    return a.state.dueDate.localeCompare(b.state.dueDate);
  });

  return candidates.slice(0, limit);
}
