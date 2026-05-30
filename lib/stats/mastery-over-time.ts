import type { ReviewableCard } from "@/lib/review/session";
import { MASTERY_REPETITIONS } from "./derive";
import { masteredSpeciesEvents } from "./mastery-species-events";

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
 * Derive a cumulative mastery-over-time series from the FULL card array
 * (all card types). Pure — no I/O.
 *
 * **Species-level mastery (#1234/#1448)**: a species is mastered only when
 * BOTH its name card AND its paired reverse card have cleared the FSRS gate.
 * The `masteredDate` for a species is the later of the two `lastReview` dates —
 * i.e. the date the SECOND leg crossed the threshold.
 *
 * **Data source**: `lastReview` on the later-crossing card is used as the
 * proxy for the mastery-crossing date. The card *may* have crossed the threshold
 * on an earlier review, but without a persisted "first mastered at" date we
 * trade exactness for no schema migration.
 * Guest-mode localStorage data supports this fully (card states include
 * `lastReview`).
 *
 * **`forceAllMastered`** (superuser `pretendAllMastered` flag): when `true`
 * the series is a single point at `today` with `count` equal to the number of
 * name cards (species count), consistent with `computeStats`'s treatment of
 * the flag. Pass the flag through from the caller — do not read it from context
 * here.
 *
 * **Empty state**: an empty array is returned when no species has been fully
 * mastered. The UI renders an empty state for `series.length === 0`.
 *
 * @param cards              Full mixed-type card array from the session.
 * @param today              YYYY-MM-DD string for the current date.
 * @param masteryRepetitions Mastery reps threshold (default `MASTERY_REPETITIONS`).
 * @param forceAllMastered   Superuser flag — when `true` collapse to a single point.
 */
export function computeMasteryOverTime(
  cards: readonly ReviewableCard[],
  today: string,
  masteryRepetitions = MASTERY_REPETITIONS,
  forceAllMastered = false,
): MasteryPoint[] {
  if (forceAllMastered) {
    // Superuser overlay: treat every species as mastered at today's date.
    // Count name cards as the species count (consistent with computeStats).
    const nameCardCount = cards.filter(
      (c) => c.cardType === "name",
    ).length;
    return [{ date: today, count: nameCardCount }];
  }

  // Collect the species-level mastery date for every fully-mastered species.
  // masteredSpeciesEvents returns only species where BOTH name+reverse are mastered.
  const events = masteredSpeciesEvents(cards, masteryRepetitions, false);
  const masteryDates: string[] = events.map((e) => e.masteredDate);

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
