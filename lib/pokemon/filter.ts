import { generationOf } from "@/lib/stats/derive";
import type { SeedPokemon } from "@/lib/pokemon/seed";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import type { CardClass } from "@/lib/stats/derive";

export type PokemonCellData = SeedPokemon & {
  cardClass: CardClass;
  /**
   * Mastery-proximity score for sorting (#1314).
   * Only present when the species has been reviewed but not yet mastered
   * (reps * 1000 + scheduledDays). Absent for locked or mastered species.
   */
  proximityScore?: number;
};

export type MasteryStatus = "all" | "mastered" | "not-yet-mastered";

/**
 * Sort order for the Pokédex grid (#1314).
 *   "national"  — National Number (default, ascending ID)
 *   "alpha"     — Alphabetical A-Z by display name
 *   "proximity" — Closest to mastery first (reviewed-but-unmastered ranked
 *                 by reps+scheduledDays, mastered last, unreviewed last)
 */
export type PokedexSort = "national" | "alpha" | "proximity";

export type PokedexFilters = {
  query: string;              // substring match on name or form displayName; empty = no filter
  types: string[];            // AND/intersection: pokemon must have all selected types; empty = no type filter
  gen: number | null;         // null = all gens; 1–9 = specific gen
  hasAlternateForms: boolean; // true = only species with at least one non-default form
  masteryStatus: MasteryStatus; // "all" = no mastery filter; "mastered" / "not-yet-mastered" = filter by cardClass
  sort: PokedexSort;          // sort order for the filtered grid
};

// Pre-compute a map from speciesId → non-default form displayNames for fast
// lookup in the query filter. Built once at module load time.
const FORM_DISPLAY_NAMES_BY_SPECIES_ID: ReadonlyMap<number, string[]> = (() => {
  const map = new Map<number, string[]>();
  for (const p of SEED_POKEMON) {
    if (!p.isDefaultForm && p.speciesId !== undefined && p.displayName !== undefined) {
      const existing = map.get(p.speciesId) ?? [];
      existing.push(p.displayName);
      map.set(p.speciesId, existing);
    }
  }
  return map;
})();

// Pre-compute the set of speciesIds that have at least one non-default form.
const SPECIES_WITH_ALTERNATE_FORMS: ReadonlySet<number> = new Set(
  FORM_DISPLAY_NAMES_BY_SPECIES_ID.keys(),
);

/**
 * Sort a filtered pokemon array according to `sort`.
 *
 * "national"  — original input order (ascending ID, matches SEED_POKEMON order)
 * "alpha"     — A-Z by `name` (lowercase comparison)
 * "proximity" — reviewed-but-unmastered species ranked by proximityScore desc,
 *               mastered species next, then unreviewed (locked) species last.
 *               Within each tier, ties break by id ascending for determinism.
 */
export function sortPokemon(
  pokemon: PokemonCellData[],
  sort: PokedexSort,
): PokemonCellData[] {
  if (sort === "national") return pokemon;

  const sorted = [...pokemon];

  if (sort === "alpha") {
    sorted.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    return sorted;
  }

  // "proximity": tier 0 = unmastered+reviewed (has proximityScore), tier 1 = mastered, tier 2 = locked
  function proximityTier(p: PokemonCellData): number {
    if (p.cardClass === "learning" && p.proximityScore !== undefined) return 0;
    if (p.cardClass === "mastered") return 1;
    // locked or learning-but-no-score (edge case)
    return 2;
  }

  sorted.sort((a, b) => {
    const tierDiff = proximityTier(a) - proximityTier(b);
    if (tierDiff !== 0) return tierDiff;
    // Within tier 0, rank by proximity score descending
    if (proximityTier(a) === 0) {
      const scoreA = a.proximityScore ?? 0;
      const scoreB = b.proximityScore ?? 0;
      const scoreDiff = scoreB - scoreA;
      if (scoreDiff !== 0) return scoreDiff;
    }
    // Tie-break by id ascending
    return a.id - b.id;
  });

  return sorted;
}

export function filterPokemon(
  pokemon: PokemonCellData[],
  filters: PokedexFilters,
): PokemonCellData[] {
  const filtered = pokemon.filter((p) => {
    if (filters.query !== "") {
      const q = filters.query.toLowerCase().trim();
      const nameMatches = p.name.toLowerCase().includes(q);
      const formNames = FORM_DISPLAY_NAMES_BY_SPECIES_ID.get(p.speciesId ?? p.id) ?? [];
      const formMatches = formNames.some((fn) => fn.toLowerCase().includes(q));
      if (!nameMatches && !formMatches) {
        return false;
      }
    }

    if (filters.types.length > 0) {
      if (!filters.types.every((t) => p.types.includes(t))) {
        return false;
      }
    }

    if (filters.gen !== null) {
      // speciesId falls back to id for pre-expansion seed entries where the
      // field is not yet populated (speciesId === id for all default-form seeds).
      if (generationOf(p.speciesId ?? p.id) !== filters.gen) {
        return false;
      }
    }

    if (filters.hasAlternateForms) {
      if (!SPECIES_WITH_ALTERNATE_FORMS.has(p.speciesId ?? p.id)) {
        return false;
      }
    }

    if (filters.masteryStatus !== "all") {
      if (filters.masteryStatus === "mastered" && p.cardClass !== "mastered") {
        return false;
      }
      if (filters.masteryStatus === "not-yet-mastered" && p.cardClass === "mastered") {
        return false;
      }
    }

    return true;
  });

  return sortPokemon(filtered, filters.sort);
}

export function parseFilters(
  searchParams: URLSearchParams | { get(name: string): string | null },
): PokedexFilters {
  const query = searchParams.get("q") ?? "";

  const typeParam = searchParams.get("type") ?? "";
  const types = typeParam
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");

  const genParam = searchParams.get("gen");
  const genParsed = genParam !== null ? parseInt(genParam, 10) : NaN;
  const gen = isNaN(genParsed) ? null : genParsed;

  const hasAlternateForms = searchParams.get("forms") === "1";

  const masteryParam = searchParams.get("mastery") ?? "";
  const masteryStatus: MasteryStatus =
    masteryParam === "mastered" || masteryParam === "not-yet-mastered"
      ? masteryParam
      : "all";

  const sortParam = searchParams.get("sort") ?? "";
  const sort: PokedexSort =
    sortParam === "alpha" || sortParam === "proximity" ? sortParam : "national";

  return { query, types, gen, hasAlternateForms, masteryStatus, sort };
}
