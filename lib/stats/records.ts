import type { ReviewableCard } from "@/lib/review/session";
import type { GradeLog } from "@/lib/gradelog/persistence";
import type { AppLocale } from "@/i18n/locales";
import { isoDate } from "@/lib/utils/format-date";
import { MASTERY_REPETITIONS } from "./derive";
import { masteredSpeciesEvents, nameCardsForLocale } from "./mastery-species-events";

export type Records = {
  /** Longest run of consecutive review dates ever recorded. */
  longestStreak: number;
  /** Highest number of reviews recorded on any single calendar day. */
  bestReviewDay: number;
  /**
   * Approximate average days from a species' name card's `firstSeen` to
   * species-level mastery date. Computed across currently species-mastered
   * pairs as `avg(masteredDate - nameCard.firstSeen)`, where `masteredDate`
   * is the later of the name and reverse cards' `lastReview` dates. This is
   * an upper bound — a species might have crossed the threshold earlier —
   * but without a persisted "first mastered at" we trade exactness for no
   * schema migration. Null when no species is mastered yet.
   */
  avgDaysToMastery: number | null;
  /**
   * Highest count of species mastery events landing in any rolling 7-day
   * window. Looks at the species-level `masteredDate` (later of name +
   * reverse `lastReview`) on currently-mastered species and finds the
   * densest week. Null when no mastered species exist.
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
 * Pure: build `Records` from the FULL card array (all card types) plus the
 * grade log plus the streak-date list. All four metrics gracefully
 * degrade to zero / null when input is empty.
 *
 * Since #1448, `avgDaysToMastery` and `mostMasteredIn7d` are derived from
 * species-level mastery (both name + reverse legs required, #1234). The full
 * card array is required so the reverse leg can be found.
 *
 * `masteryRepetitions` defaults to MASTERY_REPETITIONS for callers that pass
 * the full card array without an explicit threshold. Callers from `app/` should
 * always pass the value from user settings.
 */
export function computeRecords(
  cards: readonly ReviewableCard[],
  log: GradeLog,
  streakDates: readonly string[],
  masteryRepetitions: number = MASTERY_REPETITIONS,
  forceAllMastered = false,
  locale: AppLocale = "en",
): Records {
  // Superuser pretendAllMastered: project the mastery-derived metrics onto
  // "you've mastered everything". longestStreak / bestReviewDay derive from
  // grade-log/streak data and stay honest — pretend-mastered doesn't change
  // your actual review history.
  const nameCards = nameCardsForLocale(cards, locale);
  if (forceAllMastered && nameCards.length > 0) {
    return {
      longestStreak: computeLongestStreak(streakDates),
      bestReviewDay: computeBestReviewDay(log),
      avgDaysToMastery: 0,
      mostMasteredIn7d: nameCards.length,
    };
  }

  // Build a firstSeen lookup from name cards (keyed by speciesId).
  const nameCardFirstSeen = new Map<number, string | null>();
  for (const card of nameCards) {
    nameCardFirstSeen.set(card.id, card.state.firstSeen);
  }

  // Derive species-level mastery events (both legs required, #1448).
  const events = masteredSpeciesEvents(cards, masteryRepetitions, false, locale);

  let avgDaysToMastery: number | null = null;
  if (events.length > 0) {
    let sum = 0;
    let counted = 0;
    for (const ev of events) {
      const firstSeen = nameCardFirstSeen.get(ev.speciesId);
      if (firstSeen === null || firstSeen === undefined) continue;
      sum += daysBetween(firstSeen, ev.masteredDate);
      counted++;
    }
    if (counted > 0) {
      avgDaysToMastery = sum / counted;
    }
  }

  let mostMasteredIn7d: number | null = null;
  if (events.length > 0) {
    const dates = events.map((e) => e.masteredDate).sort();
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
