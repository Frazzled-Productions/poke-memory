/**
 * Species-level mastery event helpers.
 *
 * A species is mastered when BOTH its name card AND its paired reverse card
 * have cleared the FSRS mastery gate (`reps >= masteryRepetitions && scheduledDays >= 21`).
 * This module provides helpers that operate on the FULL card array (all card types)
 * rather than name cards alone, and return species-level mastery data.
 *
 * These helpers are the single source of truth for time-series mastery surfaces
 * (mastery-over-time chart, collection timeline, records, completion projection).
 * They complement `masteredSpeciesIds` (lib/badges/derive.ts) for set/count surfaces.
 */

import type { ReviewableCard, NameReviewCard } from "@/lib/review/session";
// Import the numeric constant from seed-builder (no JSON dependency) so
// mastery-species-events.ts does NOT force the seed JSON into any shared chunk (#1677).
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed-builder";
import { isMastered, MASTERY_REPETITIONS } from "@/lib/stats/derive";
import type { AppLocale } from "@/i18n/locales";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A species-level mastery event.
 *
 * `speciesId` is the numeric Pokémon ID (matches the name card's `id`).
 * `masteredDate` is the YYYY-MM-DD `lastReview` date of whichever leg (name or
 * reverse) crossed the gate LAST - i.e. the date the species became fully mastered.
 */
export type SpeciesMasteryEvent = {
  speciesId: number;
  /** YYYY-MM-DD string. The later of the name card's and reverse card's lastReview dates. */
  masteredDate: string;
};

// ---------------------------------------------------------------------------
// masteredSpeciesEvents
// ---------------------------------------------------------------------------

/**
 * Derive a list of species-level mastery events from the FULL card array
 * (all card types). Only species whose BOTH name card AND paired reverse card
 * are mastered are included. The `masteredDate` is the later of the two
 * `lastReview` dates - i.e. when the SECOND leg crossed the gate.
 *
 * This is the shared helper for:
 *   - `computeMasteryOverTime` (mastery-over-time chart)
 *   - `computeRecords` (avgDaysToMastery, mostMasteredIn7d)
 *   - `computeCompletionProjection` (completion projection)
 *
 * @param cards              Full mixed-type card array from the session.
 * @param masteryRepetitions Mastery threshold from user settings.
 * @param forceAllMastered   Superuser pretendAllMastered flag.
 * @param locale             Card locale to scope mastery checks (default "en").
 */
export function masteredSpeciesEvents(
  cards: readonly ReviewableCard[],
  masteryRepetitions = MASTERY_REPETITIONS,
  forceAllMastered = false,
  locale: AppLocale = "en",
): SpeciesMasteryEvent[] {
  // Build a lookup of reverse-card info keyed by speciesId.
  // Reverse card ID = REVERSE_ID_OFFSET + pokemonId; subtract to get speciesId.
  const reverseInfo = new Map<number, { mastered: boolean; lastReview: string | null }>();
  for (const card of cards) {
    if (card.cardType !== "reverse") continue;
    if ((card.locale ?? "en") !== locale) continue;
    const speciesId = card.id - REVERSE_ID_OFFSET;
    if (speciesId <= 0) continue;
    const mastered = forceAllMastered || isMastered(card.state, masteryRepetitions);
    reverseInfo.set(speciesId, {
      mastered,
      lastReview: card.state.lastReview,
    });
  }

  const events: SpeciesMasteryEvent[] = [];

  for (const card of cards) {
    if (card.cardType !== "name") continue;
    if ((card.locale ?? "en") !== locale) continue;

    const nameCardMastered = forceAllMastered || isMastered(card.state, masteryRepetitions);
    if (!nameCardMastered) continue;

    const rev = reverseInfo.get(card.id);

    if (forceAllMastered) {
      // In forceAllMastered mode every species counts regardless of reverse leg.
      // Use the later of the two lastReview dates as a proxy date, or a sentinel.
      const nameDate = card.state.lastReview;
      const revDate = rev?.lastReview ?? null;
      const masteredDate =
        nameDate && revDate
          ? nameDate > revDate
            ? nameDate
            : revDate
          : nameDate ?? revDate ?? "1970-01-01";
      events.push({ speciesId: card.id, masteredDate });
    } else {
      // Both legs must be mastered for species-level mastery (#1234).
      if (!rev?.mastered) continue;
      const nameDate = card.state.lastReview;
      const revDate = rev.lastReview;
      if (nameDate === null || revDate === null) continue;
      // masteredDate = later of the two lastReview dates (when the SECOND leg crossed).
      const masteredDate = nameDate > revDate ? nameDate : revDate;
      events.push({ speciesId: card.id, masteredDate });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// nameCardsForLocale - extract name cards scoped to a locale
// ---------------------------------------------------------------------------

/**
 * Extract name cards scoped to a given locale from the full card array.
 * Re-usable by helpers that still need per-name-card data (e.g. firstSeen).
 */
export function nameCardsForLocale(
  cards: readonly ReviewableCard[],
  locale: AppLocale = "en",
): NameReviewCard[] {
  return cards.filter(
    (c): c is NameReviewCard => c.cardType === "name" && (c.locale ?? "en") === locale,
  );
}

// ---------------------------------------------------------------------------
// lastReviewForLocale - most-recent review date for a given locale
// ---------------------------------------------------------------------------

/**
 * Returns the lexicographically-greatest non-null `lastReview` ISO date string
 * across all name cards for the given locale, or null when none of those cards
 * have ever been reviewed.
 *
 * Cards with no explicit `locale` field are treated as "en" (legacy cards
 * pre-dating multi-locale support).
 *
 * Used by the Stats page "Languages" card to show when each enrolled locale
 * was last actively reviewed (#1619).
 */
export function lastReviewForLocale(
  cards: readonly ReviewableCard[],
  locale: AppLocale = "en",
): string | null {
  const localeCards = nameCardsForLocale(cards, locale);
  let latest: string | null = null;
  for (const card of localeCards) {
    const lr = card.state.lastReview;
    if (lr !== null && (latest === null || lr > latest)) {
      latest = lr;
    }
  }
  return latest;
}
