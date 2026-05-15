import { generationOf } from "@/lib/stats/derive";
import type { SeedPokemon } from "@/lib/pokemon/seed";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import type { CardClass } from "@/lib/stats/derive";

export type PokemonCellData = SeedPokemon & { cardClass: CardClass };

export type MasteryStatus = "all" | "mastered" | "not-yet-mastered";

export type PokedexFilters = {
  query: string;              // substring match on name or form displayName; empty = no filter
  types: string[];            // AND/intersection: pokemon must have all selected types; empty = no type filter
  gen: number | null;         // null = all gens; 1–9 = specific gen
  hasAlternateForms: boolean; // true = only species with at least one non-default form
  masteryStatus: MasteryStatus; // "all" = no mastery filter; "mastered" / "not-yet-mastered" = filter by cardClass
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

export function filterPokemon(
  pokemon: PokemonCellData[],
  filters: PokedexFilters,
): PokemonCellData[] {
  return pokemon.filter((p) => {
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

  return { query, types, gen, hasAlternateForms, masteryStatus };
}
