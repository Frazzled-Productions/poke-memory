import type { NameReviewCard } from "@/lib/review/session";
import { isMastered, MASTERY_REPETITIONS } from "./derive";

/**
 * One data point in the mastery-over-time series.
 *
 * `date` is a YYYY-MM-DD string.
 * `count` is the cumulative number of species mastered on or before that date.
 */
export type MasteryPoint = {
  date: string;
  count: number;
};

/**
 * Derive a cumulative mastery-over-time series from the name-card review
 * state. Pure — no I/O.
 *
 * **Data source**: for each currently-mastered name-card we use `lastReview`
 * as the proxy for the mastery-crossing date. This is the same approximation
 * used by `computeRecords` (`lib/stats/records.ts`): the card *may* have
 * crossed the threshold on an earlier review, but without a persisted
 * "first mastered at" date we trade exactness for no schema migration.
 * Guest-mode localStorage data supports this fully (card states include
 * `lastReview`).
 *
 * **`forceAllMastered`** (superuser `pretendAllMastered` flag): when `true`
 * the series is a single point at `today` with `count === cards.length`,
 * consistent with `computeStats`'s treatment of the flag. Pass the flag
 * through from the caller — do not read it from context here.
 *
 * **Empty state**: an empty array is returned when no card has a lastReview
 * date (i.e. the user has never graded anything). The UI renders an empty
 * state for `series.length === 0`.
 *
 * @param cards    Array of name-card review states (use `cards.filter(c => c.cardType === "name")`).
 * @param today    YYYY-MM-DD string for the current date.
 * @param masteryRepetitions  Mastery reps threshold (default `MASTERY_REPETITIONS`).
 * @param forceAllMastered    Superuser flag — when `true` collapse to a single point.
 */
export function computeMasteryOverTime(
  cards: readonly NameReviewCard[],
  today: string,
  masteryRepetitions = MASTERY_REPETITIONS,
  forceAllMastered = false,
): MasteryPoint[] {
  if (forceAllMastered) {
    // Superuser overlay: treat every species as mastered at today's date.
    // A single point is enough — the area chart renders a flat line from the
    // earliest date to today, which is not meaningful, so we return just the
    // endpoint. The chart component handles the single-point case gracefully.
    return [{ date: today, count: cards.length }];
  }

  // Collect (lastReview date) for every currently-mastered card that has a
  // non-null lastReview. Cards without a lastReview date are excluded — they
  // have never been graded, so they cannot have been mastered.
  const masteryDates: string[] = [];
  for (const card of cards) {
    if (card.state.lastReview === null) continue;
    if (!isMastered(card.state, masteryRepetitions)) continue;
    masteryDates.push(card.state.lastReview);
  }

  if (masteryDates.length === 0) return [];

  // Sort ascending so we can build the cumulative series in one pass.
  masteryDates.sort();

  // Collapse into one point per unique date, carrying the cumulative count.
  const series: MasteryPoint[] = [];
  let cumulative = 0;
  let currentDate = masteryDates[0];
  for (const date of masteryDates) {
    if (date !== currentDate) {
      series.push({ date: currentDate, count: cumulative });
      currentDate = date;
    }
    cumulative++;
  }
  // Push the last group.
  series.push({ date: currentDate, count: cumulative });

  return series;
}
