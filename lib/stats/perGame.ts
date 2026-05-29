/**
 * Per-game mastery breakdown for the Stats page (issue #1313).
 *
 * Computes mastered / total species counts per version-group (game) by walking
 * the seed's `versionGroups` membership, mirroring the approach used by the
 * Games scope filter in `lib/review/scope.ts`. The version-group registry in
 * `lib/pokemon/versionGroupLabels.ts` is the single source of truth for slug
 * → label and slug → generation mappings — this module reuses it directly.
 *
 * Mastery rule: a species is mastered when BOTH its name card and its reverse
 * card have cleared the FSRS gate (`reps >= masteryRepetitions && scheduledDays >= 21`),
 * matching `masteredSpeciesIds` in `lib/badges/derive.ts` and the per-generation
 * logic inside `computeStats`.
 *
 * Pure — no I/O, no hooks, no side effects.
 */

import type { ReviewableCard } from "@/lib/review/session";
import { isMastered, MASTERY_REPETITIONS } from "@/lib/stats/derive";
import { SEED_POKEMON, REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";
import {
  VERSION_GROUP_LABELS,
  versionGroupGeneration,
  compareVersionGroupSlugs,
} from "@/lib/pokemon/versionGroupLabels";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GameStats = {
  /** PokéAPI version-group slug (e.g. "red-blue"). */
  slug: string;
  /** Marketing label (e.g. "Pokémon Red/Blue"). */
  label: string;
  /** Generation bucket (1–9; 0 = other). */
  generation: number;
  /** Number of species in this game's Pokédex. */
  total: number;
  /** Number of mastered species in this game's Pokédex. */
  mastered: number;
};

// ---------------------------------------------------------------------------
// Internal: collect all slugs present in the seed
// ---------------------------------------------------------------------------

let _seedSlugs: readonly string[] | null = null;

/**
 * Return all version-group slugs that appear in at least one SEED_POKEMON entry,
 * sorted by generation then release order (same ordering as the scope picker).
 * Memoised — the seed is a build-time constant.
 */
export function seedVersionGroupSlugs(): readonly string[] {
  if (_seedSlugs !== null) return _seedSlugs;
  const seen = new Set<string>();
  for (const p of SEED_POKEMON) {
    for (const vg of p.versionGroups ?? []) seen.add(vg);
  }
  _seedSlugs = [...seen].sort(compareVersionGroupSlugs);
  return _seedSlugs;
}

// ---------------------------------------------------------------------------
// computePerGameStats
// ---------------------------------------------------------------------------

/**
 * Compute mastered/total species counts for every version-group (game) in the
 * seed. Only default-locale ("en") name + reverse cards are examined — the same
 * locale used by `computeStats` and `masteredSpeciesIds`.
 *
 * Games with zero species in the seed are omitted from the result. The output
 * array is sorted by generation then release order (matching the Games scope
 * picker).
 *
 * @param cards              Full mixed-type card array from the session.
 * @param masteryRepetitions Mastery repetitions threshold (default 3).
 * @param forceAllMastered   Superuser pretendAllMastered flag. When true,
 *                           every species counts as mastered.
 */
export function computePerGameStats(
  cards: readonly ReviewableCard[],
  masteryRepetitions = MASTERY_REPETITIONS,
  forceAllMastered = false,
): GameStats[] {
  // Build the set of species IDs whose reverse card has cleared the mastery
  // gate. This mirrors the same pre-pass in `computeStats` and `masteredSpeciesIds`.
  const masteredReverseSpecies = new Set<number>();
  for (const card of cards) {
    if (card.cardType !== "reverse") continue;
    if ((card.locale ?? "en") !== "en") continue;
    const speciesId = card.id - REVERSE_ID_OFFSET;
    if (speciesId > 0 && (forceAllMastered || isMastered(card.state, masteryRepetitions))) {
      masteredReverseSpecies.add(speciesId);
    }
  }

  // Build a lookup from name-card ID → mastered flag for quick per-species checks.
  const nameCardMasteredById = new Map<number, boolean>();
  for (const card of cards) {
    if (card.cardType !== "name") continue;
    if ((card.locale ?? "en") !== "en") continue;
    const isSpeciesMastered = forceAllMastered
      ? true
      : isMastered(card.state, masteryRepetitions) && masteredReverseSpecies.has(card.id);
    nameCardMasteredById.set(card.id, isSpeciesMastered);
  }

  // Accumulate per-slug totals by iterating all default-form seed entries.
  // A species can appear in multiple games — it contributes to each game's tally.
  const totalBySlug = new Map<string, number>();
  const masteredBySlug = new Map<string, number>();

  for (const p of SEED_POKEMON) {
    // Only count default forms (base species), matching the scope picker's
    // species-level membership semantics and keeping the totals consistent
    // with the per-generation breakdown in `computeStats`.
    if (!p.isDefaultForm) continue;

    const speciesId = p.speciesId ?? p.id;
    // When forceAllMastered is on, every seed species counts as mastered —
    // this mirrors the `computeStats` post-processing override and ensures
    // "pretend all mastered" shows 100% regardless of card state or whether
    // a card has been introduced yet.
    const isSpeciesMastered =
      forceAllMastered || (nameCardMasteredById.get(speciesId) ?? false);

    for (const slug of p.versionGroups ?? []) {
      totalBySlug.set(slug, (totalBySlug.get(slug) ?? 0) + 1);
      if (isSpeciesMastered) {
        masteredBySlug.set(slug, (masteredBySlug.get(slug) ?? 0) + 1);
      }
    }
  }

  // Collect slugs with at least one species and sort by generation/release order.
  const slugs = seedVersionGroupSlugs().filter((s) => (totalBySlug.get(s) ?? 0) > 0);

  return slugs.map((slug) => ({
    slug,
    label: VERSION_GROUP_LABELS[slug] ?? slug,
    generation: versionGroupGeneration(slug),
    total: totalBySlug.get(slug) ?? 0,
    mastered: masteredBySlug.get(slug) ?? 0,
  }));
}

