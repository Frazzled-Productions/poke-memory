/**
 * SRS step constants.
 *
 * Learning steps are applied to brand-new cards (first exposure).
 * Relearning steps are applied when a graduated card lapses (grade = Again).
 *
 * Step timing (ms) is used only by the in-memory learning queue in the UI
 * component — the scheduler itself does not compute wall-clock due times.
 */

/**
 * Default learning steps for new cards. The scheduler and UI use
 * `learningStepsFor(difficulty)` so harder cards (FSRS difficulty 8+)
 * get more steps, while easy cards (≤4) graduate after a single 1m
 * step. This constant is the medium-band default — preserved so legacy
 * callers and tests that don't have a difficulty value keep working.
 */
export const LEARNING_STEPS_MS: readonly number[] = [60_000, 600_000];

/** Default relearning step for lapsed cards: 10 minutes. */
export const RELEARNING_STEPS_MS: readonly number[] = [600_000];

const EASY_LEARNING_STEPS:   readonly number[] = [60_000];                    // 1m
const HARD_LEARNING_STEPS:   readonly number[] = [60_000, 300_000, 900_000];  // 1m, 5m, 15m
const HARD_RELEARNING_STEPS: readonly number[] = [300_000, 900_000];          // 5m, 15m

/**
 * Difficulty-aware learning ladder. Difficulty is FSRS's 1..10 scale
 * (higher = harder); a brand-new card with `difficulty: 0` falls into
 * the medium band. Numbers are starting points and intentionally
 * generous on the hard end so two failures don't graduate prematurely.
 */
export function learningStepsFor(difficulty: number): readonly number[] {
  if (difficulty <= 0) return LEARNING_STEPS_MS;
  if (difficulty <= 4) return EASY_LEARNING_STEPS;
  if (difficulty <= 7) return LEARNING_STEPS_MS;
  return HARD_LEARNING_STEPS;
}

/**
 * Difficulty-aware relearning ladder. Easy/medium cards keep the
 * existing single 10m step; hard cards earn a 5m → 15m two-step.
 */
export function relearningStepsFor(difficulty: number): readonly number[] {
  if (difficulty <= 7) return RELEARNING_STEPS_MS;
  return HARD_RELEARNING_STEPS;
}

/** Graduation interval after pressing Good at the final learning step (days). */
export const GRAD_INTERVAL_GOOD = 1;

/** Graduation interval after pressing Easy at any step (days). */
export const GRAD_INTERVAL_EASY = 4;

// org-transfer deploy probe (throwaway branch, do not merge)

// re-probe after Vercel git reconnect confirmed
