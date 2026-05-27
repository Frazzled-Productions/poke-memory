import coreData from "@/lib/pokemon/generated-core.json";
import chainsData from "@/lib/pokemon/generated-chains.json";
import type { EvolutionDetail } from "@/lib/pokemon/triggers";
import { triggerPhrase } from "@/lib/pokemon/triggers";
import type { FormCategory } from "@/lib/pokemon/forms";

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

export type { FormCategory };

export type SeedPokemon = {
  id: number;
  /**
   * The PokéAPI species ID. For default forms, speciesId === id. For
   * alternate forms (e.g. Alolan Raichu, id=10100), speciesId is the base
   * species ID (26 for Raichu). Added in #445.
   */
  speciesId: number;
  /**
   * True for the primary variety of a species (varieties[0]). False for all
   * alternate forms. Added in #445.
   */
  isDefaultForm: boolean;
  /**
   * Broad category used for future scope-toggle filtering. Added in #445.
   * - "default"  — the base form of a species
   * - "regional" — Alolan/Galarian/Hisuian/Paldean variant
   * - "mega"     — Mega Evolution (excluded from v1 scope, is_battle_only)
   * - "gmax"     — Gigantamax (excluded from v1 scope, is_battle_only)
   * - "primal"   — Primal Reversion (excluded from v1 scope, is_battle_only)
   * - "forme"    — other out-of-battle forme (Rotom, Deoxys, Ogerpon, etc.)
   */
  formCategory: FormCategory;
  /**
   * The PokéAPI form_name slug, or null for default forms.
   * Examples: "alola", "galar", "mega-x", "gmax", "heat" (Rotom).
   * Added in #445.
   */
  formSlug: string | null;
  /**
   * Human-readable display name. For default forms this is the canonical
   * species name (e.g. "Raichu"). For alternate forms this comes from
   * pokemon-form.names[] (English), falling back to title-cased slug
   * (e.g. "Alolan Raichu"). Added in #445.
   */
  displayName: string;
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
  /**
   * PokéAPI version-group slugs whose pokedex includes this species/form.
   * Sorted, deduplicated. Empty array is only used as a defensive fallback —
   * after `scripts/seed-version-groups.mjs` runs every entry has at least one
   * version-group.
   *
   * For regional alternate forms (Alolan/Galarian/Hisuian/Paldean) the list is
   * narrowed to version-groups whose pokedex matches the regional prefix, so
   * Alolan Raichu's list contains only sun-moon and ultra-sun-ultra-moon, not
   * every dex Raichu the species appears in.  Non-regional formes (Rotom
   * appliances, Deoxys formes, etc.) share the default species' membership.
   *
   * Optional at the TypeScript level so persisted scopes / seeds built before
   * #1089 continue to validate; consumers should treat a missing value as an
   * empty array.
   */
  versionGroups?: string[];
};

// Reconstruct the full SeedPokemon array by joining the core data with the
// deduplicated evolution chains. Each Pokémon in generated-core.json omits
// `flavorTexts` and `evolutionChain` to reduce the bundled JS chunk size
// (~1.2 MB bundled vs ~2.9 MB with both fields inline). The chain for each
// Pokémon is resolved from the compact chains map in generated-chains.json.
// `flavorTexts` stays absent from the runtime SEED_POKEMON (it is
// `string[] | undefined`); the facts panel loads it lazily via
// `loadFlavorTexts()` in `lib/pokemon/facts.ts`.

type ChainsPayload = {
  chains: Record<string, EvolutionNode[]>;
  pokemonChain: Record<string, string>;
};

const _chainsPayload = chainsData as unknown as ChainsPayload;
const _chainMap = _chainsPayload.chains;
const _pokemonChainRef = _chainsPayload.pokemonChain;

export const SEED_POKEMON: readonly SeedPokemon[] = (
  coreData as unknown as Array<Omit<SeedPokemon, "evolutionChain" | "flavorTexts">>
).map((p) => {
  const chainHash = _pokemonChainRef[String(p.id)];
  const evolutionChain: EvolutionNode[] = chainHash ? (_chainMap[chainHash] ?? []) : [];
  return { ...p, evolutionChain, flavorTexts: undefined } as SeedPokemon;
});

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
//   [1_500_001, 1_999_999]              forward edge cards (#262).
//   [2_000_001, 2_500_000]              reverse name cards (sprite-picker).
//   [2_500_001, 2_999_999]              reverse evolution edge cards (#343):
//                                       reverseId = REVERSE_EDGE_ID_BASE +
//                                                   (forwardEdgeId - EDGE_ID_BASE)
//   [3_000_001, 3_999_999]              cry cards.
export const EVOLUTION_ID_OFFSET = 1_000_000;
export const EDGE_ID_BASE = 1_500_000; // first forward edge ID = 1_500_001
export const REVERSE_ID_OFFSET = 2_000_000;
export const REVERSE_EDGE_ID_BASE = 2_500_000; // first reverse edge ID = 2_500_001
export const CRY_ID_OFFSET = 3_000_000;
const MAX_NAME_ID = EVOLUTION_ID_OFFSET - 1;

/** Map a forward edge ID to its reverse counterpart. */
export function reverseEdgeIdFor(forwardEdgeId: number): number {
  return REVERSE_EDGE_ID_BASE + (forwardEdgeId - EDGE_ID_BASE);
}

/** True when the id falls in the reverse-evolution edge sub-range. */
export function isReverseEdgeId(id: number): boolean {
  return id > REVERSE_EDGE_ID_BASE && id < CRY_ID_OFFSET;
}

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
      // Alternate-form IDs (10001+) are outside the name-card namespace and
      // must not produce evolution cards — their evolution edges are carried by
      // the default-form record which shares the same chain. Skip rather than
      // throwing so the seed can include forms without breaking this builder.
      // Form-aware evolution cards are #447/#448.
      continue;
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

// One reverse-evolution card per forward edge — same edge data, different ID,
// rendered with the prompt direction flipped ("Which Pokémon evolves into X
// via Y?"). The trigger phrase is reused as-is; the rendering layer reads the
// id namespace to choose the prompt + answer sides.
export type ReverseEvolutionCard = Omit<EvolutionCard, "cardType"> & {
  cardType: "reverse-evolution";
};

export const SEED_REVERSE_EVOLUTION_CARDS: readonly ReverseEvolutionCard[] =
  SEED_EVOLUTION_CARDS.map((fwd) => ({
    ...fwd,
    cardType: "reverse-evolution" as const,
    id: reverseEdgeIdFor(fwd.id),
  }));
