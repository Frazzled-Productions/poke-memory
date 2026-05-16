import type { NameReviewCard } from "@/lib/review/session";
import type { GradeLog } from "@/lib/gradelog/persistence";
import { isMastered } from "./derive";
import { isoDate } from "@/lib/utils/format-date";

export type Records = {
  /** Longest run of consecutive review dates ever recorded. */
  longestStreak: number;
  /** Highest number of reviews recorded on any single calendar day. */
  bestReviewDay: number;
  /**
   * Approximate average days from a card's `firstSeen` to current mastery.
   * Computed across currently-mastered cards as
   * `avg(lastReview - firstSeen)`. This is an upper bound — a card might
   * have crossed the mastery threshold earlier than `lastReview` — but
   * without persisted "first mastered at" we trade exactness for not
   * needing a schema migration. Null when no card is mastered yet.
   */
  avgDaysToMastery: number | null;
  /**
   * Highest count of mastered-card review events landing in any rolling
   * 7-day window. Looks at `lastReview` on currently-mastered cards and
   * finds the densest week. Null when no mastered card exists.
   */
  mostMasteredIn7d: number | null;
};

function daysBetween(fromIso: string, toIso: string): number {
  // YYYY-MM-DD strings are lexicographic and parseable; using UTC math here
  // matches `lib/streak/compute.ts` and avoids local-TZ drift for a metric
  // that aggregates across the user's full history.
  const from = new Date(fromIso + "T00:00:00Z").getTime();
  const to = new Date(toIso + "T00:00:00Z").getTime();
  return Math.round((to - from) / 86_400_000);
}

/** Longest consecutive-date run in the (possibly unsorted) `dates` set. */
export function computeLongestStreak(dates: readonly string[]): number {
  if (dates.length === 0) return 0;
  const set = new Set(dates);
  let longest = 0;
  for (const d of set) {
    // Only walk from "start of a run" days — i.e. ones whose predecessor
    // is missing — so each run is counted once in O(n) total.
    const prev = new Date(d + "T00:00:00Z");
    prev.setUTCDate(prev.getUTCDate() - 1);
    const prevIso = isoDate(prev);
    if (set.has(prevIso)) continue;

    let cursor = d;
    let count = 0;
    while (set.has(cursor)) {
      count++;
      const next = new Date(cursor + "T00:00:00Z");
      next.setUTCDate(next.getUTCDate() + 1);
      cursor = isoDate(next);
    }
    if (count > longest) longest = count;
  }
  return longest;
}

/** Highest number of `GradeLog` entries with the same `date`. */
export function computeBestReviewDay(log: GradeLog): number {
  if (log.length === 0) return 0;
  const perDay = new Map<string, number>();
  for (const entry of log) {
    perDay.set(entry.date, (perDay.get(entry.date) ?? 0) + 1);
  }
  let best = 0;
  for (const v of perDay.values()) if (v > best) best = v;
  return best;
}

/**
 * Pure: build `Records` from the name-card review state plus the
 * grade log plus the streak-date list. All four metrics gracefully
 * degrade to zero / null when input is empty.
 */
export function computeRecords(
  cards: readonly NameReviewCard[],
  log: GradeLog,
  streakDates: readonly string[],
  masteryRepetitions: number,
  forceAllMastered = false,
): Records {
  // Superuser pretendAllMastered: project the mastery-derived metrics onto
  // "you've mastered everything". longestStreak / bestReviewDay derive from
  // grade-log/streak data and stay honest — pretend-mastered doesn't change
  // your actual review history.
  if (forceAllMastered && cards.length > 0) {
    return {
      longestStreak: computeLongestStreak(streakDates),
      bestReviewDay: computeBestReviewDay(log),
      avgDaysToMastery: 0,
      mostMasteredIn7d: cards.length,
    };
  }

  const masteredCards = cards.filter(
    (c) =>
      isMastered(c.state, masteryRepetitions) &&
      c.state.firstSeen !== null &&
      c.state.lastReview !== null,
  );

  let avgDaysToMastery: number | null = null;
  if (masteredCards.length > 0) {
    let sum = 0;
    for (const c of masteredCards) {
      // firstSeen/lastReview both non-null per filter above; the `!`
      // assertions narrow TS without an extra runtime check.
      sum += daysBetween(c.state.firstSeen!, c.state.lastReview!);
    }
    avgDaysToMastery = sum / masteredCards.length;
  }

  let mostMasteredIn7d: number | null = null;
  if (masteredCards.length > 0) {
    const dates = masteredCards
      .map((c) => c.state.lastReview!)
      .sort();
    // Two-pointer over the sorted date array: count how many dates fall in
    // any 7-day window anchored on each date.
    let best = 0;
    let left = 0;
    for (let right = 0; right < dates.length; right++) {
      while (left < right && daysBetween(dates[left], dates[right]) >= 7) {
        left++;
      }
      const span = right - left + 1;
      if (span > best) best = span;
    }
    mostMasteredIn7d = best;
  }

  return {
    longestStreak: computeLongestStreak(streakDates),
    bestReviewDay: computeBestReviewDay(log),
    avgDaysToMastery,
    mostMasteredIn7d,
  };
}
