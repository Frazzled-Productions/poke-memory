/**
 * Unit tests for lib/evolution/chains.ts
 *
 * Tests use the real SEED_EVOLUTION_CARDS data to stay honest about the
 * actual edge ID allocations, but construct synthetic ReviewableCard arrays
 * to control mastery state without needing a live review session.
 */

import { describe, it, expect } from "vitest";
import {
  deriveEvolutionFamilies,
  computeEvolutionWallStats,
  type EvolutionFamily,
} from "./chains";
import { SEED_EVOLUTION_CARDS, REVERSE_EDGE_ID_BASE, EDGE_ID_BASE } from "@/lib/pokemon/seed";
import type { ReviewableCard, EvolutionReviewCard, ReverseEvolutionReviewCard } from "@/lib/review/session";
import { initialReviewState } from "@/lib/srs/scheduler";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const MASTERED_STATE = {
  ...initialReviewState(),
  reps: 3,
  scheduledDays: 21,
};

const LEARNING_STATE = {
  ...initialReviewState(),
  reps: 1,
  scheduledDays: 5,
  lastReview: "2024-01-01",
};

/** Build a mastered forward evolution card for the given edge id. */
function masteredForward(edgeId: number): EvolutionReviewCard {
  const seed = SEED_EVOLUTION_CARDS.find((c) => c.id === edgeId);
  if (!seed) throw new Error(`No seed card for edgeId ${edgeId}`);
  return { ...seed, subjectKey: `${seed.preEvoId}:${seed.postEvoId}`, state: MASTERED_STATE };
}

/** Build a mastered reverse evolution card for the given forward edge id. */
function masteredReverse(forwardEdgeId: number): ReverseEvolutionReviewCard {
  const seed = SEED_EVOLUTION_CARDS.find((c) => c.id === forwardEdgeId);
  if (!seed) throw new Error(`No seed card for edgeId ${forwardEdgeId}`);
  const revId = REVERSE_EDGE_ID_BASE + (forwardEdgeId - EDGE_ID_BASE);
  return {
    ...seed,
    cardType: "reverse-evolution" as const,
    id: revId,
    subjectKey: `${seed.preEvoId}:${seed.postEvoId}`,
    state: MASTERED_STATE,
  };
}

/** Build an un-mastered forward evolution card for the given edge id. */
function learningForward(edgeId: number): EvolutionReviewCard {
  const seed = SEED_EVOLUTION_CARDS.find((c) => c.id === edgeId);
  if (!seed) throw new Error(`No seed card for edgeId ${edgeId}`);
  return { ...seed, subjectKey: `${seed.preEvoId}:${seed.postEvoId}`, state: LEARNING_STATE };
}

// ---------------------------------------------------------------------------
// Retrieve real edge ids for known chains
// ---------------------------------------------------------------------------

// Bulbasaur → Ivysaur edge (edgeId 1500001)
const BULBASAUR_TO_IVYSAUR = 1500001;
// Ivysaur → Venusaur edge (edgeId 1500002)
const IVYSAUR_TO_VENUSAUR = 1500002;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deriveEvolutionFamilies", () => {
  it("returns only families with at least one edge (excludes solo species)", () => {
    const families = deriveEvolutionFamilies([], 3, false);
    expect(families.every((f) => f.edges.length > 0)).toBe(true);
  });

  it("does not return duplicate chains", () => {
    const families = deriveEvolutionFamilies([], 3, false);
    // Check rootIds are all unique (each chain appears once).
    const rootIds = families.map((f) => f.rootId);
    const uniqueRootIds = new Set(rootIds);
    expect(uniqueRootIds.size).toBe(rootIds.length);
  });

  it("returns all families as non-completed when no cards are mastered", () => {
    const families = deriveEvolutionFamilies([], 3, false);
    expect(families.every((f) => !f.completed)).toBe(true);
  });

  it("marks an edge as forwardMastered when the forward card is mastered", () => {
    const cards: ReviewableCard[] = [masteredForward(BULBASAUR_TO_IVYSAUR)];
    const families = deriveEvolutionFamilies(cards, 3, false);
    // Find the Bulbasaur family.
    const bulbasaurFamily = families.find((f) => f.rootId === 1);
    expect(bulbasaurFamily).toBeDefined();
    const edge = bulbasaurFamily!.edges.find(
      (e) => e.forwardEdgeId === BULBASAUR_TO_IVYSAUR,
    );
    expect(edge).toBeDefined();
    expect(edge!.forwardMastered).toBe(true);
    expect(edge!.reverseMastered).toBe(false);
    expect(edge!.fullyMastered).toBe(false);
  });

  it("marks an edge as reverseMastered when the reverse card is mastered", () => {
    const cards: ReviewableCard[] = [masteredReverse(BULBASAUR_TO_IVYSAUR)];
    const families = deriveEvolutionFamilies(cards, 3, false);
    const bulbasaurFamily = families.find((f) => f.rootId === 1);
    expect(bulbasaurFamily).toBeDefined();
    const edge = bulbasaurFamily!.edges.find(
      (e) => e.forwardEdgeId === BULBASAUR_TO_IVYSAUR,
    );
    expect(edge).toBeDefined();
    expect(edge!.forwardMastered).toBe(false);
    expect(edge!.reverseMastered).toBe(true);
    expect(edge!.fullyMastered).toBe(false);
  });

  it("marks an edge as fullyMastered when both forward and reverse are mastered", () => {
    const cards: ReviewableCard[] = [
      masteredForward(BULBASAUR_TO_IVYSAUR),
      masteredReverse(BULBASAUR_TO_IVYSAUR),
    ];
    const families = deriveEvolutionFamilies(cards, 3, false);
    const bulbasaurFamily = families.find((f) => f.rootId === 1);
    const edge = bulbasaurFamily!.edges.find(
      (e) => e.forwardEdgeId === BULBASAUR_TO_IVYSAUR,
    );
    expect(edge!.fullyMastered).toBe(true);
  });

  it("marks a family as completed when every edge is fullyMastered", () => {
    // Bulbasaur chain: two edges (Bulbasaur→Ivysaur, Ivysaur→Venusaur).
    const cards: ReviewableCard[] = [
      masteredForward(BULBASAUR_TO_IVYSAUR),
      masteredReverse(BULBASAUR_TO_IVYSAUR),
      masteredForward(IVYSAUR_TO_VENUSAUR),
      masteredReverse(IVYSAUR_TO_VENUSAUR),
    ];
    const families = deriveEvolutionFamilies(cards, 3, false);
    const bulbasaurFamily = families.find((f) => f.rootId === 1);
    expect(bulbasaurFamily!.completed).toBe(true);
  });

  it("does NOT mark a family as completed when only one edge is fullyMastered", () => {
    // Only the first edge mastered in a 2-edge chain.
    const cards: ReviewableCard[] = [
      masteredForward(BULBASAUR_TO_IVYSAUR),
      masteredReverse(BULBASAUR_TO_IVYSAUR),
    ];
    const families = deriveEvolutionFamilies(cards, 3, false);
    const bulbasaurFamily = families.find((f) => f.rootId === 1);
    expect(bulbasaurFamily!.completed).toBe(false);
  });

  it("a learning (not mastered) card does not count toward mastery", () => {
    const cards: ReviewableCard[] = [learningForward(BULBASAUR_TO_IVYSAUR)];
    const families = deriveEvolutionFamilies(cards, 3, false);
    const bulbasaurFamily = families.find((f) => f.rootId === 1);
    const edge = bulbasaurFamily!.edges.find(
      (e) => e.forwardEdgeId === BULBASAUR_TO_IVYSAUR,
    );
    expect(edge!.forwardMastered).toBe(false);
  });

  it("forceAllMastered marks every edge in every family as fullyMastered", () => {
    const families = deriveEvolutionFamilies([], 3, true);
    expect(families.length).toBeGreaterThan(0);
    for (const family of families) {
      expect(family.completed).toBe(true);
      for (const edge of family.edges) {
        expect(edge.forwardMastered).toBe(true);
        expect(edge.reverseMastered).toBe(true);
        expect(edge.fullyMastered).toBe(true);
      }
    }
  });

  it("respects a custom masteryRepetitions threshold", () => {
    // A card with reps=3, scheduledDays=21 is mastered at threshold=3 but NOT at threshold=5.
    const cards: ReviewableCard[] = [masteredForward(BULBASAUR_TO_IVYSAUR)];
    const familiesThresh3 = deriveEvolutionFamilies(cards, 3, false);
    const familiesThresh5 = deriveEvolutionFamilies(cards, 5, false);

    const edge3 = familiesThresh3
      .find((f) => f.rootId === 1)!
      .edges.find((e) => e.forwardEdgeId === BULBASAUR_TO_IVYSAUR)!;
    const edge5 = familiesThresh5
      .find((f) => f.rootId === 1)!
      .edges.find((e) => e.forwardEdgeId === BULBASAUR_TO_IVYSAUR)!;

    expect(edge3.forwardMastered).toBe(true);
    expect(edge5.forwardMastered).toBe(false);
  });

  it("Eevee family has 8 edges (all 8 eeveelutions)", () => {
    const families = deriveEvolutionFamilies([], 3, false);
    const eeveeFamily = families.find((f) => f.rootId === 133);
    expect(eeveeFamily).toBeDefined();
    expect(eeveeFamily!.edges.length).toBe(8);
  });

  it("Bulbasaur family has 2 edges", () => {
    const families = deriveEvolutionFamilies([], 3, false);
    const bulbasaurFamily = families.find((f) => f.rootId === 1);
    expect(bulbasaurFamily).toBeDefined();
    expect(bulbasaurFamily!.edges.length).toBe(2);
  });

  it("in-progress families sort before untouched families", () => {
    // Master one edge from Bulbasaur chain to make it "in progress".
    const cards: ReviewableCard[] = [masteredForward(BULBASAUR_TO_IVYSAUR)];
    const families = deriveEvolutionFamilies(cards, 3, false);
    const bulbasaurIdx = families.findIndex((f) => f.rootId === 1);
    // Bulbasaur family is in progress — find an untouched family after it.
    // Any untouched family should sort after it.
    const untouchedFamilies = families.filter(
      (f) =>
        !f.completed &&
        f.edges.every((e) => !e.forwardMastered && !e.reverseMastered),
    );
    if (untouchedFamilies.length > 0) {
      for (const untouched of untouchedFamilies) {
        const untouchedIdx = families.indexOf(untouched);
        expect(untouchedIdx).toBeGreaterThan(bulbasaurIdx);
      }
    }
  });
});

describe("computeEvolutionWallStats", () => {
  it("returns zero completedFamilies when no families are completed", () => {
    const families = deriveEvolutionFamilies([], 3, false);
    const stats = computeEvolutionWallStats(families);
    expect(stats.totalFamilies).toBeGreaterThan(0);
    expect(stats.completedFamilies).toBe(0);
  });

  it("returns all families as completed under forceAllMastered", () => {
    const families = deriveEvolutionFamilies([], 3, true);
    const stats = computeEvolutionWallStats(families);
    expect(stats.completedFamilies).toBe(stats.totalFamilies);
  });

  it("counts only fully completed families", () => {
    // Make Bulbasaur chain fully complete, leave everything else untouched.
    const cards: ReviewableCard[] = [
      masteredForward(BULBASAUR_TO_IVYSAUR),
      masteredReverse(BULBASAUR_TO_IVYSAUR),
      masteredForward(IVYSAUR_TO_VENUSAUR),
      masteredReverse(IVYSAUR_TO_VENUSAUR),
    ];
    const families = deriveEvolutionFamilies(cards, 3, false);
    const stats = computeEvolutionWallStats(families);
    expect(stats.completedFamilies).toBe(1);
    expect(stats.totalFamilies).toBeGreaterThan(1);
  });
});
