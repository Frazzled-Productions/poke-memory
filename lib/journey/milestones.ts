import type { GenerationStats } from "@/lib/stats/derive";

// ---------------------------------------------------------------------------
// Milestone kinds and thresholds
// ---------------------------------------------------------------------------

// NOTE: 1025 is included for completeness but is intentionally unreachable as a
// "mastery-count" milestone. `detectTopMilestone` checks the "all-mastered"
// branch (totalMastered >= 1025) first and returns early, so the count
// threshold for 1025 is never reached. The entry is kept so the list reads as
// a clean sequence of round numbers and documents 1025 as the total species
// count without requiring a separate constant.
export const MASTERY_COUNT_MILESTONES = [
  10, 25, 50, 100, 151, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000,
  1025,
] as const;

export type MilestoneKind = "mastery-count" | "gen-complete" | "all-mastered";

/**
 * Structured milestone data. User-facing strings are NOT built here - the
 * component layer renders them through the message catalogue
 * (`journey.milestoneShare.*` via next-intl), keyed by `kind`, so every
 * locale gets a properly translated banner and share text (#1933).
 *
 * `id` stays a stable identifier - used for deduplication, analytics, and
 * test assertions.
 */
export type Milestone =
  | {
      id: "all-mastered";
      kind: "all-mastered";
    }
  | {
      id: `gen-${number}-complete`;
      kind: "gen-complete";
      /** Generation number (1-9). */
      gen: number;
    }
  | {
      id: `mastery-${number}`;
      kind: "mastery-count";
      /**
       * The crossed round-number threshold (e.g. 100). This is NOT the live
       * mastered count - the banner must frame it as an achievement, never as
       * a current stat (#1933).
       */
      threshold: number;
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

/**
 * Roman numeral for a generation number, falling back to the decimal string
 * for out-of-range values. Exported so the rendering layer can pass it as an
 * ICU argument to locale messages that use the western "Generation IX" form.
 */
export function toRoman(n: number): string {
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
 * This function is pure - it has no side effects and performs no I/O.
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
    };
  }

  // 2. Most recently completed generation (highest gen number wins).
  const completedGens = [...perGeneration]
    .reverse()
    .filter((g) => g.total > 0 && g.mastered === g.total);
  if (completedGens.length > 0) {
    const top = completedGens[0]!;
    return {
      id: `gen-${top.gen}-complete`,
      kind: "gen-complete",
      gen: top.gen,
    };
  }

  // 3. Highest crossed round-number count threshold.
  const thresholdsCrossed = (
    MASTERY_COUNT_MILESTONES as readonly number[]
  ).filter((n) => totalMastered >= n);
  if (thresholdsCrossed.length > 0) {
    const threshold = thresholdsCrossed[thresholdsCrossed.length - 1]!;
    return {
      id: `mastery-${threshold}`,
      kind: "mastery-count",
      threshold,
    };
  }

  return null;
}
