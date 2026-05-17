/**
 * Derives evolution-family data for the Evolution Wall visualisation.
 *
 * Each "family" is a single evolution chain from the seed data. The wall
 * shows edge mastery — whether the user has mastered the evolution/reverse-
 * evolution cards that correspond to each link in the chain.
 *
 * Mastery rule (from docs/srs.md + lib/stats/derive.ts):
 *   reps >= masteryRepetitions && scheduledDays >= 21
 */

import { SEED_POKEMON, SEED_EVOLUTION_CARDS, REVERSE_EDGE_ID_BASE, EDGE_ID_BASE } from "@/lib/pokemon/seed";
import type { SeedPokemon } from "@/lib/pokemon/seed";
import type { ReviewableCard, EvolutionReviewCard, ReverseEvolutionReviewCard } from "@/lib/review/session";
import { isMastered } from "@/lib/stats/derive";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single node in the rendered tree. */
export type FamilyNode = {
  speciesId: number;
  name: string;
  spriteUrl: string;
};

/**
 * A directed edge in the family tree.
 * forwardEdgeId corresponds to the forward EvolutionCard id.
 * The reverse edge id is REVERSE_EDGE_ID_BASE + (forwardEdgeId - EDGE_ID_BASE).
 */
export type FamilyEdge = {
  forwardEdgeId: number;
  fromId: number;
  toId: number;
  /** Forward card (preEvo → postEvo) is mastered. */
  forwardMastered: boolean;
  /** Reverse card (postEvo → preEvo direction) is mastered. */
  reverseMastered: boolean;
  /** Both forward and reverse are mastered. */
  fullyMastered: boolean;
};

/**
 * A complete evolution family: a tree of nodes connected by directed edges.
 * Families with no edges (solo species, no evolutions) are excluded from the wall.
 */
export type EvolutionFamily = {
  /** The root speciesId (the earliest species in the chain). */
  rootId: number;
  /** All species in this chain (including root and all evolutions). */
  nodes: readonly FamilyNode[];
  /** All directed edges in this chain. */
  edges: readonly FamilyEdge[];
  /** True when every edge (both directions) is mastered. */
  completed: boolean;
};

/** Summary metrics for the evolution wall headline. */
export type EvolutionWallStats = {
  totalFamilies: number;
  completedFamilies: number;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build a stable key that identifies a chain by its set of species ids. */
function chainKey(nodes: SeedPokemon["evolutionChain"]): string {
  return nodes
    .map((n) => n.speciesId)
    .sort((a, b) => a - b)
    .join(",");
}

// ---------------------------------------------------------------------------
// Pure derivation function
// ---------------------------------------------------------------------------

/**
 * Derives all evolution families with edge-mastery state from the seeded data
 * and the user's current card set.
 *
 * @param cards        The user's full ReviewableCard array (all card types).
 * @param masteryRepetitions  The user's mastery-repetitions setting (default 3).
 * @param forceAllMastered  Honour the `pretendAllMastered` superuser flag.
 */
export function deriveEvolutionFamilies(
  cards: readonly ReviewableCard[],
  masteryRepetitions = 3,
  forceAllMastered = false,
): EvolutionFamily[] {
  // Build lookup maps for evolution card mastery by edge id.
  const forwardMasteredSet = new Set<number>();
  const reverseMasteredSet = new Set<number>();

  if (forceAllMastered) {
    // All edges mastered — populate from SEED_EVOLUTION_CARDS edge ids.
    for (const card of SEED_EVOLUTION_CARDS) {
      forwardMasteredSet.add(card.id);
      reverseMasteredSet.add(REVERSE_EDGE_ID_BASE + (card.id - EDGE_ID_BASE));
    }
  } else {
    for (const card of cards) {
      if (card.cardType === "evolution") {
        const ec = card as EvolutionReviewCard;
        if (isMastered(ec.state, masteryRepetitions)) {
          forwardMasteredSet.add(ec.id);
        }
      } else if (card.cardType === "reverse-evolution") {
        const rc = card as ReverseEvolutionReviewCard;
        if (isMastered(rc.state, masteryRepetitions)) {
          // Reverse card id — store as-is for lookup.
          reverseMasteredSet.add(rc.id);
        }
      }
    }
  }

  // Build a spriteUrl lookup by speciesId.
  const pokemonById = new Map<number, SeedPokemon>(
    SEED_POKEMON.filter((p) => p.isDefaultForm).map((p) => [p.id, p]),
  );

  // Deduplicate chains: each chain appears in every member's evolutionChain array.
  // We key by the sorted set of speciesIds.
  const seenChainKeys = new Set<string>();
  const families: EvolutionFamily[] = [];

  for (const pokemon of SEED_POKEMON) {
    if (!pokemon.isDefaultForm) continue;
    if (pokemon.evolutionChain.length <= 1) continue; // Solo — no edges to display.

    const key = chainKey(pokemon.evolutionChain);
    if (seenChainKeys.has(key)) continue;
    seenChainKeys.add(key);

    // Find the root node (evolvesFromId === null).
    const rootNode = pokemon.evolutionChain.find((n) => n.evolvesFromId === null);
    if (!rootNode) continue;

    // Build node list.
    const nodes: FamilyNode[] = pokemon.evolutionChain.map((n) => {
      const p = pokemonById.get(n.speciesId);
      return {
        speciesId: n.speciesId,
        name: p?.displayName ?? n.name,
        spriteUrl: p?.spriteUrl ?? "",
      };
    });

    // Build edge list from nodes where evolvesFromId !== null.
    const edges: FamilyEdge[] = [];
    for (const node of pokemon.evolutionChain) {
      if (node.evolvesFromId === null) continue;
      if (typeof node.edgeId !== "number") continue;
      const fwdId = node.edgeId;
      const revId = REVERSE_EDGE_ID_BASE + (fwdId - EDGE_ID_BASE);
      const fwdMastered = forwardMasteredSet.has(fwdId);
      const revMastered = reverseMasteredSet.has(revId);
      edges.push({
        forwardEdgeId: fwdId,
        fromId: node.evolvesFromId,
        toId: node.speciesId,
        forwardMastered: fwdMastered,
        reverseMastered: revMastered,
        fullyMastered: fwdMastered && revMastered,
      });
    }

    if (edges.length === 0) continue;

    const completed = edges.every((e) => e.fullyMastered);
    families.push({
      rootId: rootNode.speciesId,
      nodes,
      edges,
      completed,
    });
  }

  // Sort: in-progress families first (at least one mastered edge, not completed),
  // then untouched (nothing mastered yet), then fully completed last — so "still
  // to do" is never buried behind "done" in the default view. Within each group,
  // sort by rootId for stability.
  families.sort((a, b) => {
    const aScore = familySortScore(a);
    const bScore = familySortScore(b);
    if (aScore !== bScore) return aScore - bScore;
    return a.rootId - b.rootId;
  });

  return families;
}

function familySortScore(f: EvolutionFamily): number {
  if (f.completed) return 2; // done — sort last
  const anyMastered = f.edges.some((e) => e.forwardMastered || e.reverseMastered);
  if (anyMastered) return 0; // in progress — sort first
  return 1; // untouched — sort between in-progress and completed
}

/** Computes headline stats for the wall. */
export function computeEvolutionWallStats(
  families: readonly EvolutionFamily[],
): EvolutionWallStats {
  return {
    totalFamilies: families.length,
    completedFamilies: families.filter((f) => f.completed).length,
  };
}
