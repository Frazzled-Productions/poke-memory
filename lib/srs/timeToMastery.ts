/**
 * Project the number of days until a user reaches their first mastery
 * (`reps >= masteryRepetitions && scheduledDays >= MASTERY_INTERVAL_DAYS`).
 *
 * Used by the Stats page hint introduced in #1083: a new user with a streak
 * and zero masteries has no in-app signal that mastery legitimately takes
 * weeks to land. The hint surfaces a hedged "roughly N days" estimate so the
 * mastered=0 state doesn't read as broken.
 *
 * Approach: for every introduced not-yet-mastered card, simulate forward
 * grades under an "always Good" assumption (the realistic baseline; Easy
 * would be a faster ceiling but adds noise). We advance the simulated clock
 * between calls to `nextReview` by the in-step duration (for in-step touches)
 * or by `scheduledDays` (for graduated touches). The minimum across cards is
 * the projected time-to-first-mastery - that's the card the user will
 * realistically master first.
 *
 * Returns `{ days: null }` when:
 *   - there are no introduced not-yet-mastered cards (nothing to project);
 *   - or `forceAllMastered` is on (the QA cheat treats mastery as complete).
 *
 * The simulation is bounded by `MAX_SIMULATION_STEPS` so a pathological card
 * (e.g. corrupted state that never graduates under Good) can't loop forever;
 * such cards are silently skipped.
 */

import {
  nextReview,
  type ReviewState,
  type NextReviewOptions,
} from "@/lib/srs/scheduler";
import { relearningStepsFor } from "@/lib/srs/constants";
import {
  isMastered,
  MASTERY_REPETITIONS,
} from "@/lib/stats/derive";
import type { NameReviewCard } from "@/lib/review/session";

/** Cap the per-card simulation depth so a degenerate state cannot loop forever. */
const MAX_SIMULATION_STEPS = 50;

/** Always-Good grade - the realistic baseline assumption (see file header). */
const GOOD = 4 as const;

export type TimeToMasteryResult = {
  /** Projected days from `now` to first mastery, or null when not projectable. */
  days: number | null;
};

/**
 * Pure: project the days-to-first-mastery across the user's introduced
 * not-yet-mastered cards under an "always Good" grade assumption.
 *
 * @param cards              All session cards (any type). Only introduced,
 *                           not-yet-mastered cards are simulated.
 * @param now                Reference timestamp; the projection counts from here.
 * @param masteryRepetitions Mastery threshold (matches the user's setting).
 *                           Defaults to MASTERY_REPETITIONS.
 * @param forceAllMastered   Superuser flag - when on, returns `{ days: null }`
 *                           because mastery is "complete" under the cheat.
 * @param options            FSRS overrides (retention target, per-user weights);
 *                           passed straight through to `nextReview` so the
 *                           projection respects the same scheduler the user
 *                           is actually graded against.
 */
export function projectTimeToFirstMastery(
  cards: readonly NameReviewCard[],
  now: Date,
  masteryRepetitions: number = MASTERY_REPETITIONS,
  forceAllMastered = false,
  options: NextReviewOptions = {},
): TimeToMasteryResult {
  if (forceAllMastered) return { days: null };

  let bestDays: number | null = null;

  for (const card of cards) {
    // Skip locked (never introduced) and already-mastered cards. The hint
    // hides entirely once any card is mastered, but the function still
    // needs to be robust against being called with a mixed set.
    if (card.state.lastReview === null) continue;
    if (isMastered(card.state, masteryRepetitions)) continue;

    const days = simulateOne(card.state, now, masteryRepetitions, options);
    if (days === null) continue;

    if (bestDays === null || days < bestDays) {
      bestDays = days;
    }
  }

  if (bestDays === null) return { days: null };

  // Floor at 1 - "0 days" reads like a bug, and the user is almost certainly
  // grading mid-day rather than at midnight UTC.
  const rounded = Math.max(1, Math.round(bestDays));
  return { days: rounded };
}

/**
 * Walk one card forward under "always Good" until mastery is reached or the
 * step cap is exceeded. Returns the number of days from `start` to mastery,
 * or null when the simulation gave up.
 */
function simulateOne(
  initial: ReviewState,
  start: Date,
  masteryRepetitions: number,
  options: NextReviewOptions,
): number | null {
  let state = initial;
  let cursorMs = start.getTime();

  for (let step = 0; step < MAX_SIMULATION_STEPS; step++) {
    // Advance the simulated clock to when the next "Good" grade would
    // realistically happen. For in-step cards, that's the relearning step's
    // duration (~1m or ~10m). For graduated cards, that's `scheduledDays`
    // from the last review.
    const advanceMs = computeAdvanceMs(state);
    cursorMs += advanceMs;

    const cursor = new Date(cursorMs);
    state = nextReview(state, GOOD, cursor, options);

    if (isMastered(state, masteryRepetitions)) {
      const elapsedMs = cursorMs - start.getTime();
      return elapsedMs / 86_400_000;
    }
  }
  return null;
}

/**
 * Milliseconds from "now" to the next realistic "Good" grade for `state`.
 * Mirrors the timing logic in `lib/srs/intervalPreview.ts` so the projection
 * uses the same step ladder the UI actually counts down with.
 *
 * Precondition: `state.lastReview !== null`. The caller (`simulateOne`) is
 * only invoked after `projectTimeToFirstMastery` has skipped every card whose
 * `lastReview === null` (a not-yet-introduced card is, by definition, not in
 * scope for a first-mastery projection). The brand-new branch of the step
 * ladder is therefore unreachable from this function, and we read from the
 * relearning steps unconditionally - the same ladder a lapsed-but-introduced
 * card uses to climb back to graduation.
 */
function computeAdvanceMs(state: ReviewState): number {
  if (state.learningStep !== null) {
    const steps = relearningStepsFor(state.difficulty);
    const stepMs = steps[Math.min(state.learningStep, steps.length - 1)];
    return stepMs;
  }
  // Graduated card: schedule the next review at `scheduledDays` from now.
  // Floor at 1 so a zero-interval state (e.g. fresh post-graduation) still
  // moves the clock forward.
  const days = Math.max(1, state.scheduledDays);
  return days * 86_400_000;
}

