import coreData from "@/lib/pokemon/generated-core.json";
import chainsData from "@/lib/pokemon/generated-chains.json";

// ---------------------------------------------------------------------------
// Import everything from seed-builder.ts (JSON-free) for local use and
// re-export, so every existing import site continues to work unchanged.
// ---------------------------------------------------------------------------

import {
  buildSeed,
  EVOLUTION_ID_OFFSET,
  EDGE_ID_BASE,
  REVERSE_ID_OFFSET,
  REVERSE_EDGE_ID_BASE,
  CRY_ID_OFFSET,
  reverseEdgeIdFor,
  isReverseEdgeId,
} from "@/lib/pokemon/seed-builder";

import type {
  PokemonNameLocale,
  TransliterationLocale,
  PokemonLocaleNames,
  EvolutionDetail,
  FlavorTextEntry,
  EvolutionNode,
  PokemonStats,
  FormCategory,
  SeedPokemon,
  EvolutionCard,
  ReverseEvolutionCard,
  SeedData,
} from "@/lib/pokemon/seed-builder";

export type {
  PokemonNameLocale,
  TransliterationLocale,
  PokemonLocaleNames,
  EvolutionDetail,
  FlavorTextEntry,
  EvolutionNode,
  PokemonStats,
  FormCategory,
  SeedPokemon,
  EvolutionCard,
  ReverseEvolutionCard,
  SeedData,
};

export {
  EVOLUTION_ID_OFFSET,
  EDGE_ID_BASE,
  REVERSE_ID_OFFSET,
  REVERSE_EDGE_ID_BASE,
  CRY_ID_OFFSET,
  reverseEdgeIdFor,
  isReverseEdgeId,
  buildSeed,
};

// ---------------------------------------------------------------------------
// Synchronous module-level exports (existing public API - unchanged)
// ---------------------------------------------------------------------------

// Reconstruct the full SeedPokemon array by joining the core data with the
// deduplicated evolution chains. Each Pokémon in generated-core.json omits
// `flavorTexts` and `evolutionChain` to reduce the bundled JS chunk size
// (~1.2 MB bundled vs ~2.9 MB with both fields inline). The chain for each
// Pokémon is resolved from the compact chains map in generated-chains.json.
// `flavorTexts` stays absent from the runtime SEED_POKEMON (it is
// `FlavorTextEntry[] | string[] | undefined`); the facts panel loads it lazily
// via `loadFlavorTexts()` in `lib/pokemon/facts.ts`.

const _built = buildSeed(coreData, chainsData);

export const SEED_POKEMON: readonly SeedPokemon[] = _built.seedPokemon;
export const SEED_EVOLUTION_CARDS: readonly EvolutionCard[] =
  _built.seedEvolutionCards;
export const SEED_REVERSE_EVOLUTION_CARDS: readonly ReverseEvolutionCard[] =
  _built.seedReverseEvolutionCards;
