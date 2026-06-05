import type { ReviewableCard } from "@/lib/review/session";
import type { AppLocale } from "@/i18n/locales";
import { addDaysToIsoDate } from "@/lib/utils/dates";
import { isoMinusDays } from "@/lib/stats/date";
import { MASTERY_REPETITIONS } from "@/lib/stats/derive";
import { masteredSpeciesEvents, nameCardsForLocale } from "./mastery-species-events";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Result of the Pokédex-completion projection (issue #803).
 *
 * Three possible outcomes:
 *   - `"complete"` - all species are mastered (or `forceAllMastered` is on).
 *   - `"insufficient-history"` - not enough history to make a reliable estimate.
 *   - `"projected"` - a plausible completion date is available.
 */
export type CompletionProjection =
  | { kind: "complete" }
  | { kind: "insufficient-history" }
  | {
      kind: "projected";
      /** Estimated completion date as a YYYY-MM-DD string. */
      projectedDate: string;
      /** Species mastered per week over the trailing window (may be fractional). */
      weeklyRate: number;
      /** Species remaining to master (locked + learning). */
      remaining: number;
    };

// ---------------------------------------------------------------------------
// Configuration constants
// ---------------------------------------------------------------------------

/**
 * Size of the trailing window used to compute mastery rate. A 28-day window
 * (four weeks) smooths week-to-week volatility without losing sensitivity to
 * a user who has genuinely changed their pace.
 */
export const PROJECTION_WINDOW_DAYS = 28;

/**
 * Minimum number of days that must have elapsed since the earliest mastery
 * event within the trailing window before we show a projection. At 7 days the
 * user has had at least a full week of data - enough to avoid a wildly
 * optimistic single-session estimate, while not requiring weeks of patience
 * before seeing anything useful.
 *
 * The guard applies to history within the trailing `PROJECTION_WINDOW_DAYS`
 * window, not to the user's total session age.
 */
export const MIN_HISTORY_DAYS = 7;

/**
 * Cap on the projected completion date. Projections more than this many days
 * in the future are replaced with `"insufficient-history"` - they are
 * effectively meaningless and could be demoralising. 10 years is a generous
 * but finite ceiling.
 */
export const MAX_PROJECTION_DAYS = 365 * 10;

// ---------------------------------------------------------------------------
// computeCompletionProjection
// ---------------------------------------------------------------------------

/**
 * Pure: estimate when the user will have mastered all species.
 *
 * Since #1448, mastery is counted at the species level (both name + reverse
 * legs required, #1234). The full mixed-type card array is required so the
 * reverse leg can be found.
 *
 * Algorithm:
 *   1. Derive species-level mastery events from the full card array.
 *   2. Count "remaining" species = name cards whose species is NOT yet mastered.
 *   3. Count mastery events whose `masteredDate` falls within the trailing
 *      `PROJECTION_WINDOW_DAYS` window.
 *   4. Check the minimum-history guard: if the earliest mastery event in the
 *      window is fewer than `MIN_HISTORY_DAYS` ago, return
 *      `"insufficient-history"`.
 *   5. Extrapolate `remaining / weeklyRate * 7` days from today.
 *
 * @param cards              Full mixed-type card array from the session.
 * @param today              Today's date as YYYY-MM-DD.
 * @param masteryRepetitions Mastery threshold (matches the user's setting).
 * @param forceAllMastered   Superuser flag - when on, returns `"complete"`.
 */
export function computeCompletionProjection(
  cards: readonly ReviewableCard[],
  today: string,
  masteryRepetitions: number = MASTERY_REPETITIONS,
  forceAllMastered = false,
  locale: AppLocale = "en",
): CompletionProjection {
  // Superuser shortcut: the user pretends everything is mastered.
  if (forceAllMastered) {
    return { kind: "complete" };
  }

  // Derive species-level mastery events (both name + reverse legs, #1448).
  const events = masteredSpeciesEvents(cards, masteryRepetitions, false, locale);
  const masteredSpeciesIdSet = new Set(events.map((e) => e.speciesId));

  // Count name cards (species) that are NOT yet mastered.
  const nameCards = nameCardsForLocale(cards, locale);
  let remaining = 0;
  for (const card of nameCards) {
    if (!masteredSpeciesIdSet.has(card.id)) {
      remaining++;
    }
  }

  // All species are already mastered (or no name cards exist).
  if (remaining === 0) {
    return { kind: "complete" };
  }

  // Count mastery events in the trailing window.
  const windowStart = isoMinusDays(today, PROJECTION_WINDOW_DAYS - 1);
  let masteryEventsInWindow = 0;
  let earliestInWindow: string | null = null;

  for (const ev of events) {
    const d = ev.masteredDate;
    if (d >= windowStart && d <= today) {
      masteryEventsInWindow++;
      if (earliestInWindow === null || d < earliestInWindow) {
        earliestInWindow = d;
      }
    }
  }

  // No mastery events in the trailing window → cannot project.
  if (masteryEventsInWindow === 0 || earliestInWindow === null) {
    return { kind: "insufficient-history" };
  }

  // Minimum-history guard: the earliest mastery event in the window must be
  // at least MIN_HISTORY_DAYS ago. This prevents a single-session burst from
  // generating a wildly optimistic estimate.
  const earliestMs = new Date(earliestInWindow + "T00:00:00Z").getTime();
  const todayMs = new Date(today + "T00:00:00Z").getTime();
  const historyDays = Math.round((todayMs - earliestMs) / 86_400_000);

  if (historyDays < MIN_HISTORY_DAYS) {
    return { kind: "insufficient-history" };
  }

  // Compute mastery rate over the window. We use `historyDays` (the actual
  // span covered) rather than the full `PROJECTION_WINDOW_DAYS` so the rate
  // isn't artificially diluted on a user who is genuinely new.
  const effectiveWindowDays = Math.min(historyDays, PROJECTION_WINDOW_DAYS);
  const weeklyRate = (masteryEventsInWindow / effectiveWindowDays) * 7;

  // Extrapolate days to completion.
  const daysToCompletion = Math.ceil((remaining / weeklyRate) * 7);

  // Cap absurdly large projections.
  if (daysToCompletion > MAX_PROJECTION_DAYS) {
    return { kind: "insufficient-history" };
  }

  const projectedDate = addDaysToIsoDate(today, daysToCompletion);

  return {
    kind: "projected",
    projectedDate,
    weeklyRate,
    remaining,
  };
}
