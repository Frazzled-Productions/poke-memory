/**
 * SM-2 scheduler with Anki-style learning and relearning steps.
 *
 * Algorithm reference: P.A. Wozniak, "Optimization of Learning" (1990).
 *
 * Constants
 * ---------
 * DEFAULT_EASE_FACTOR  2.5   — starting multiplier for all new cards
 * MIN_EASE_FACTOR      1.3   — floor imposed by the SM-2 spec
 *
 * Grade mapping
 *   Again → 1   (failed, reset)
 *   Hard  → 2   (difficult, partial credit)
 *   Good  → 4   (passed)
 *   Easy  → 5   (passed, early graduation)
 *
 * Learning / relearning steps
 * ---------------------------
 * New cards go through [1m, 10m] learning steps before graduating to the
 * normal SM-2 schedule. Lapsed cards go through a single [10m] relearning
 * step. The in-memory wall-clock timing is managed by the UI component;
 * this module tracks only the step index in `learningStep`.
 *
 * `learningStep` meanings
 *   null           — graduated card (or brand new card, before first grade)
 *   0, 1, 2, …    — current step index in the applicable steps array
 *
 * Distinguishing new-card learning from relearning (no extra flag needed):
 *   new-card learning:  lastReview === null  (never graduated)
 *   relearning:         lastReview !== null  (lapsed after graduating)
 *
 * `lastReview` is set only on graduation or lapse — NOT on in-step touches.
 * This keeps `firstSeen === today` as the sole gate for `newIntroducedToday`
 * and `lastReview === today && firstSeen !== today` as the sole gate for
 * `reviewsDoneToday`.
 *
 * Interval rules (graduated path only)
 *   rep 1 (first graduation)  → GRAD_INTERVAL_GOOD (1 day) or GRAD_INTERVAL_EASY (4 days)
 *   rep 2                     → 6 days
 *   rep ≥ 3                   → floor(prevInterval * easeFactor)
 *
 * Ease-factor update (graduated card path only; frozen during step grading)
 *   EF ← max(1.3, EF + 0.1 − (5 − q) × (0.08 + (5 − q) × 0.02))
 *   Exception: a lapse (graduated card → Again) fires the EF penalty once,
 *   then parks the card in relearning at step 0.
 */

import {
  LEARNING_STEPS_MS,
  RELEARNING_STEPS_MS,
  GRAD_INTERVAL_GOOD,
  GRAD_INTERVAL_EASY,
} from "@/lib/srs/constants";

export type ReviewState = {
  repetitions: number;
  interval: number;
  easeFactor: number;
  dueDate: string;           // ISO 8601 "YYYY-MM-DD"
  lastReview: string | null;
  firstSeen: string | null;  // ISO date of first-ever grade. Set once; never overwritten.
  /**
   * null  → graduated (or brand-new, not yet graded)
   * 0..N  → current step index in the applicable steps array
   *          (LEARNING_STEPS_MS for new cards, RELEARNING_STEPS_MS for lapses)
   */
  learningStep: number | null;
};

export type Grade = 1 | 2 | 4 | 5;

const DEFAULT_EASE_FACTOR = 2.5;
const MIN_EASE_FACTOR = 1.3;

// Returns the date `days` after `date` as an ISO date string ("YYYY-MM-DD").
// Note: this combines local-time `setDate` with `toISOString` (UTC). The
// inconsistency is intentional and consistent with how due-date comparisons
// derive "today" — both sides slice toISOString, so the comparison is
// internally coherent. Don't switch one side to a local-timezone format
// without updating both, or you'll introduce off-by-one due-date bugs in
// negative-UTC-offset timezones.
function addDays(date: Date, days: number): string {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result.toISOString().slice(0, 10);
}

/**
 * Apply the SM-2 ease-factor update formula.
 * Used for the graduated card path and for the lapse EF penalty.
 */
function updatedEaseFactor(ef: number, grade: Grade): number {
  return Math.max(
    MIN_EASE_FACTOR,
    ef + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02),
  );
}

/**
 * Compute the next ReviewState given the current state, the grade, and today.
 *
 * Behaviour tree:
 *
 *   Case A: state.learningStep === null (graduated or brand-new card)
 *     A1. Brand new (lastReview === null) + Again/Hard/Good → enter learning step 0.
 *         lastReview stays null; firstSeen set if null.
 *     A2. Brand new + Easy → graduate immediately with GRAD_INTERVAL_EASY.
 *     A3. Graduated (lastReview !== null) + Again → lapse: EF penalised, enter
 *         relearning step 0, lastReview = today, repetitions = 0, interval = 1.
 *     A4. Graduated + Hard/Good/Easy → standard SM-2, no step change.
 *
 *   Case B: state.learningStep !== null (card in a learning or relearning step)
 *     B1. Again → reset to step 0.
 *     B2. Hard  → repeat current step (no change to learningStep).
 *     B3. Good  → advance one step, or graduate if at the last step.
 *     B4. Easy  → graduate immediately with GRAD_INTERVAL_EASY.
 *     EF is frozen during all step grading (the lapse EF penalty fires in A3,
 *     before the card enters relearning).
 */
export function nextReview(
  state: ReviewState,
  grade: Grade,
  now: Date,
): ReviewState {
  const today = now.toISOString().slice(0, 10);

  // --------------------------------------------------------------------------
  // Case B: card is currently in a learning or relearning step
  // --------------------------------------------------------------------------
  if (state.learningStep !== null) {
    // Number of steps depends on whether this is a new card or a relapse.
    const numSteps =
      state.lastReview === null
        ? LEARNING_STEPS_MS.length   // new-card learning
        : RELEARNING_STEPS_MS.length; // relearning after lapse

    if (grade === 1) {
      // Again → reset to step 0
      return {
        ...state,
        learningStep: 0,
      };
    }

    if (grade === 2) {
      // Hard → repeat current step
      return { ...state };
    }

    if (grade === 4) {
      // Good → advance one step, or graduate
      const nextStep = state.learningStep + 1;
      if (nextStep < numSteps) {
        return {
          ...state,
          learningStep: nextStep,
        };
      }
      // Graduate
      return {
        ...state,
        learningStep: null,
        repetitions: 1,
        interval: GRAD_INTERVAL_GOOD,
        dueDate: addDays(now, GRAD_INTERVAL_GOOD),
        lastReview: today,
        // firstSeen is already set when the card first entered a step; preserve it
      };
    }

    // grade === 5: Easy → graduate immediately
    return {
      ...state,
      learningStep: null,
      repetitions: 1,
      interval: GRAD_INTERVAL_EASY,
      dueDate: addDays(now, GRAD_INTERVAL_EASY),
      lastReview: today,
    };
  }

  // --------------------------------------------------------------------------
  // Case A: card is graduated or brand-new (learningStep === null)
  // --------------------------------------------------------------------------

  const isBrandNew = state.lastReview === null;

  if (isBrandNew) {
    // A1 / A2: first ever touch
    const firstSeen = state.firstSeen ?? today;

    if (grade === 5) {
      // A2: Easy → graduate immediately, skip learning steps
      return {
        ...state,
        learningStep: null,
        repetitions: 1,
        interval: GRAD_INTERVAL_EASY,
        easeFactor: state.easeFactor, // EF unchanged on first touch
        dueDate: addDays(now, GRAD_INTERVAL_EASY),
        lastReview: today,
        firstSeen,
      };
    }

    // A1: Again / Hard / Good → enter learning step 0.
    // lastReview deliberately stays null so daily counters treat the card as
    // "new" (firstSeen === today counts it in newIntroducedToday, not
    // reviewsDoneToday). The wall-clock timer is managed by the UI component.
    return {
      ...state,
      learningStep: 0,
      // repetitions, interval, easeFactor, dueDate, lastReview all unchanged
      firstSeen,
    };
  }

  // A3: Graduated card + Again → lapse
  if (grade === 1) {
    const newEF = updatedEaseFactor(state.easeFactor, grade);
    return {
      ...state,
      learningStep: 0,
      repetitions: 0,
      interval: 1,
      easeFactor: newEF,
      dueDate: today,
      lastReview: today,
      // firstSeen unchanged
    };
  }

  // A4: Graduated card + Hard / Good / Easy → standard SM-2
  const newEF = updatedEaseFactor(state.easeFactor, grade);

  if (grade === 2) {
    // Hard on a graduated card: SM-2 treats this as a soft fail (grade < 3),
    // resetting repetitions and interval. The card does NOT enter relearning —
    // it just reschedules to tomorrow under the standard graduated path.
    return {
      ...state,
      learningStep: null,
      repetitions: 0,
      interval: 1,
      easeFactor: newEF,
      dueDate: addDays(now, 1),
      lastReview: today,
    };
  }

  const newRepetitions = state.repetitions + 1;
  let newInterval: number;
  if (newRepetitions === 1) newInterval = GRAD_INTERVAL_GOOD;
  else if (newRepetitions === 2) newInterval = 6;
  else newInterval = Math.floor(state.interval * newEF);

  return {
    ...state,
    learningStep: null,
    repetitions: newRepetitions,
    interval: newInterval,
    easeFactor: newEF,
    dueDate: addDays(now, newInterval),
    lastReview: today,
  };
}

export function initialReviewState(now: Date = new Date()): ReviewState {
  return {
    repetitions: 0,
    interval: 0,
    easeFactor: DEFAULT_EASE_FACTOR,
    dueDate: now.toISOString().slice(0, 10),
    lastReview: null,
    firstSeen: null,
    learningStep: null,
  };
}
