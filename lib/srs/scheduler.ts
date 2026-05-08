/**
 * SM-2 scheduler.
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
 *   Hard  → 2   (failed, reset)
 *   Good  → 4   (passed)
 *   Easy  → 5   (passed)
 *
 * Interval rules
 *   rep 0 (first ever pass)  → 1 day
 *   rep 1 (second pass)      → 6 days
 *   rep ≥ 2                  → floor(prevInterval * easeFactor)
 *
 * Ease-factor update (applied regardless of pass/fail per SM-2 spec)
 *   EF ← max(1.3, EF + 0.1 − (5 − q) × (0.08 + (5 − q) × 0.02))
 *
 * On a lapse (grade < 3): repetitions reset to 0, interval resets to 1,
 * ease factor is still adjusted (penalised).
 */

export type ReviewState = {
  repetitions: number;
  interval: number;
  easeFactor: number;
  dueDate: string;          // ISO 8601 "YYYY-MM-DD"
  lastReview: string | null;
};

export type Grade = 1 | 2 | 4 | 5;

const DEFAULT_EASE_FACTOR = 2.5;
const MIN_EASE_FACTOR = 1.3;

function addDays(date: Date, days: number): string {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result.toISOString().slice(0, 10);
}

export function nextReview(
  state: ReviewState,
  grade: Grade,
  now: Date,
): ReviewState {
  const passed = grade >= 3;

  const newEaseFactor = Math.max(
    MIN_EASE_FACTOR,
    state.easeFactor + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02),
  );

  if (!passed) {
    return {
      repetitions: 0,
      interval: 1,
      easeFactor: newEaseFactor,
      dueDate: addDays(now, 1),
      lastReview: now.toISOString().slice(0, 10),
    };
  }

  const newRepetitions = state.repetitions + 1;
  let newInterval: number;
  if (newRepetitions === 1) newInterval = 1;
  else if (newRepetitions === 2) newInterval = 6;
  else newInterval = Math.floor(state.interval * newEaseFactor);

  return {
    repetitions: newRepetitions,
    interval: newInterval,
    easeFactor: newEaseFactor,
    dueDate: addDays(now, newInterval),
    lastReview: now.toISOString().slice(0, 10),
  };
}

export function initialReviewState(): ReviewState {
  return {
    repetitions: 0,
    interval: 0,
    easeFactor: DEFAULT_EASE_FACTOR,
    dueDate: new Date().toISOString().slice(0, 10),
    lastReview: null,
  };
}
