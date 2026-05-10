import { generationOf } from "@/lib/stats/derive";
import type { SeedPokemon } from "@/lib/pokemon/seed";
import type { CardClass } from "@/lib/stats/derive";

export type PokemonCellData = SeedPokemon & { cardClass: CardClass };

export type PokedexFilters = {
  query: string;      // substring match on name; empty = no filter
  types: string[];    // OR logic; empty = no type filter
  gen: number | null; // null = all gens; 1–9 = specific gen
};

export function filterPokemon(
  pokemon: PokemonCellData[],
  filters: PokedexFilters,
): PokemonCellData[] {
  return pokemon.filter((p) => {
    if (filters.query !== "") {
      if (!p.name.toLowerCase().includes(filters.query.toLowerCase().trim())) {
        return false;
      }
    }

    if (filters.types.length > 0) {
      if (!p.types.some((t) => filters.types.includes(t))) {
        return false;
      }
    }

    if (filters.gen !== null) {
      if (generationOf(p.id) !== filters.gen) {
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

  return { query, types, gen };
}
