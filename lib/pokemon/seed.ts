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
  flavorTexts?: string[];
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

export type EvolutionTarget = { name: string; spriteUrl: string };

export type EvolutionCard = {
  cardType: "evolution";
  id: number;
  pokemonId: number;
  name: string;
  spriteUrl: string;
  evolvesInto: EvolutionTarget[];
};

// Evolution-card IDs live in the [EVOLUTION_ID_OFFSET, EVOLUTION_ID_OFFSET +
// MAX_NAME_ID] namespace, disjoint from name-card IDs (1..MAX_NAME_ID).
// Reverse-card IDs live in [REVERSE_ID_OFFSET, REVERSE_ID_OFFSET + MAX_NAME_ID].
// The hydrate/save paths key cards by id, so any overlap would silently
// merge cards of different types. Validated at module load.
export const EVOLUTION_ID_OFFSET = 1_000_000;
export const REVERSE_ID_OFFSET = 2_000_000;
const MAX_NAME_ID = EVOLUTION_ID_OFFSET - 1;

export const SEED_EVOLUTION_CARDS: readonly EvolutionCard[] = (() => {
  const cards: EvolutionCard[] = [];
  // Keyed by p.id; looked up by n.speciesId — these are the same foreign key
  // (species = primary form), so both fields resolve to the same record.
  const spriteById = new Map(SEED_POKEMON.map((p) => [p.id, p.spriteUrl]));
  for (const pokemon of SEED_POKEMON) {
    if (pokemon.id <= 0 || pokemon.id > MAX_NAME_ID) {
      throw new Error(
        `Pokemon id ${pokemon.id} (${pokemon.name}) falls outside the name-card namespace [1, ${MAX_NAME_ID}]; the evolution-card ID scheme would collide.`,
      );
    }
    const directEvolutions = pokemon.evolutionChain.filter(
      (node) => node.evolvesFromId === pokemon.id,
    );
    if (directEvolutions.length === 0) continue;
    cards.push({
      cardType: "evolution",
      id: EVOLUTION_ID_OFFSET + pokemon.id,
      pokemonId: pokemon.id,
      name: pokemon.name,
      spriteUrl: pokemon.spriteUrl,
      evolvesInto: directEvolutions.map((n) => {
        const sprite = spriteById.get(n.speciesId);
        if (sprite === undefined) {
          throw new Error(
            `Evolution target speciesId ${n.speciesId} (${n.name}) has no sprite in seed data — seed may be incomplete.`,
          );
        }
        return { name: n.name, spriteUrl: sprite };
      }),
    });
  }
  return cards;
})();
