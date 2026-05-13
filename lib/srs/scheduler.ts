/**
 * FSRS scheduler with Anki-style learning and relearning steps.
 *
 * Graduated cards delegate the interval math to `ts-fsrs` (see
 * https://github.com/open-spaced-repetition/ts-fsrs). The Anki-style
 * learning-step layer (`learningStep`, `stepStartedAt`, LEARNING_STEPS_MS,
 * RELEARNING_STEPS_MS) is preserved — FSRS schedules graduated cards only;
 * the learning loop is the same wall-clock-driven flow it has always been.
 *
 * Grade mapping
 *   Again → 1   (failed)
 *   Hard  → 2   (difficult, partial credit)
 *   Good  → 4   (passed)
 *   Easy  → 5   (passed, early graduation)
 *
 * The 1/2/4/5 grades match our internal convention. FSRS's Rating enum is
 * 1/2/3/4; the mapping is applied at the FSRS boundary.
 *
 * `learningStep` meanings
 *   null           — graduated card (or brand-new before first touch)
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
 */

import {
  fsrs as createFsrs,
  createEmptyCard,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade as FsrsGrade,
} from "ts-fsrs";

import {
  learningStepsFor,
  relearningStepsFor,
  GRAD_INTERVAL_GOOD,
  GRAD_INTERVAL_EASY,
} from "@/lib/srs/constants";

export type FsrsStateLabel = "new" | "learning" | "review" | "relearning";

export type ReviewState = {
  // FSRS core (graduated-path math)
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  fsrsState: FsrsStateLabel;
  // Unchanged across the SM-2 → FSRS swap
  dueDate: string;           // ISO 8601 "YYYY-MM-DD"
  lastReview: string | null;
  firstSeen: string | null;  // ISO date of first-ever grade. Set once; never overwritten.
  learningStep: number | null;
  stepStartedAt: number | null;
  // Learning-filter snooze (#333). Set on the day a card first becomes
  // ineligible under the active filter; cleared on un-hide after dueDate is
  // shifted forward by the hidden duration. Null when the card is currently
  // eligible (the normal case).
  hiddenSince: string | null;
  // Pasture feature (#350). True once the user has viewed the card on the
  // pasture page after mastery. Reset to false if a card regresses below the
  // mastery threshold (not currently possible, kept for future-proofing).
  seenInPasture: boolean;
};

export type Grade = 1 | 2 | 4 | 5;

const DEFAULT_RETENTION = 0.9;
const defaultScheduler = createFsrs();

// Small cache so a session that only uses one retention setting doesn't
// instantiate a new FSRS object per grade. Keyed on the retention value
// rounded to 2 decimals (matches the settings slider granularity).
const schedulerCache = new Map<string, ReturnType<typeof createFsrs>>();

function getScheduler(retention: number | undefined): ReturnType<typeof createFsrs> {
  if (retention === undefined || retention === DEFAULT_RETENTION) {
    return defaultScheduler;
  }
  const key = retention.toFixed(2);
  const cached = schedulerCache.get(key);
  if (cached !== undefined) return cached;
  const fresh = createFsrs({ request_retention: retention });
  schedulerCache.set(key, fresh);
  return fresh;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): string {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return isoDate(result);
}

const STATE_LABEL_TO_ENUM: Record<FsrsStateLabel, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const STATE_ENUM_TO_LABEL: Record<State, FsrsStateLabel> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

const GRADE_TO_RATING: Record<Grade, FsrsGrade> = {
  1: Rating.Again,
  2: Rating.Hard,
  4: Rating.Good,
  5: Rating.Easy,
};

function toFsrsCard(state: ReviewState, now: Date): FsrsCard {
  if (state.fsrsState === "new" && state.lastReview === null) {
    return createEmptyCard(now);
  }
  return {
    due: new Date(state.dueDate),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsedDays,
    scheduled_days: state.scheduledDays,
    learning_steps: 0, // we manage the in-step layer ourselves
    reps: state.reps,
    lapses: state.lapses,
    state: STATE_LABEL_TO_ENUM[state.fsrsState],
    last_review: state.lastReview ? new Date(state.lastReview) : undefined,
  };
}

type FsrsResult = Pick<
  ReviewState,
  | "stability"
  | "difficulty"
  | "elapsedDays"
  | "scheduledDays"
  | "reps"
  | "lapses"
  | "fsrsState"
  | "dueDate"
>;

function fromFsrsCard(card: FsrsCard): FsrsResult {
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    fsrsState: STATE_ENUM_TO_LABEL[card.state],
    dueDate: isoDate(card.due),
  };
}

/**
 * Compute the next ReviewState given the current state, the grade, and today.
 *
 * Case A: state.learningStep === null (graduated or brand-new card)
 *   A1. Brand new (lastReview === null) + Again/Hard/Good → enter learning step 0.
 *       lastReview stays null; firstSeen set if null.
 *   A2. Brand new + Easy → graduate immediately via FSRS.
 *   A3. Graduated (lastReview !== null) + Again → lapse: FSRS computes new
 *       stability/difficulty for an Again, then card enters relearning step 0.
 *   A4. Graduated + Hard/Good/Easy → FSRS standard update.
 *
 * Case B: state.learningStep !== null (card in a learning or relearning step)
 *   B1. Again → reset to step 0.
 *   B2. Hard  → repeat current step (no change to learningStep).
 *   B3. Good  → advance one step, or graduate via FSRS if at the last step.
 *   B4. Easy  → graduate immediately via FSRS.
 *
 * FSRS is never called for B1, B2, or A1 — those touches stay inside the
 * in-step / brand-new layer and don't affect stability/difficulty.
 */
export type NextReviewOptions = {
  /**
   * FSRS request_retention override (e.g. 0.85). Falls back to the
   * library default (0.9) when omitted or set to the default value.
   */
  retentionTarget?: number;
};

export function nextReview(
  state: ReviewState,
  grade: Grade,
  now: Date,
  options: NextReviewOptions = {},
): ReviewState {
  const today = isoDate(now);
  const scheduler = getScheduler(options.retentionTarget);

  // --------------------------------------------------------------------------
  // Case B: card is currently in a learning or relearning step
  // --------------------------------------------------------------------------
  if (state.learningStep !== null) {
    const steps =
      state.lastReview === null
        ? learningStepsFor(state.difficulty)
        : relearningStepsFor(state.difficulty);
    const numSteps = steps.length;

    if (grade === 1) {
      // B1: Again → reset to step 0
      return {
        ...state,
        learningStep: 0,
        stepStartedAt: now.getTime(),
      };
    }

    if (grade === 2) {
      // B2: Hard → repeat current step (preserve existing stepStartedAt)
      return { ...state };
    }

    if (grade === 4) {
      const nextStep = state.learningStep + 1;
      if (nextStep < numSteps) {
        // B3 advance
        return {
          ...state,
          learningStep: nextStep,
          stepStartedAt: now.getTime(),
        };
      }
      // B3 graduate: last step reached. FSRS produces the initial stability
      // and difficulty; we override scheduledDays/dueDate with the constant
      // grad interval so "Good on the last step → due tomorrow" is exact.
      // fsrsState is forced to 'review' because our Anki layer has just
      // satisfied the equivalent of FSRS's internal learning loop.
      const card = toFsrsCard(state, now);
      const result = scheduler.next(card, now, Rating.Good);
      const fsrs = fromFsrsCard(result.card);
      return {
        ...state,
        ...fsrs,
        fsrsState: "review",
        scheduledDays: GRAD_INTERVAL_GOOD,
        dueDate: addDays(now, GRAD_INTERVAL_GOOD),
        learningStep: null,
        stepStartedAt: null,
        lastReview: today,
      };
    }

    // grade === 5: B4: Easy → graduate immediately
    const card = toFsrsCard(state, now);
    const result = scheduler.next(card, now, Rating.Easy);
    const fsrs = fromFsrsCard(result.card);
    return {
      ...state,
      ...fsrs,
      fsrsState: "review",
      scheduledDays: GRAD_INTERVAL_EASY,
      dueDate: addDays(now, GRAD_INTERVAL_EASY),
      learningStep: null,
      stepStartedAt: null,
      lastReview: today,
    };
  }

  // --------------------------------------------------------------------------
  // Case A: card is graduated or brand-new (learningStep === null)
  // --------------------------------------------------------------------------
  const isBrandNew = state.lastReview === null;

  if (isBrandNew) {
    const firstSeen = state.firstSeen ?? today;

    if (grade === 5) {
      // A2: Easy → graduate immediately via FSRS. fsrsState forced to 'review'
      // because we skipped the Anki learning steps entirely.
      const card = createEmptyCard(now);
      const result = scheduler.next(card, now, Rating.Easy);
      const fsrs = fromFsrsCard(result.card);
      return {
        ...state,
        ...fsrs,
        fsrsState: "review",
        scheduledDays: GRAD_INTERVAL_EASY,
        dueDate: addDays(now, GRAD_INTERVAL_EASY),
        learningStep: null,
        stepStartedAt: null,
        lastReview: today,
        firstSeen,
      };
    }

    // A1: Again / Hard / Good → enter learning step 0. lastReview stays null
    // so daily counters treat the card as "new" (firstSeen === today counts
    // it in newIntroducedToday, not reviewsDoneToday).
    return {
      ...state,
      learningStep: 0,
      stepStartedAt: now.getTime(),
      firstSeen,
    };
  }

  // A3: Graduated card + Again → lapse. FSRS computes new stability and
  // difficulty for the lapse; we then put the card into relearning step 0.
  if (grade === 1) {
    const card = toFsrsCard(state, now);
    const result = scheduler.next(card, now, Rating.Again);
    const fsrs = fromFsrsCard(result.card);
    return {
      ...state,
      ...fsrs,
      dueDate: today,
      learningStep: 0,
      stepStartedAt: now.getTime(),
      lastReview: today,
    };
  }

  // A4: Graduated card + Hard / Good / Easy → standard FSRS update
  const card = toFsrsCard(state, now);
  const result = scheduler.next(card, now, GRADE_TO_RATING[grade]);
  const fsrs = fromFsrsCard(result.card);
  return {
    ...state,
    ...fsrs,
    learningStep: null,
    stepStartedAt: null,
    lastReview: today,
  };
}

export function initialReviewState(now: Date = new Date()): ReviewState {
  return {
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    fsrsState: "new",
    dueDate: isoDate(now),
    lastReview: null,
    firstSeen: null,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  };
}
