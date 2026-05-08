import seedData from "@/lib/pokemon/generated.json";

export type EvolutionNode = {
  speciesId: number;
  name: string;
  evolvesFromId: number | null;
};

export type PokemonStats = {
  hp: number;
  attack: number;
  defense: number;
  specialAttack: number;
  specialDefense: number;
  speed: number;
};

export type SeedPokemon = {
  id: number;
  name: string;
  spriteUrl: string;
  types: string[];
  stats: PokemonStats;
  flavorText: string;
  flavorTexts: string[];
  evolutionChain: EvolutionNode[];
  height: number | null;
  weight: number | null;
  baseExperience: number | null;
  genus: string | null;
  generation: string | null;
  captureRate: number | null;
  baseHappiness: number | null;
  growthRate: string | null;
  habitat: string | null;
  genderRate: number | null;
  isLegendary: boolean;
  isMythical: boolean;
};

export const SEED_POKEMON: readonly SeedPokemon[] = seedData as unknown as readonly SeedPokemon[];
