import seedData from "@/lib/pokemon/generated.json";
import type { EvolutionDetail } from "@/lib/pokemon/triggers";
import { triggerPhrase } from "@/lib/pokemon/triggers";

export type { EvolutionDetail };

export type EvolutionNode = {
  speciesId: number;
  name: string;
  evolvesFromId: number | null;
  // `detail` and `edgeId` are populated by the seed script for edges where
  // evolvesFromId !== null. Roots have detail=null and no edgeId. Both fields
  // are optional in the type so persisted name/reverse cards (which strip
  // evolutionChain on save and re-hydrate from seed on load) continue to
  // validate even when reading older payloads.
  detail?: EvolutionDetail | null;
  edgeId?: number;
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
  flavorTexts: string[] | undefined;
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
  cryUrl: string | null;
};

export const SEED_POKEMON: readonly SeedPokemon[] = seedData as unknown as readonly SeedPokemon[];

// One card per (preEvo, postEvo) edge, with the trigger interpolated into the
// prompt. Branching pre-evolutions (Eevee → 8 forms) produce 8 cards, one per
// branch — each card is independently gradeable and the trigger is the
// gradable signal.
export type EvolutionCard = {
  cardType: "evolution";
  id: number;          // stable edge ID in [1_500_001, 1_999_999); allocated by seed script
  preEvoId: number;
  preEvoName: string;
  preEvoSpriteUrl: string;
  postEvoId: number;
  postEvoName: string;
  postEvoSpriteUrl: string;
  // Natural-English suffix appended after "What does {preEvoName} evolve into".
  // Null for edges whose trigger shape we don't recognise — caller falls back
  // to the bare "?" prompt.
  triggerPhrase: string | null;
};

// Card-id namespaces (kept disjoint by construction; validated at module load):
//   1..MAX_NAME_ID                      name cards
//   [1_000_001, 1_500_000]              LEGACY per-pre-evo evolution cards.
//                                       Issue #262 retired this sub-range.
//                                       Existing cloud rows are orphaned —
//                                       merge drops them via left-join. No
//                                       local card ever lives here again.
//   [1_500_001, 1_999_999]              edge cards (#262).
//   [2_000_001, 2_999_999]              reverse cards.
//   [3_000_001, 3_999_999]              cry cards.
export const EVOLUTION_ID_OFFSET = 1_000_000;
export const EDGE_ID_BASE = 1_500_000; // first edge ID = 1_500_001
export const REVERSE_ID_OFFSET = 2_000_000;
export const CRY_ID_OFFSET = 3_000_000;
const MAX_NAME_ID = EVOLUTION_ID_OFFSET - 1;

export const SEED_EVOLUTION_CARDS: readonly EvolutionCard[] = (() => {
  const cards: EvolutionCard[] = [];
  const seenEdgeIds = new Set<number>();
  // Each edge appears in every species record within its chain (e.g. the
  // Eevee→Vaporeon edge is present in Eevee's, Vaporeon's, and every other
  // eeveelution's record). Filtering on `evolvesFromId === pokemon.id` picks
  // each edge from exactly one species (its parent), so dedupe is implicit;
  // `seenEdgeIds` is a defensive belt for malformed seeds.
  const pokemonById = new Map(SEED_POKEMON.map((p) => [p.id, p]));

  for (const pokemon of SEED_POKEMON) {
    if (pokemon.id <= 0 || pokemon.id > MAX_NAME_ID) {
      throw new Error(
        `Pokemon id ${pokemon.id} (${pokemon.name}) falls outside the name-card namespace [1, ${MAX_NAME_ID}]; the evolution-card ID scheme would collide.`,
      );
    }
    for (const node of pokemon.evolutionChain) {
      if (node.evolvesFromId !== pokemon.id) continue;
      const edgeId = node.edgeId;
      if (typeof edgeId !== "number") {
        throw new Error(
          `Chain edge ${pokemon.name} → ${node.name} is missing an edgeId. Re-run \`npm run seed\` so scripts/seed-pokemon.mjs can allocate stable edge IDs.`,
        );
      }
      if (edgeId <= EDGE_ID_BASE || edgeId >= REVERSE_ID_OFFSET) {
        throw new Error(
          `Edge ID ${edgeId} (${pokemon.name} → ${node.name}) outside reserved sub-range [${EDGE_ID_BASE + 1}, ${REVERSE_ID_OFFSET - 1}].`,
        );
      }
      if (seenEdgeIds.has(edgeId)) continue;
      seenEdgeIds.add(edgeId);
      const postEvo = pokemonById.get(node.speciesId);
      if (!postEvo) {
        throw new Error(
          `Edge ${pokemon.name} → ${node.name} (speciesId ${node.speciesId}) has no matching pokemon in seed data — seed may be incomplete.`,
        );
      }
      cards.push({
        cardType: "evolution",
        id: edgeId,
        preEvoId: pokemon.id,
        preEvoName: pokemon.name,
        preEvoSpriteUrl: pokemon.spriteUrl,
        postEvoId: postEvo.id,
        postEvoName: postEvo.name,
        postEvoSpriteUrl: postEvo.spriteUrl,
        triggerPhrase: triggerPhrase(node.detail ?? null),
      });
    }
  }
  return cards;
})();
