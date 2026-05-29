/**
 * Shared proximity-to-mastery ranking helper.
 *
 * Used by:
 *   - Pokédex "Closest to mastery" sort option (#1314)
 *   - Pasture "Next arrivals" strip (#1316)
 *
 * A card's proximity score is derived from its FSRS state:
 *   score = reps * 1000 + scheduledDays
 *
 * Higher score = closer to mastery. Only reviewed-but-unmastered name cards
 * are returned; mastered and never-reviewed cards are excluded.
 *
 * When `forceAllMastered` is true (superuser pretendAllMastered flag), every
 * species is already considered mastered, so no species can be "closest to
 * mastery" — the function returns an empty array in that case.
 */

import { isMastered, MASTERY_REPETITIONS } from "@/lib/stats/derive";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";
import type { ReviewableCard } from "@/lib/review/session";
import type { AppLocale } from "@/i18n/locales";

export type ProximityEntry = {
  /** Pokemon / species ID (matches NameReviewCard.id). */
  id: number;
  /** English name (card.name). */
  name: string;
  /** Sprite URL for rendering. */
  spriteUrl: string;
  /**
   * Composite proximity score: reps * 1000 + scheduledDays.
   * Higher = closer to mastery.
   */
  score: number;
  /** Reps count from the FSRS state. */
  reps: number;
  /** Scheduled days interval from the FSRS state. */
  scheduledDays: number;
};

export type RankOptions = {
  /**
   * The user's configured mastery threshold.
   * Defaults to MASTERY_REPETITIONS for backward-compatibility.
   */
  masteryRepetitions?: number;
  /**
   * When true (superuser pretendAllMastered), every species is already
   * mastered, so the result is always empty.
   */
  forceAllMastered?: boolean;
  /**
   * Locale to scope name-card selection.
   * Defaults to "en" for backward-compatibility.
   */
  locale?: AppLocale;
  /**
   * Maximum number of entries to return.
   * Defaults to unlimited (returns all qualifying entries).
   */
  limit?: number;
};

/**
 * Return unmastered, reviewed name-cards ranked by proximity to mastery
 * (closest first).
 *
 * A species is "reviewed" when `state.lastReview !== null`.
 * A species is "unmastered" when it has NOT cleared the species-level mastery
 * gate (BOTH name AND reverse cards must be mastered, matching the rule used
 * by filterMastered and masteredSpeciesIds).
 *
 * The return value is a stable array of ProximityEntry items sorted by
 * score descending. Ties are broken by species ID ascending so the order
 * is deterministic across renders.
 */
export function rankByMasteryProximity(
  cards: readonly ReviewableCard[],
  options: RankOptions = {},
): ProximityEntry[] {
  const {
    masteryRepetitions = MASTERY_REPETITIONS,
    forceAllMastered = false,
    locale = "en",
    limit,
  } = options;

  // When pretendAllMastered is on, there are no "unmastered reviewed" species.
  if (forceAllMastered) return [];

  // Build the set of species IDs whose reverse card has cleared the mastery
  // gate in this locale. Mirrors the approach in filterMastered / masteredSpeciesIds.
  const masteredReverseSpecies = new Set<number>();
  for (const card of cards) {
    if (card.cardType !== "reverse") continue;
    if ((card.locale ?? "en") !== locale) continue;
    const speciesId = card.id - REVERSE_ID_OFFSET;
    if (speciesId > 0 && isMastered(card.state, masteryRepetitions)) {
      masteredReverseSpecies.add(speciesId);
    }
  }

  const entries: ProximityEntry[] = [];

  for (const card of cards) {
    if (card.cardType !== "name") continue;
    if ((card.locale ?? "en") !== locale) continue;

    // Must have been reviewed at least once.
    if (card.state.lastReview === null) continue;

    // Must NOT be species-level mastered (both legs required).
    const nameCardMastered = isMastered(card.state, masteryRepetitions);
    const speciesMastered = nameCardMastered && masteredReverseSpecies.has(card.id);
    if (speciesMastered) continue;

    const reps = card.state.reps;
    const scheduledDays = card.state.scheduledDays;
    const score = reps * 1000 + scheduledDays;

    entries.push({
      id: card.id,
      name: card.name,
      spriteUrl: card.spriteUrl,
      score,
      reps,
      scheduledDays,
    });
  }

  // Sort by score descending; tie-break by id ascending for determinism.
  entries.sort((a, b) => {
    const diff = b.score - a.score;
    if (diff !== 0) return diff;
    return a.id - b.id;
  });

  return limit !== undefined ? entries.slice(0, limit) : entries;
}
