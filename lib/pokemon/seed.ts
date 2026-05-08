import seedData from "@/lib/pokemon/generated.json";

export type SeedPokemon = {
  id: number;        // National PokéDex ID
  name: string;      // Display name, capitalised: "Bulbasaur", "Mr. Mime" etc.
  spriteUrl: string;
};

export const SEED_POKEMON: readonly SeedPokemon[] = seedData as readonly SeedPokemon[];
