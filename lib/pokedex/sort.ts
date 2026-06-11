/**
 * lib/pokedex/sort.ts
 *
 * Pure sort helpers for the Pokédex grid. All comparators are stable-sortable
 * (O(n log n) when used with Array.prototype.sort) and accept the full
 * PokemonCellData shape so callers can compose them with filterPokemon without
 * an extra type cast.
 *
 * "Closest to mastery" ranking
 * ----------------------------
 * Species are ordered by their mastery progress, highest first:
 *   1. Mastered species first (all tied at top - they have completed the
 *      journey; within the mastered group, order by id ascending so the grid
 *      stays predictable).
 *   2. Learning species next, sorted by (reps desc, scheduledDays desc) so the
 *      species closest to the mastery gate floats up.
 *   3. Locked species last (never reviewed - nothing to rank), sorted by id.
 *
 * forceAllMastered (superuser pretendAllMastered)
 * -----------------------------------------------
 * When on, every species reads as mastered. The ranking degenerates to a flat
 * group of mastered species sorted by id - indistinguishable from national order
 * within the mastered tier. Callers should pass `forceAllMastered` straight
 * through from useSuperuser().flags.pretendAllMastered.
 */

import type { PokemonCellData } from "@/lib/pokemon/filter";
import type { PokemonNameLocale } from "@/lib/pokemon/seed";
import { getLocaleName } from "@/lib/pokemon/localeNames";

// ---------------------------------------------------------------------------
// Sort key type - carried by PokemonCellData for the "closest to mastery" path
// ---------------------------------------------------------------------------

/**
 * Optional review-state snapshot attached to PokemonCellData by the page layer.
 * Only `reps` and `scheduledDays` are needed for sort ranking - the full
 * ReviewState is not bundled here to keep the type narrow.
 */
export type MasteryProgress = {
  /** FSRS graduated-review count. 0 for locked (never graded) species. */
  reps: number;
  /** FSRS projected interval in days. 0 for locked species. */
  scheduledDays: number;
};

// ---------------------------------------------------------------------------
// Sort option vocabulary
// ---------------------------------------------------------------------------

export type PokedexSortOrder = "national" | "alphabetical" | "closest-to-mastery";

export const VALID_SORT_ORDERS: readonly PokedexSortOrder[] = [
  "national",
  "alphabetical",
  "closest-to-mastery",
];

export function parseSort(value: string | null | undefined): PokedexSortOrder {
  if (value === "alphabetical" || value === "closest-to-mastery") return value;
  return "national";
}

// ---------------------------------------------------------------------------
// Comparators
// ---------------------------------------------------------------------------

/**
 * National Number order (ascending by id). The default Pokédex order.
 */
export function compareByNational(
  a: PokemonCellData,
  b: PokemonCellData,
): number {
  return a.id - b.id;
}

/**
 * Alphabetical order by the displayed name in the active Pokémon-name locale.
 *
 * When `locale` is `"en"` (default), compares using the English seed name
 * (`p.name`) with an `"en"` collator so accented variants (e.g. Flabébé)
 * sort predictably.
 *
 * When a non-English locale is active and the sidecar has loaded, compares by
 * the locale name with a BCP-47 collator matching the locale tag so the sort
 * order matches what users see in the grid.  Falls back to `p.name + "en"`
 * when the sidecar has not loaded yet (graceful degradation).
 *
 * Tie-break: national number ascending.
 */
export function compareAlphabetical(
  a: PokemonCellData,
  b: PokemonCellData,
  locale: PokemonNameLocale = "en",
): number {
  const collatorTag = locale === "en" ? "en" : locale;
  const nameA = (locale !== "en" ? getLocaleName(a.speciesId ?? a.id, locale) : undefined) ?? a.name;
  const nameB = (locale !== "en" ? getLocaleName(b.speciesId ?? b.id, locale) : undefined) ?? b.name;
  const cmp = nameA.localeCompare(nameB, collatorTag, { sensitivity: "base" });
  if (cmp !== 0) return cmp;
  return a.id - b.id;
}

/**
 * Closest-to-mastery order.
 *
 * Tier ordering (lower tier = earlier in list):
 *   0 - mastered
 *   1 - learning (reviewed at least once, not yet mastered)
 *   2 - locked (never reviewed)
 *
 * Within tier 1 (learning), species are sorted by (reps desc, scheduledDays desc)
 * so the species nearest the mastery gate floats to the top.
 *
 * @param forceAllMastered  When true (superuser pretendAllMastered), every
 *   species is treated as mastered. Ranking degenerates to id ascending.
 */
export function compareClosestToMastery(
  a: PokemonCellData,
  b: PokemonCellData,
  forceAllMastered: boolean,
): number {
  if (forceAllMastered) {
    // All mastered - deterministic order by national number.
    return a.id - b.id;
  }

  const tierA = masteryTier(a);
  const tierB = masteryTier(b);

  if (tierA !== tierB) return tierA - tierB;

  // Within the learning tier, rank by progress descending.
  if (tierA === 1) {
    const repsA = a.masteryProgress?.reps ?? 0;
    const repsB = b.masteryProgress?.reps ?? 0;
    if (repsA !== repsB) return repsB - repsA;

    const daysA = a.masteryProgress?.scheduledDays ?? 0;
    const daysB = b.masteryProgress?.scheduledDays ?? 0;
    if (daysA !== daysB) return daysB - daysA;
  }

  // Same tier, same progress (or mastered/locked tiers) - national order.
  return a.id - b.id;
}

/**
 * Apply a sort order to a filtered list of Pokémon. Returns a new sorted array
 * (does not mutate the input).
 *
 * @param pokemon          Already-filtered list.
 * @param sort             The requested sort order.
 * @param forceAllMastered Pass `useSuperuser().flags.pretendAllMastered`.
 * @param locale           The active `pokemonNameLocale`. Passed to
 *                         `compareAlphabetical` so the sort operates on the
 *                         names visible in the grid rather than invisible
 *                         English seed names.
 */
export function sortPokemon(
  pokemon: PokemonCellData[],
  sort: PokedexSortOrder,
  forceAllMastered: boolean,
  locale: PokemonNameLocale = "en",
): PokemonCellData[] {
  if (sort === "national") return [...pokemon].sort(compareByNational);
  if (sort === "alphabetical") return [...pokemon].sort((a, b) => compareAlphabetical(a, b, locale));
  // closest-to-mastery
  return [...pokemon].sort((a, b) =>
    compareClosestToMastery(a, b, forceAllMastered),
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function masteryTier(p: PokemonCellData): 0 | 1 | 2 {
  if (p.cardClass === "mastered") return 0;
  if (p.cardClass === "learning") return 1;
  return 2; // locked
}
