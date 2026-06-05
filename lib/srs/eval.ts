import {
  nextReview,
  initialReviewState,
  type Grade,
  type ReviewState,
} from "./scheduler";
import { isoDate } from "@/lib/utils/format-date";

/**
 * One entry in a fixture life: the grade applied, and the number of days
 * elapsed since the previous grade (0 = same calendar day). The first
 * step uses `daysSinceLast: 0` against `startDate` so all fixtures begin
 * on a deterministic day.
 */
export type GradeStep = {
  grade: Grade;
  daysSinceLast: number;
};

/**
 * One row of the simulation trace. Captures the externally-observable
 * post-grade state - what changes here is what will change the user's
 * schedule. Floating-point fields are rounded to keep snapshots stable
 * across `ts-fsrs` patch versions that bump precision in the math.
 */
export type TraceRow = {
  step: number;
  grade: Grade;
  daysSinceLast: number;
  todayIso: string;
  fsrsState: ReviewState["fsrsState"];
  reps: number;
  lapses: number;
  scheduledDays: number;
  stability: number;
  difficulty: number;
  dueDate: string;
  learningStep: number | null;
};

const START_ISO = "2026-01-01";
const START_DATE = new Date(`${START_ISO}T12:00:00Z`);

function roundTo(value: number, places: number): number {
  const k = 10 ** places;
  return Math.round(value * k) / k;
}

function rowOf(
  step: number,
  grade: Grade,
  daysSinceLast: number,
  todayIso: string,
  state: ReviewState,
): TraceRow {
  return {
    step,
    grade,
    daysSinceLast,
    todayIso,
    fsrsState: state.fsrsState,
    reps: state.reps,
    lapses: state.lapses,
    // Round to 1 decimal place for fields that come straight off the FSRS
    // math, so a v6→v6.1 patch tweaking the 4th significant digit doesn't
    // generate spurious snapshot diffs while still surfacing real changes.
    scheduledDays: roundTo(state.scheduledDays, 1),
    stability:     roundTo(state.stability,     1),
    difficulty:    roundTo(state.difficulty,    2),
    dueDate: state.dueDate,
    learningStep: state.learningStep,
  };
}

/**
 * Replay `sequence` through `nextReview`. Pure: no Date.now() calls leak
 * in - every `now` is derived from `startDate + cumulative daysSinceLast`.
 *
 * Returns the trace plus the final state so a snapshot test can assert
 * both the journey and the destination.
 */
export function simulate(
  sequence: readonly GradeStep[],
  startDate: Date = START_DATE,
): { trace: TraceRow[]; final: ReviewState } {
  let state = initialReviewState(startDate);
  let cursor = startDate.getTime();
  const trace: TraceRow[] = [];

  sequence.forEach((step, idx) => {
    cursor += step.daysSinceLast * 86_400_000;
    const now = new Date(cursor);
    state = nextReview(state, step.grade, now);
    trace.push(rowOf(idx, step.grade, step.daysSinceLast, isoDate(now), state));
  });

  return { trace, final: state };
}

// ---------------------------------------------------------------------------
// Fixture lives - five archetypes covering the common shapes of real review
// histories. Snapshots over these surface any behavioural drift in the
// scheduler (parameter tweaks, library upgrades, retention-target changes)
// as a diff in the PR.
// ---------------------------------------------------------------------------

/** "Model student": consistent passes, growing intervals. */
export const FIXTURE_MODEL_STUDENT: GradeStep[] = [
  { grade: 4, daysSinceLast: 0 },
  { grade: 4, daysSinceLast: 1 },
  { grade: 4, daysSinceLast: 3 },
  { grade: 5, daysSinceLast: 8 },
  { grade: 4, daysSinceLast: 20 },
];

/** "Struggle": mix of fails and recoveries early on. */
export const FIXTURE_STRUGGLE: GradeStep[] = [
  { grade: 1, daysSinceLast: 0 },
  { grade: 2, daysSinceLast: 0 },
  { grade: 4, daysSinceLast: 0 },
  { grade: 1, daysSinceLast: 1 },
  { grade: 4, daysSinceLast: 0 },
  { grade: 2, daysSinceLast: 2 },
  { grade: 4, daysSinceLast: 4 },
];

/** "Lapse and recover": graduates cleanly, then a forgotten review. */
export const FIXTURE_LAPSE_AND_RECOVER: GradeStep[] = [
  { grade: 4, daysSinceLast: 0 },
  { grade: 4, daysSinceLast: 1 },
  { grade: 4, daysSinceLast: 3 },
  { grade: 4, daysSinceLast: 8 },
  { grade: 4, daysSinceLast: 16 },
  { grade: 1, daysSinceLast: 30 },
  { grade: 4, daysSinceLast: 0 },
  { grade: 4, daysSinceLast: 1 },
  { grade: 4, daysSinceLast: 4 },
];

/** "Long absence": clean graduation, then a 60-day gap. */
export const FIXTURE_LONG_ABSENCE: GradeStep[] = [
  { grade: 4, daysSinceLast: 0 },
  { grade: 4, daysSinceLast: 1 },
  { grade: 4, daysSinceLast: 60 },
];

/** "Easy from new": user knew it cold the first time. */
export const FIXTURE_EASY_FROM_NEW: GradeStep[] = [
  { grade: 5, daysSinceLast: 0 },
];

export const ALL_FIXTURES: ReadonlyArray<{
  name: string;
  steps: readonly GradeStep[];
}> = [
  { name: "model-student",    steps: FIXTURE_MODEL_STUDENT    },
  { name: "struggle",         steps: FIXTURE_STRUGGLE         },
  { name: "lapse-and-recover", steps: FIXTURE_LAPSE_AND_RECOVER },
  { name: "long-absence",     steps: FIXTURE_LONG_ABSENCE     },
  { name: "easy-from-new",    steps: FIXTURE_EASY_FROM_NEW    },
];
