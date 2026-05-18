import type { GenerationStats } from "@/lib/stats/derive";

// ---------------------------------------------------------------------------
// Milestone kinds and thresholds
// ---------------------------------------------------------------------------

export const MASTERY_COUNT_MILESTONES = [
  10, 25, 50, 100, 151, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000,
  1025,
] as const;

export type MilestoneKind = "mastery-count" | "gen-complete" | "all-mastered";

export type Milestone = {
  /** Stable identifier — used for deduplication, analytics, and test assertions. */
  id: string;
  kind: MilestoneKind;
  /** Human-readable label shown on the banner. */
  label: string;
  /** Pre-formatted share text. */
  shareText: string;
};

// ---------------------------------------------------------------------------
// Roman numeral helper (Gen I – Gen IX only)
// ---------------------------------------------------------------------------

const ROMAN: Record<number, string> = {
  1: "I",
  2: "II",
  3: "III",
  4: "IV",
  5: "V",
  6: "VI",
  7: "VII",
  8: "VIII",
  9: "IX",
};

function toRoman(n: number): string {
  return ROMAN[n] ?? String(n);
}

// ---------------------------------------------------------------------------
// detectTopMilestone
// ---------------------------------------------------------------------------

/**
 * Returns the single highest-priority milestone reached, or `null` if none
 * applies. Priority order (highest first):
 *
 *   1. All 1 025 species mastered.
 *   2. Most recently completed generation (highest gen number with mastered === total).
 *   3. Highest crossed round-number mastery count.
 *
 * This function is pure — it has no side effects and performs no I/O.
 */
export function detectTopMilestone(
  totalMastered: number,
  perGeneration: readonly GenerationStats[],
): Milestone | null {
  // 1. All-mastered takes top priority.
  if (totalMastered >= 1025) {
    return {
      id: "all-mastered",
      kind: "all-mastered",
      label: "You've mastered all Pokémon!",
      shareText:
        "I've mastered all 1 025 Pokémon in Poké Memory! 🎉 https://pokememory.com",
    };
  }

  // 2. Most recently completed generation (highest gen number wins).
  const completedGens = [...perGeneration]
    .reverse()
    .filter((g) => g.total > 0 && g.mastered === g.total);
  if (completedGens.length > 0) {
    const top = completedGens[0]!;
    const roman = toRoman(top.gen);
    return {
      id: `gen-${top.gen}-complete`,
      kind: "gen-complete",
      label: `Generation ${roman} complete!`,
      shareText: `I've mastered every Generation ${roman} Pokémon in Poké Memory! 🏆 https://pokememory.com`,
    };
  }

  // 3. Highest crossed round-number count threshold.
  const thresholdsCrossed = (
    MASTERY_COUNT_MILESTONES as readonly number[]
  ).filter((n) => totalMastered >= n);
  if (thresholdsCrossed.length > 0) {
    const count = thresholdsCrossed[thresholdsCrossed.length - 1]!;
    return {
      id: `mastery-${count}`,
      kind: "mastery-count",
      label: `${count} Pokémon mastered`,
      shareText: `I've mastered ${count} Pokémon in Poké Memory! 🌟 https://pokememory.com`,
    };
  }

  return null;
}
