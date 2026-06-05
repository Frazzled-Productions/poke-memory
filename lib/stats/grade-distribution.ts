import type { GradeLog } from "@/lib/gradelog/persistence";

/**
 * Counts of each grade button pressed across the full grade log.
 *
 * The grade convention follows AGENTS.md "Spaced repetition":
 *   Again (1) / Hard (2) / Good (4) / Easy (5).
 */
export type GradeDistribution = {
  again: number; // grade === 1
  hard: number;  // grade === 2
  good: number;  // grade === 4
  easy: number;  // grade === 5
  total: number; // sum of the above
};

/**
 * Compute the distribution of grade buttons pressed from the grade log.
 * Pure - no I/O.
 *
 * This derives from review *history* (`grade_log`), not mastery state, so it
 * is intentionally NOT affected by the `pretendAllMastered` superuser flag.
 *
 * Guest mode: an empty `log` returns all-zero counts - the UI renders an
 * empty state when `total === 0`.
 */
export function computeGradeDistribution(log: GradeLog): GradeDistribution {
  let again = 0;
  let hard = 0;
  let good = 0;
  let easy = 0;

  for (const entry of log) {
    switch (entry.grade) {
      case 1: again++; break;
      case 2: hard++;  break;
      case 4: good++;  break;
      case 5: easy++;  break;
    }
  }

  return { again, hard, good, easy, total: again + hard + good + easy };
}

/**
 * One data point for the weekly grade-volume trend chart.
 * `weekStart` is the ISO date (YYYY-MM-DD) of the Monday that opens the week.
 */
export type GradeTrendPoint = {
  weekStart: string;
  again: number;
  hard: number;
  good: number;
  easy: number;
  total: number;
};

/**
 * Return the ISO Monday date for the week containing `isoDate`.
 * Week starts on Monday (ISO 8601).
 */
function isoWeekStart(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // getUTCDay() returns 0=Sun, 1=Mon, ..., 6=Sat.
  const dayOfWeek = date.getUTCDay();
  // Shift so Monday=0, ..., Sunday=6.
  const offsetToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  date.setUTCDate(date.getUTCDate() - offsetToMonday);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Bucket the grade log into weekly grade-volume trend points, covering the
 * `weeks` most recent complete weeks relative to `today`.
 *
 * Weeks are ISO weeks starting on Monday. The window covers the `weeks`
 * complete past weeks (oldest = `currentWeekStart - weeks*7`; newest =
 * `currentWeekStart - 7`). The current in-progress week is excluded so every
 * returned bucket represents a full seven-day period.
 *
 * When `trimLeadingZeros` is true (the default), any all-zero weeks at the
 * start of the window are dropped so the chart is not padded with empty bars
 * before the user's first recorded activity. Trailing zero weeks are kept so
 * the x-axis extends to the most recent complete week.
 *
 * Pure - no I/O. Returns up to `weeks` entries in ascending `weekStart` order.
 */
export function computeGradeTrend(
  log: GradeLog,
  today: string,
  weeks = 12,
  trimLeadingZeros = true,
): GradeTrendPoint[] {
  // Determine the Monday of the current week.
  const currentWeekStart = isoWeekStart(today);

  // Pre-build the week-start strings for all requested weeks (oldest first).
  // i runs from `weeks` down to 1, so the oldest slot is `currentWeekStart -
  // weeks*7` days back, giving a full `weeks`-week window.
  const weekStarts: string[] = [];
  for (let i = weeks; i >= 1; i--) {
    // Each step back is 7 days.
    const [cy, cm, cd] = currentWeekStart.split("-").map(Number);
    const d = new Date(Date.UTC(cy, cm - 1, cd - i * 7));
    const yy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    weekStarts.push(`${yy}-${mm}-${dd}`);
  }

  // Build a Map for O(1) bucket lookup.
  type Bucket = { again: number; hard: number; good: number; easy: number };
  const buckets = new Map<string, Bucket>();
  for (const ws of weekStarts) {
    buckets.set(ws, { again: 0, hard: 0, good: 0, easy: 0 });
  }

  // Tally entries into their week bucket. Entries outside the window are
  // silently ignored.
  for (const entry of log) {
    const ws = isoWeekStart(entry.date);
    const bucket = buckets.get(ws);
    if (bucket === undefined) continue;
    switch (entry.grade) {
      case 1: bucket.again++; break;
      case 2: bucket.hard++;  break;
      case 4: bucket.good++;  break;
      case 5: bucket.easy++;  break;
    }
  }

  const points = weekStarts.map((ws) => {
    const b = buckets.get(ws)!;
    return {
      weekStart: ws,
      again: b.again,
      hard: b.hard,
      good: b.good,
      easy: b.easy,
      total: b.again + b.hard + b.good + b.easy,
    };
  });

  if (!trimLeadingZeros) return points;

  // Drop leading zero-total weeks so the chart starts at the user's first
  // week of activity rather than showing a long run of empty bars.
  const firstNonZero = points.findIndex((p) => p.total > 0);
  if (firstNonZero === -1) return []; // no data in the window at all
  return points.slice(firstNonZero);
}
