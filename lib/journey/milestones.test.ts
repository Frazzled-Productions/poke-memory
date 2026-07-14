import { describe, it, expect } from "vitest";
import {
  detectTopMilestone,
  toRoman,
  MASTERY_COUNT_MILESTONES,
} from "./milestones";
import type { GenerationStats } from "@/lib/stats/derive";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGen(
  gen: number,
  total: number,
  mastered: number,
): GenerationStats {
  return {
    gen,
    name: `Generation ${gen}`,
    total,
    introduced: mastered,
    mastered,
  };
}

const EMPTY_GENS: GenerationStats[] = [];
const THREE_GENS = [
  makeGen(1, 151, 0),
  makeGen(2, 100, 0),
  makeGen(3, 135, 0),
];

// ---------------------------------------------------------------------------
// Null / below-threshold cases
// ---------------------------------------------------------------------------

describe("detectTopMilestone - no milestone", () => {
  it("returns null for 0 mastered", () => {
    expect(detectTopMilestone(0, EMPTY_GENS)).toBeNull();
  });

  it("returns null below the lowest threshold (9 mastered)", () => {
    expect(detectTopMilestone(9, EMPTY_GENS)).toBeNull();
  });

  it("returns null with no generations data and 0 mastered", () => {
    expect(detectTopMilestone(0, THREE_GENS)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Count milestones
// ---------------------------------------------------------------------------

describe("detectTopMilestone - mastery-count kind", () => {
  it("returns the lowest threshold when exactly at 10", () => {
    const result = detectTopMilestone(10, EMPTY_GENS);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("mastery-10");
    expect(result!.kind).toBe("mastery-count");
  });

  it("returns the highest crossed threshold (not the lowest)", () => {
    const result = detectTopMilestone(151, EMPTY_GENS);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("mastery-151");
  });

  it("still returns a count milestone at 999 (below 1000 threshold)", () => {
    const result = detectTopMilestone(999, EMPTY_GENS);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("mastery-900");
  });

  it("returns mastery-1000 at exactly 1000", () => {
    const result = detectTopMilestone(1000, EMPTY_GENS);
    expect(result!.id).toBe("mastery-1000");
  });

  it("carries the crossed threshold as structured data", () => {
    const result = detectTopMilestone(100, EMPTY_GENS);
    expect(result!.kind).toBe("mastery-count");
    if (result!.kind === "mastery-count") {
      expect(result!.threshold).toBe(100);
    }
  });

  it("returns the crossed threshold, not the live count, when above a threshold (#1933)", () => {
    // 137 mastered: the crossed milestone is 100. The structured shape carries
    // the threshold only - no pre-rendered label that could read as a live
    // count. Rendering happens in the component through the catalogue with
    // explicit achievement framing.
    const result = detectTopMilestone(137, EMPTY_GENS);
    expect(result!.id).toBe("mastery-100");
    if (result!.kind === "mastery-count") {
      expect(result!.threshold).toBe(100);
    }
    expect(result).not.toHaveProperty("label");
    expect(result).not.toHaveProperty("shareText");
  });

  it("every threshold in MASTERY_COUNT_MILESTONES maps to its own id (below 1025)", () => {
    for (const n of MASTERY_COUNT_MILESTONES.filter((x) => x < 1025)) {
      const result = detectTopMilestone(n, EMPTY_GENS);
      expect(result!.id).toBe(`mastery-${n}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Generation-complete milestones
// ---------------------------------------------------------------------------

describe("detectTopMilestone - gen-complete kind", () => {
  it("returns gen-complete when a generation is fully mastered", () => {
    const gens = [makeGen(1, 151, 151), makeGen(2, 100, 0)];
    const result = detectTopMilestone(200, gens);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("gen-complete");
    expect(result!.id).toBe("gen-1-complete");
  });

  it("prefers gen-complete over a count milestone", () => {
    const gens = [makeGen(1, 151, 151), makeGen(2, 100, 0)];
    // 151 mastered would trigger mastery-151, but gen 1 is complete.
    const result = detectTopMilestone(151, gens);
    expect(result!.kind).toBe("gen-complete");
  });

  it("picks the highest generation number when multiple gens are complete", () => {
    const gens = [makeGen(1, 151, 151), makeGen(2, 100, 100), makeGen(3, 135, 0)];
    const result = detectTopMilestone(500, gens);
    expect(result!.id).toBe("gen-2-complete");
  });

  it("carries the generation number as structured data", () => {
    const gens = [makeGen(4, 107, 107)];
    const result = detectTopMilestone(500, gens);
    expect(result!.kind).toBe("gen-complete");
    if (result!.kind === "gen-complete") {
      expect(result!.gen).toBe(4);
    }
  });

  it("does not trigger on a partially mastered generation", () => {
    const gens = [makeGen(1, 151, 100)];
    const result = detectTopMilestone(100, gens);
    // Should fall through to count milestone, not gen-complete.
    expect(result!.kind).toBe("mastery-count");
  });

  it("does not trigger on a generation with total === 0", () => {
    const gens = [makeGen(1, 0, 0)];
    const result = detectTopMilestone(100, gens);
    expect(result!.kind).toBe("mastery-count");
  });
});

// ---------------------------------------------------------------------------
// All-mastered
// ---------------------------------------------------------------------------

describe("detectTopMilestone - all-mastered kind", () => {
  it("returns all-mastered at exactly 1025", () => {
    const result = detectTopMilestone(1025, EMPTY_GENS);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("all-mastered");
    expect(result!.kind).toBe("all-mastered");
  });

  it("returns all-mastered even when all gens are complete (takes top priority)", () => {
    const gens = [makeGen(1, 151, 151), makeGen(2, 100, 100)];
    const result = detectTopMilestone(1025, gens);
    expect(result!.id).toBe("all-mastered");
  });

  it("returns all-mastered above 1025", () => {
    const result = detectTopMilestone(1030, EMPTY_GENS);
    expect(result!.id).toBe("all-mastered");
  });
});

// ---------------------------------------------------------------------------
// toRoman
// ---------------------------------------------------------------------------

describe("toRoman", () => {
  it("maps generations 1-9 to roman numerals", () => {
    expect(toRoman(1)).toBe("I");
    expect(toRoman(4)).toBe("IV");
    expect(toRoman(9)).toBe("IX");
  });

  it("falls back to the decimal string outside 1-9", () => {
    expect(toRoman(10)).toBe("10");
    expect(toRoman(0)).toBe("0");
  });
});
