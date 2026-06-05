import type { GradeLog } from "@/lib/gradelog/persistence";
import { isoMinusDays } from "@/lib/stats/date";

/**
 * One data point in the daily activity history series.
 *
 * `date` is a YYYY-MM-DD string.
 * `reviews` is the total number of grade events recorded on that day.
 * `introduced` is the number of cards graded for the very first time on that
 * day. Only entries with a `subjectKey` are counted - legacy entries without
 * one are excluded from the introduction count so the number is never inflated
 * by unreliable data.
 */
export type ActivityPoint = {
  date: string;
  reviews: number;
  introduced: number;
};

/**
 * Compute daily review counts and new-cards-introduced counts over the
 * rolling `windowDays` ending on `today` (inclusive).
 *
 * Pure - no I/O.
 *
 * **Reviews per day**: total grade-log entries whose `date` falls within the
 * window. All card types are included - this is an activity-volume metric.
 *
 * **Cards introduced per day**: for every entry that has a `subjectKey`, we
 * record the first date that key appears in the log (scanning the full log, not
 * just the window, so a card introduced before the window still suppresses a
 * re-introduction count inside the window). Legacy entries without a
 * `subjectKey` are excluded from the introduction count.
 *
 * **Superuser flag**: this helper derives from review history, not mastery
 * state, so it is intentionally NOT affected by the `pretendAllMastered`
 * superuser flag. The caller must not pass a mutated or synthetic log.
 *
 * **Guest mode**: an empty `log` returns all-zero rows - the UI renders an
 * empty state when every `reviews` value is 0.
 *
 * **Guest-mode pruning caveat**: `appendGradeEntry` prunes the local grade log
 * to the most recent 365 days (`keepDays = 365`). For authenticated users the
 * cloud log is unbounded, but for guests any entry older than 365 days has
 * been dropped. As a result, a card first introduced more than a year ago
 * whose earliest log entry has been pruned will appear to be "introduced"
 * inside the window the next time it is reviewed. The introduction count is
 * therefore a best-effort figure for guests: it accurately reflects all cards
 * first seen within the visible window, but may over-count for very long-
 * standing guests whose log history predates the retention window.
 *
 * @param log         The full grade log from `loadGradeLog()`.
 * @param today       YYYY-MM-DD string for the current date (UTC).
 * @param windowDays  Number of days to cover (default 365). Rows are returned
 *                    oldest-first so Recharts can render left-to-right.
 */
export function computeActivityHistory(
  log: GradeLog,
  today: string,
  windowDays = 365,
): ActivityPoint[] {
  const windowStart = isoMinusDays(today, windowDays - 1);

  // Build date sequence oldest-first.
  const dates: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    dates.push(isoMinusDays(today, i));
  }

  const reviewsPerDay = new Map<string, number>();
  const introducedPerDay = new Map<string, number>();
  for (const d of dates) {
    reviewsPerDay.set(d, 0);
    introducedPerDay.set(d, 0);
  }

  // First pass over the full log: find the earliest date each subjectKey was
  // graded. Scanning the entire log (not just the window) means a card first
  // seen before the window does not appear as "introduced" inside it.
  const firstSeenDate = new Map<string, string>();
  for (const entry of log) {
    if (typeof entry.subjectKey !== "string") continue;
    const current = firstSeenDate.get(entry.subjectKey);
    if (current === undefined || entry.date < current) {
      firstSeenDate.set(entry.subjectKey, entry.date);
    }
  }

  // Second pass: tally reviews and introductions.
  // To avoid double-counting introductions when multiple log entries share the
  // same subjectKey and same first-seen date, we track which keys have already
  // been credited within this pass.
  const creditedIntroductions = new Set<string>();

  for (const entry of log) {
    // Reviews: all entries within the window.
    if (entry.date >= windowStart && entry.date <= today) {
      reviewsPerDay.set(entry.date, (reviewsPerDay.get(entry.date) ?? 0) + 1);
    }

    // Introductions: only the first-seen date for this key, within the window,
    // credited exactly once.
    if (typeof entry.subjectKey === "string") {
      const first = firstSeenDate.get(entry.subjectKey);
      if (
        first !== undefined &&
        first === entry.date &&
        first >= windowStart &&
        first <= today &&
        !creditedIntroductions.has(entry.subjectKey)
      ) {
        creditedIntroductions.add(entry.subjectKey);
        introducedPerDay.set(
          entry.date,
          (introducedPerDay.get(entry.date) ?? 0) + 1,
        );
      }
    }
  }

  return dates.map((date) => ({
    date,
    reviews: reviewsPerDay.get(date) ?? 0,
    introduced: introducedPerDay.get(date) ?? 0,
  }));
}

/**
 * Returns true when every point in the series has zero reviews and zero
 * introductions. Convenience guard for empty-state rendering.
 */
export function isActivityHistoryEmpty(
  series: readonly ActivityPoint[],
): boolean {
  return series.every((p) => p.reviews === 0 && p.introduced === 0);
}
