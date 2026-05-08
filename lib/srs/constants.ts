/**
 * SRS step constants.
 *
 * Learning steps are applied to brand-new cards (first exposure).
 * Relearning steps are applied when a graduated card lapses (grade = Again).
 *
 * Step timing (ms) is used only by the in-memory learning queue in the UI
 * component — the scheduler itself does not compute wall-clock due times.
 */

/** Learning steps for new cards: 1 minute, then 10 minutes. */
export const LEARNING_STEPS_MS: readonly number[] = [60_000, 600_000];

/** Relearning step for lapsed cards: 10 minutes. */
export const RELEARNING_STEPS_MS: readonly number[] = [600_000];

/** Graduation interval after pressing Good at the final learning step (days). */
export const GRAD_INTERVAL_GOOD = 1;

/** Graduation interval after pressing Easy at any step (days). */
export const GRAD_INTERVAL_EASY = 4;
