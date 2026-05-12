import { nextReview, ReviewState, Grade } from "@/lib/srs/scheduler";
import { LEARNING_STEPS_MS, RELEARNING_STEPS_MS } from "@/lib/srs/constants";

const GRADES: Grade[] = [1, 2, 4, 5];

function formatGraduatedLabel(days: number): string {
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

/**
 * For each of the four SM-2 grades, simulate `nextReview` and return a
 * human-readable label representing how soon the card would next be due.
 *
 * In-step cards show a minute countdown (`<Xm`).
 * Graduated cards show a day/month/year count (`Nd`, `Nmo`, `Ny`).
 */
export function previewIntervals(
  state: ReviewState,
  now: Date,
): Record<Grade, string> {
  const result = {} as Record<Grade, string>;

  for (const grade of GRADES) {
    const next = nextReview(state, grade, now);

    if (next.learningStep !== null) {
      // Card stays in / enters a learning or relearning step.
      const steps =
        next.lastReview === null ? LEARNING_STEPS_MS : RELEARNING_STEPS_MS;
      const stepMs = steps[Math.min(next.learningStep, steps.length - 1)];
      const stepStartedAt = next.stepStartedAt ?? now.getTime();
      const remainingMs = Math.max(0, stepStartedAt + stepMs - now.getTime());
      const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
      result[grade] = `<${minutes}m`;
    } else {
      result[grade] = formatGraduatedLabel(next.interval);
    }
  }

  return result;
}
