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

export type EvolutionCard = {
  cardType: "evolution";
  id: number;
  pokemonId: number;
  name: string;
  spriteUrl: string;
  evolvesIntoNames: string[];
  evolvesIntoIds: number[];
};

export const SEED_EVOLUTION_CARDS: readonly EvolutionCard[] = (() => {
  const cards: EvolutionCard[] = [];
  for (const pokemon of SEED_POKEMON) {
    const directEvolutions = pokemon.evolutionChain.filter(
      (node) => node.evolvesFromId === pokemon.id,
    );
    if (directEvolutions.length === 0) continue;
    cards.push({
      cardType: "evolution",
      id: 1_000_000 + pokemon.id,
      pokemonId: pokemon.id,
      name: pokemon.name,
      spriteUrl: pokemon.spriteUrl,
      evolvesIntoNames: directEvolutions.map((n) => n.name),
      evolvesIntoIds: directEvolutions.map((n) => n.speciesId),
    });
  }
  return cards;
})();
