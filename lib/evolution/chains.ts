/**
 * Derives evolution-family data for the Evolution Wall visualisation.
 *
 * Each "family" is a single evolution chain from the seed data. The wall
 * shows edge mastery - whether the user has mastered the evolution/reverse-
 * evolution cards that correspond to each link in the chain.
 *
 * Mastery rule (from docs/srs.md + lib/stats/derive.ts):
 *   reps >= masteryRepetitions && scheduledDays >= 21
 */

// Import pure numeric constants from seed-builder (no JSON dependency) so
// chains.ts does NOT force the seed JSON into the boot chunk (#1677).
import { REVERSE_EDGE_ID_BASE, EDGE_ID_BASE } from "@/lib/pokemon/seed-builder";
import type { SeedPokemon } from "@/lib/pokemon/seed";
import { getSeedIfLoaded } from "@/lib/pokemon/seed-async";
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
  // Seed data is loaded asynchronously at runtime; fall back to empty arrays
  // before it arrives so the function never throws on early calls (#1677).
  const seed = getSeedIfLoaded();
  const seedPokemon = seed?.seedPokemon ?? [];
  const seedEvolutionCards = seed?.seedEvolutionCards ?? [];

  // Build lookup maps for evolution card mastery by edge id.
  const forwardMasteredSet = new Set<number>();
  const reverseMasteredSet = new Set<number>();

  if (forceAllMastered) {
    // All edges mastered - populate from seedEvolutionCards edge ids.
    for (const card of seedEvolutionCards) {
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
          // Reverse card id - store as-is for lookup.
          reverseMasteredSet.add(rc.id);
        }
      }
    }
  }

  // Build a spriteUrl lookup by speciesId.
  const pokemonById = new Map<number, SeedPokemon>(
    seedPokemon.filter((p) => p.isDefaultForm).map((p) => [p.id, p]),
  );

  // Deduplicate chains: each chain appears in every member's evolutionChain array.
  // We key by the sorted set of speciesIds.
  const seenChainKeys = new Set<string>();
  const families: EvolutionFamily[] = [];

  for (const pokemon of seedPokemon) {
    if (!pokemon.isDefaultForm) continue;
    if (pokemon.evolutionChain.length <= 1) continue; // Solo - no edges to display.

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
  // then untouched (nothing mastered yet), then fully completed last - so "still
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
  if (f.completed) return 2; // done - sort last
  const anyMastered = f.edges.some((e) => e.forwardMastered || e.reverseMastered);
  if (anyMastered) return 0; // in progress - sort first
  return 1; // untouched - sort between in-progress and completed
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

/**
 * True when an evolution family is "in progress": at least one edge has a
 * mastered direction (forward or reverse) but not every edge is fully
 * mastered. This is the exact predicate the Evolution Wall's "In progress"
 * filter uses (`matchesFilter` in `components/journey/EvolutionWall.tsx`) - 
 * keeping it here lets the "Incomplete evolution chains" practice preset
 * (#995) reuse the same definition so the wall and the preset never drift.
 */
export function familyInProgress(family: EvolutionFamily): boolean {
  if (family.completed) return false;
  return family.edges.some((e) => e.forwardMastered || e.reverseMastered);
}

/**
 * Species ids that belong to an "incomplete evolution chain" - a chain the
 * user has started but not finished mastering. Drives the "Incomplete
 * evolution chains" practice-scope preset (#995).
 *
 * The set is computed from the same `deriveEvolutionFamilies` output the
 * Journey tab's Evolution Wall renders, filtered by `familyInProgress`, so
 * the preset's membership matches the wall's "In progress" tab exactly.
 *
 * Membership is dynamic: as the user masters more edges a family flips from
 * untouched → in progress → completed, so this must be recomputed from the
 * current card set rather than baked in as a static id list.
 *
 * @param cards               The user's full ReviewableCard array.
 * @param masteryRepetitions  The user's mastery-repetitions setting (default 3).
 * @param forceAllMastered    Honour the `pretendAllMastered` superuser flag.
 *   When true every edge is mastered, so every family is `completed` and none
 *   is in progress - the returned set is empty by design.
 */
export function incompleteChainSpeciesIds(
  cards: readonly ReviewableCard[],
  masteryRepetitions = 3,
  forceAllMastered = false,
): Set<number> {
  const families = deriveEvolutionFamilies(cards, masteryRepetitions, forceAllMastered);
  const ids = new Set<number>();
  for (const family of families) {
    if (!familyInProgress(family)) continue;
    for (const node of family.nodes) ids.add(node.speciesId);
  }
  return ids;
}
