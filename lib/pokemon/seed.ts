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
  evolutionChain: EvolutionNode[];
};

export const SEED_POKEMON: readonly SeedPokemon[] = seedData as unknown as readonly SeedPokemon[];
