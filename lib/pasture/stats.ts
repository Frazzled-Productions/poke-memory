/**
 * Pure helpers for per-biome statistics on the Pasture page (#623).
 *
 * These helpers are stateless and take only the data they need, making them
 * straightforward to unit-test and safe to call from both client components
 * and (if ever needed) server-side helpers.
 */

import { getSeedIfLoaded } from "@/lib/pokemon/seed-async";
import type { NameReviewCard } from "@/lib/review/session";

/** Total species count per habitat, derived lazily once the seed has loaded. */
let _biomeTotalsCache: Readonly<Record<string, number>> | null = null;

function getBiomeTotals(): Readonly<Record<string, number>> {
  if (_biomeTotalsCache !== null) return _biomeTotalsCache;
  const seed = getSeedIfLoaded();
  if (!seed) return {};
  const counts: Record<string, number> = {};
  for (const p of seed.seedPokemon) {
    // Only default forms count toward the species total - regional variants and
    // alternate formes are not independent species in the Pokédex sense.
    if (!p.isDefaultForm) continue;
    const habitat = p.habitat ?? "unknown";
    counts[habitat] = (counts[habitat] ?? 0) + 1;
  }
  _biomeTotalsCache = counts;
  return counts;
}

export type BiomeStats = {
  /** Number of mastered (or force-mastered) species in this biome. */
  masteredCount: number;
  /** Total default-form species belonging to this biome in the seed data. */
  totalCount: number;
  /** Percentage of the biome captured, as a number in [0, 100]. */
  capturedPercent: number;
  /**
   * The most recently mastered Pokémon in this biome, or null if the biome has
   * no mastered species. Carries both the `speciesId` (so the renderer can
   * resolve the locale-appropriate name via `useLocalePokemonName`, #1662) and
   * the English `name` as a fallback. Sort key is `state.firstSeen` - an
   * acceptable approximation noted in the issue; the precise mastery-transition
   * date is more expensive to derive.
   */
  latestAddition: { speciesId: number; name: string } | null;
};

/**
 * Computes statistics for a single biome.
 *
 * @param habitatKey - The PokéAPI habitat key (e.g. "forest") or "unknown".
 * @param allMasteredCards - All mastered name-cards for the current session
 *   (already filtered to cardType="name" and isMastered=true by the caller,
 *   or synthesised from SEED_POKEMON when forceAllMastered is on).
 * @param forceAllMastered - When true, treats every species in the biome as
 *   mastered (superuser `pretendAllMastered` flag). masteredCount equals
 *   totalCount and capturedPercent equals 100.
 */
export function biomeStats(
  habitatKey: string,
  allMasteredCards: NameReviewCard[],
  forceAllMastered = false,
): BiomeStats {
  const totalCount = getBiomeTotals()[habitatKey] ?? 0;

  if (forceAllMastered) {
    // In QA mode every species counts as mastered.
    // Surface the most recently firstSeen card as latest addition.
    // Guard to isDefaultForm so the denominator (BIOME_TOTALS) and numerator
    // use the same species population.
    const biomeCards = allMasteredCards.filter(
      (c) => (c.habitat ?? "unknown") === habitatKey && c.isDefaultForm,
    );
    const latest = latestCard(biomeCards);
    return {
      masteredCount: totalCount,
      totalCount,
      capturedPercent: totalCount > 0 ? 100 : 0,
      latestAddition:
        latest != null ? { speciesId: latest.speciesId, name: latest.name } : null,
    };
  }

  // Guard to isDefaultForm so the numerator matches BIOME_TOTALS' denominator,
  // which only counts default-form species. Without this guard, alternate formes
  // and regional variants would inflate masteredCount above totalCount.
  //
  // No isMastered() re-check here: callers pre-filter via filterMastered() with
  // the user's configured masteryRepetitions before passing allMasteredCards in.
  // Re-applying the default threshold (3) would silently undercount for users
  // who set masteryRepetitions below 3 (e.g. 1 or 2). Trust the caller contract.
  const biomeCards = allMasteredCards.filter(
    (c) => (c.habitat ?? "unknown") === habitatKey && c.isDefaultForm,
  );

  const masteredCount = biomeCards.length;
  const capturedPercent =
    totalCount > 0 ? Math.round((masteredCount / totalCount) * 100) : 0;

  const latest = latestCard(biomeCards);

  return {
    masteredCount,
    totalCount,
    capturedPercent,
    latestAddition:
      latest != null ? { speciesId: latest.speciesId, name: latest.name } : null,
  };
}

/** Returns the card with the most-recent non-null firstSeen date. */
function latestCard(cards: NameReviewCard[]): NameReviewCard | null {
  if (cards.length === 0) return null;

  let best: NameReviewCard | null = null;
  for (const card of cards) {
    const fs = card.state.firstSeen;
    if (fs === null) continue;
    if (best === null || (best.state.firstSeen !== null && fs > best.state.firstSeen)) {
      best = card;
    }
  }
  // If every firstSeen is null (common for synthesised superuser cards, which
  // have no real review history), fall back to the last card in array order.
  // In QA mode this produces an arbitrary "Latest addition" display; that is
  // acceptable because the superuser flag is for testing only.
  return best ?? cards[cards.length - 1];
}
