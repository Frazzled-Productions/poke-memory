import type { NameReviewCard } from "@/lib/review/session";
import { isMastered } from "@/lib/stats/derive";
import { addDaysToIsoDate } from "@/lib/utils/dates";
import { isoMinusDays } from "@/lib/stats/date";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Result of the Pokédex-completion projection (issue #803).
 *
 * Three possible outcomes:
 *   - `"complete"` — all species are mastered (or `forceAllMastered` is on).
 *   - `"insufficient-history"` — not enough history to make a reliable estimate.
 *   - `"projected"` — a plausible completion date is available.
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
 * user has had at least a full week of data — enough to avoid a wildly
 * optimistic single-session estimate, while not requiring weeks of patience
 * before seeing anything useful.
 *
 * The guard applies to history within the trailing `PROJECTION_WINDOW_DAYS`
 * window, not to the user's total session age.
 */
export const MIN_HISTORY_DAYS = 7;

/**
 * Cap on the projected completion date. Projections more than this many days
 * in the future are replaced with `"insufficient-history"` — they are
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
 * Algorithm:
 *   1. Count mastery events (cards whose `lastReview` falls within the
 *      trailing `PROJECTION_WINDOW_DAYS` window AND that are currently
 *      mastered). We use `lastReview` as a proxy for "when this card was
 *      last confirmed mastered" — the same approximation used in
 *      `computeRecords` for `avgDaysToMastery`.
 *   2. Derive a weekly rate from that count and the span of the window
 *      actually covered by history (clamped to the window size).
 *   3. Check the minimum-history guard: if the earliest mastery event in the
 *      window is fewer than `MIN_HISTORY_DAYS` ago, return
 *      `"insufficient-history"`.
 *   4. Extrapolate `remaining / weeklyRate * 7` days from today.
 *
 * @param cards              Name-card array from the session.
 * @param today              Today's date as YYYY-MM-DD.
 * @param masteryRepetitions Mastery threshold (matches the user's setting).
 * @param forceAllMastered   Superuser flag — when on, returns `"complete"`.
 */
export function computeCompletionProjection(
  cards: readonly NameReviewCard[],
  today: string,
  masteryRepetitions: number,
  forceAllMastered = false,
): CompletionProjection {
  // Superuser shortcut: the user pretends everything is mastered.
  if (forceAllMastered) {
    return { kind: "complete" };
  }

  // Count currently mastered vs remaining species.
  let masteredCount = 0;
  let remaining = 0;
  // Mastery events that fall within the trailing window (last-review date).
  const windowStart = isoMinusDays(today, PROJECTION_WINDOW_DAYS - 1);
  let masteryEventsInWindow = 0;
  // Track the earliest mastery-event date in the window to apply the
  // minimum-history guard.
  let earliestInWindow: string | null = null;

  for (const card of cards) {
    const mastered = isMastered(card.state, masteryRepetitions);
    if (mastered) {
      masteredCount++;
      // Check whether the card's last review falls within the window —
      // this is our proxy for "mastered recently".
      const lr = card.state.lastReview;
      if (lr !== null && lr >= windowStart && lr <= today) {
        masteryEventsInWindow++;
        if (earliestInWindow === null || lr < earliestInWindow) {
          earliestInWindow = lr;
        }
      }
    } else {
      remaining++;
    }
  }

  // All species are already mastered.
  if (remaining === 0) {
    return { kind: "complete" };
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
  const daysToCompletion = Math.ceil(remaining / weeklyRate * 7);

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
