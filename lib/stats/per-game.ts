/**
 * Per-game mastery breakdown for the Stats page (#1313).
 *
 * Aggregates mastered / introduced / total counts for each PokéAPI
 * version-group slug using the same mastery rule as `computeStats`:
 *   - A species is mastered when BOTH its name card AND its paired reverse
 *     card pass the FSRS gate (reps >= masteryRepetitions AND
 *     scheduledDays >= MASTERY_INTERVAL_DAYS).
 *   - In forceAllMastered mode every species is treated as mastered.
 *
 * Only default-form species (isDefaultForm === true) are counted, mirroring
 * the per-generation totals in `computeStats`. This avoids double-counting
 * a species that has alternate forms (e.g. Raichu and Alolan Raichu both
 * appear in the seed but map to the same species).
 *
 * Pure - no I/O, no DOM access, no hooks.
 */

import type { ReviewableCard, NameReviewCard } from "@/lib/review/session";
// Import the numeric constant from seed-builder (no JSON dependency) so
// per-game.ts does NOT force the seed JSON into any shared chunk (#1677).
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed-builder";
import type { SeedPokemon } from "@/lib/pokemon/seed";
import {
  isMastered,
  MASTERY_REPETITIONS,
} from "@/lib/stats/derive";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GameStats = {
  /** PokéAPI version-group slug (e.g. "red-blue"). */
  slug: string;
  total: number;       // default-form species that list this game in versionGroups
  introduced: number;  // species where the name card lastReview !== null
  mastered: number;    // species where both name + reverse pass the mastery gate
};

// ---------------------------------------------------------------------------
// computePerGameStats
// ---------------------------------------------------------------------------

/**
 * Compute mastery totals keyed by version-group slug.
 *
 * @param cards              Full mixed card array (name + reverse + others).
 * @param seed               `SEED_POKEMON` (provides versionGroups per species).
 * @param masteryRepetitions Mastery threshold - defaults to MASTERY_REPETITIONS (3).
 * @param forceAllMastered   Superuser flag: treats every species as mastered.
 * @returns                  One entry per version-group slug that appears in
 *                           at least one seed entry, in seed-insertion order
 *                           (i.e. no guaranteed sort - callers should sort via
 *                           VERSION_GROUP_ORDER for display).
 */
export function computePerGameStats(
  cards: readonly ReviewableCard[],
  seed: readonly SeedPokemon[],
  masteryRepetitions: number = MASTERY_REPETITIONS,
  forceAllMastered = false,
): GameStats[] {
  // Build a lookup from pokemon ID → name card for fast per-species access.
  // Filter to the "en" locale to match the same default as computeStats, so
  // multi-locale sessions don't double-count a species.
  const nameCardById = new Map<number, NameReviewCard>();
  for (const card of cards) {
    if (card.cardType === "name" && ((card as NameReviewCard).locale ?? "en") === "en") {
      nameCardById.set(card.id, card as NameReviewCard);
    }
  }

  // Build the set of species IDs whose reverse card has cleared the mastery
  // gate. Mirrors the identical logic in computeStats.
  const masteredReverseSpecies = new Set<number>();
  for (const card of cards) {
    if (card.cardType !== "reverse") continue;
    const speciesId = card.id - REVERSE_ID_OFFSET;
    if (speciesId > 0 && (forceAllMastered || isMastered(card.state, masteryRepetitions))) {
      masteredReverseSpecies.add(speciesId);
    }
  }

  // Accumulate per-slug totals. We iterate over the seed (not over cards) so
  // every species is counted exactly once in the "total" column even when no
  // card has been introduced yet.
  const slugTotals = new Map<string, { total: number; introduced: number; mastered: number }>();

  for (const pokemon of seed) {
    // Only default forms - alternate forms would double-count a species.
    if (!pokemon.isDefaultForm) continue;

    const slugs = pokemon.versionGroups ?? [];
    if (slugs.length === 0) continue;

    // Resolve name card for this species (pokemon.id for default forms).
    const nameCard = nameCardById.get(pokemon.id);
    const isIntroduced = nameCard !== undefined && nameCard.state.lastReview !== null;
    const nameCardMastered = nameCard !== undefined && isMastered(nameCard.state, masteryRepetitions);
    const isSpeciesMastered = forceAllMastered
      ? true
      : nameCardMastered && masteredReverseSpecies.has(pokemon.id);

    for (const slug of slugs) {
      let entry = slugTotals.get(slug);
      if (entry === undefined) {
        entry = { total: 0, introduced: 0, mastered: 0 };
        slugTotals.set(slug, entry);
      }
      entry.total++;
      if (isIntroduced)      entry.introduced++;
      if (isSpeciesMastered) entry.mastered++;
    }
  }

  return Array.from(slugTotals.entries()).map(([slug, counts]) => ({
    slug,
    ...counts,
  }));
}
