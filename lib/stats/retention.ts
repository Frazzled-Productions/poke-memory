import type { GradeLog } from "@/lib/gradelog/persistence";
import { computeRollingAccuracy } from "@/lib/stats/accuracy";
import { isoMinusDays } from "@/lib/stats/date";

/**
 * The grade log is pruned to 365 days (`pruneGradeLog`), so the widest
 * honest accuracy window is one year. The retention indicator frames its
 * figure as a rolling window over this period, never "all-time".
 */
export const RETENTION_WINDOW_DAYS = 365;

/**
 * Comparison between the user's measured recall accuracy and their
 * configured FSRS retention target.
 *
 * `actual` is `null` when the window contains zero reviews (guest / fresh
 * user); the UI renders an empty state in that case.
 *
 * This derives from review *history* (`grade_log`), not mastery state, so it
 * is intentionally NOT affected by the `pretendAllMastered` superuser flag.
 */
export type RetentionComparison = {
  /** Measured recall accuracy over the window (0..1), or null when empty. */
  actual: number | null;
  /** Configured FSRS retention target (0..1), typically 0.9. */
  target: number;
  /**
   * `actual - target`, or null when `actual` is null. Positive means recall
   * is running above target; negative means below.
   */
  delta: number | null;
  /** Number of reviews counted in the window. */
  reviews: number;
  /** Window width in days (currently the 365-day grade-log cap). */
  windowDays: number;
};

/**
 * Compare measured recall against the configured retention target over the
 * grade log's full retained window (365 days). Pure - no I/O.
 *
 * `computeRollingAccuracy` already returns `null` for an empty window, which
 * is propagated straight through as the empty state.
 */
export function computeRetentionComparison(
  log: GradeLog,
  today: string,
  retentionTarget: number,
  windowDays: number = RETENTION_WINDOW_DAYS,
): RetentionComparison {
  const actual = computeRollingAccuracy(log, today, windowDays);

  // Count the reviews inside the window so the UI can frame the figure
  // honestly ("based on N reviews") and gate its empty state.
  const start = isoMinusDays(today, windowDays - 1);
  let reviews = 0;
  for (const entry of log) {
    if (entry.date < start || entry.date > today) continue;
    reviews++;
  }

  return {
    actual,
    target: retentionTarget,
    delta: actual === null ? null : actual - retentionTarget,
    reviews,
    windowDays,
  };
}

