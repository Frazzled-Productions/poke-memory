import type { Grade } from "@/lib/srs/scheduler";
import type { GradeLog } from "@/lib/gradelog/persistence";
import { isoMinusDays } from "@/lib/stats/date";

const PASS_GRADES: ReadonlySet<Grade> = new Set([4, 5]);

/**
 * One entry per calendar day in the sparkline window. `accuracy` is `null`
 * on days with zero recorded reviews so consumers can render a visual gap
 * instead of treating "no data" as "0% accuracy".
 */
export type AccuracyPoint = {
  date: string;            // YYYY-MM-DD
  total: number;           // grades recorded on this date
  passes: number;          // grade === 4 or 5
  accuracy: number | null; // passes / total, or null when total === 0
};

const DAY_MS = 86_400_000;

/**
 * Build a per-day accuracy series ending on `today` and stretching back
 * `windowDays - 1` days. Pure - no I/O. Days with zero reviews keep
 * `accuracy: null` so a sparkline can render a gap.
 */
export function computeAccuracySparkline(
  log: GradeLog,
  today: string,
  windowDays = 30,
): AccuracyPoint[] {
  const dates: string[] = [];
  const tallies = new Map<string, { total: number; passes: number }>();
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = isoMinusDays(today, i);
    dates.push(d);
    tallies.set(d, { total: 0, passes: 0 });
  }

  for (const entry of log) {
    const t = tallies.get(entry.date);
    if (t === undefined) continue;
    t.total++;
    if (PASS_GRADES.has(entry.grade)) t.passes++;
  }

  return dates.map((date) => {
    const t = tallies.get(date)!;
    return {
      date,
      total: t.total,
      passes: t.passes,
      accuracy: t.total === 0 ? null : t.passes / t.total,
    };
  });
}

/**
 * Returns the rolling accuracy over the last `windowDays` ending on
 * `today` (inclusive). Computed as `passes / total` aggregated over the
 * whole window - not the mean of per-day accuracies, so a single-review
 * day doesn't get weighted the same as a 100-review day. Returns `null`
 * when the window contains zero reviews.
 */
export function computeRollingAccuracy(
  log: GradeLog,
  today: string,
  windowDays = 7,
): number | null {
  const start = isoMinusDays(today, windowDays - 1);
  let total = 0;
  let passes = 0;
  for (const entry of log) {
    if (entry.date < start || entry.date > today) continue;
    total++;
    if (PASS_GRADES.has(entry.grade)) passes++;
  }
  return total === 0 ? null : passes / total;
}

// Re-export DAY_MS to keep the module self-contained for callers that want
// to mirror the same date arithmetic. Not currently consumed externally.
export { DAY_MS };
