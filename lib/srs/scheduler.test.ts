import { describe, it, expect } from "vitest";
import { nextReview, initialReviewState } from "@/lib/srs/scheduler";
import type { ReviewState } from "@/lib/srs/scheduler";
import { migrateReviewState } from "@/lib/review/persistence";
import {
  LEARNING_STEPS_MS,
  RELEARNING_STEPS_MS,
  GRAD_INTERVAL_GOOD,
  GRAD_INTERVAL_EASY,
} from "@/lib/srs/constants";

const NOW = new Date("2026-05-08T12:00:00Z");
const TODAY = "2026-05-08";

// Helper: a graduated card (has been reviewed at least once). FSRS shape;
// stability/difficulty values approximate the result of an SM-2 → FSRS
// migration from `{ repetitions: 2, interval: 6, easeFactor: 2.5 }`.
function graduatedCard(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    stability: 6,
    difficulty: 1,
    elapsedDays: 0,
    scheduledDays: 6,
    reps: 2,
    lapses: 0,
    fsrsState: "review",
    dueDate: TODAY,
    lastReview: "2026-05-02",
    firstSeen: "2026-04-26",
    learningStep: null,
    stepStartedAt: null,
    ...overrides,
  };
}

function newCard(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    ...initialReviewState(NOW),
    ...overrides,
  };
}

function cardInStep(
  step: number,
  lastReview: string | null = null,
  overrides: Partial<ReviewState> = {},
): ReviewState {
  return {
    ...newCard(),
    lastReview,
    firstSeen: lastReview === null ? TODAY : "2026-04-26",
    learningStep: step,
    stepStartedAt: NOW.getTime(),
    ...overrides,
  };
}

// ============================================================
// Constants sanity
// ============================================================
describe("constants", () => {
  it("exports correct step counts", () => {
    expect(LEARNING_STEPS_MS).toHaveLength(2);
    expect(RELEARNING_STEPS_MS).toHaveLength(1);
  });

  it("GRAD_INTERVAL_GOOD is 1, GRAD_INTERVAL_EASY is 4", () => {
    expect(GRAD_INTERVAL_GOOD).toBe(1);
    expect(GRAD_INTERVAL_EASY).toBe(4);
  });
});

// ============================================================
// initialReviewState
// ============================================================
describe("initialReviewState", () => {
  it("starts a brand-new card in fsrsState='new' with null timestamps", () => {
    const state = initialReviewState(NOW);
    expect(state.fsrsState).toBe("new");
    expect(state.stability).toBe(0);
    expect(state.difficulty).toBe(0);
    expect(state.reps).toBe(0);
    expect(state.lapses).toBe(0);
    expect(state.learningStep).toBeNull();
    expect(state.lastReview).toBeNull();
    expect(state.firstSeen).toBeNull();
  });
});

// ============================================================
// Case A1: brand-new + Again/Hard/Good → enter learning step 0
// ============================================================
describe("Case A1: brand-new card graded Good enters learning step", () => {
  it("sets learningStep=0 and firstSeen=today, leaves lastReview null", () => {
    const next = nextReview(newCard(), 4, NOW);
    expect(next.learningStep).toBe(0);
    expect(next.stepStartedAt).toBe(NOW.getTime());
    expect(next.lastReview).toBeNull();
    expect(next.firstSeen).toBe(TODAY);
  });
});

describe("Case A1: brand-new card graded Again enters learning step", () => {
  it("sets learningStep=0 and firstSeen=today, leaves lastReview null", () => {
    const next = nextReview(newCard(), 1, NOW);
    expect(next.learningStep).toBe(0);
    expect(next.lastReview).toBeNull();
    expect(next.firstSeen).toBe(TODAY);
  });
});

describe("Case A1: brand-new card graded Hard enters learning step", () => {
  it("sets learningStep=0 and firstSeen=today, leaves lastReview null", () => {
    const next = nextReview(newCard(), 2, NOW);
    expect(next.learningStep).toBe(0);
    expect(next.lastReview).toBeNull();
  });
});

// ============================================================
// Case A2: brand-new card graded Easy graduates immediately
// ============================================================
describe("Case A2: brand-new card graded Easy", () => {
  it("graduates immediately with FSRS-initialised state and GRAD_INTERVAL_EASY", () => {
    const next = nextReview(newCard(), 5, NOW);
    expect(next.learningStep).toBeNull();
    expect(next.stepStartedAt).toBeNull();
    expect(next.lastReview).toBe(TODAY);
    expect(next.firstSeen).toBe(TODAY);
    expect(next.fsrsState).toBe("review");
    expect(next.scheduledDays).toBe(GRAD_INTERVAL_EASY);
    // FSRS sets stability and difficulty for the first successful review.
    expect(next.stability).toBeGreaterThan(0);
    expect(next.difficulty).toBeGreaterThanOrEqual(1);
    expect(next.difficulty).toBeLessThanOrEqual(10);
  });
});

// ============================================================
// Case A3: graduated card graded Again (lapse → relearning)
// ============================================================
describe("Case A3: graduated card graded Again (lapse)", () => {
  it("enters relearning step 0, sets lastReview=today, updates FSRS state", () => {
    const graduated = graduatedCard();
    const next = nextReview(graduated, 1, NOW);
    expect(next.learningStep).toBe(0);
    expect(next.stepStartedAt).toBe(NOW.getTime());
    expect(next.lastReview).toBe(TODAY);
    expect(next.dueDate).toBe(TODAY);
    expect(next.fsrsState).toBe("relearning");
    // FSRS records the lapse in stability/difficulty — values move, exact
    // numbers are FSRS-parameter-dependent so we only assert directionality.
    expect(next.stability).toBeLessThan(graduated.stability + 1);
    expect(next.difficulty).toBeGreaterThanOrEqual(graduated.difficulty);
  });
});

// ============================================================
// Case A4: graduated card + Hard / Good / Easy
// ============================================================
describe("Case A4: graduated card + Good", () => {
  it("advances reps, sets lastReview=today, stays graduated", () => {
    const graduated = graduatedCard();
    const next = nextReview(graduated, 4, NOW);
    expect(next.learningStep).toBeNull();
    expect(next.stepStartedAt).toBeNull();
    expect(next.lastReview).toBe(TODAY);
    expect(next.fsrsState).toBe("review");
    expect(next.reps).toBe(graduated.reps + 1);
    expect(next.scheduledDays).toBeGreaterThan(0);
  });
});

describe("Case A4: graduated card + Hard", () => {
  it("stays graduated, sets lastReview=today, may reduce scheduledDays", () => {
    const graduated = graduatedCard();
    const next = nextReview(graduated, 2, NOW);
    expect(next.learningStep).toBeNull();
    expect(next.stepStartedAt).toBeNull();
    expect(next.lastReview).toBe(TODAY);
    expect(next.fsrsState).toBe("review");
    expect(next.scheduledDays).toBeGreaterThan(0);
  });
});

describe("Case A4: graduated card + Easy", () => {
  it("stays graduated, sets lastReview=today, larger scheduledDays than Good", () => {
    const graduated = graduatedCard();
    const afterGood = nextReview(graduated, 4, NOW);
    const afterEasy = nextReview(graduated, 5, NOW);
    expect(afterEasy.scheduledDays).toBeGreaterThanOrEqual(afterGood.scheduledDays);
  });
});

// ============================================================
// Case B1: in-step Again → reset to step 0
// ============================================================
describe("Case B1: in-step Again resets to step 0", () => {
  it("resets learningStep to 0 when on step > 0", () => {
    const inStep = cardInStep(1);
    const next = nextReview(inStep, 1, NOW);
    expect(next.learningStep).toBe(0);
    expect(next.stepStartedAt).toBe(NOW.getTime());
  });

  it("stays on step 0 (no-op) when already there", () => {
    const inStep = cardInStep(0);
    const next = nextReview(inStep, 1, NOW);
    expect(next.learningStep).toBe(0);
  });
});

// ============================================================
// Case B2: in-step Hard → repeat current step
// ============================================================
describe("Case B2: in-step Hard repeats current step", () => {
  it("keeps learningStep unchanged and preserves stepStartedAt", () => {
    const inStep = cardInStep(1);
    const original = inStep.stepStartedAt;
    const next = nextReview(inStep, 2, NOW);
    expect(next.learningStep).toBe(1);
    expect(next.stepStartedAt).toBe(original);
  });
});

// ============================================================
// Case B3: in-step Good → advance step, or graduate at last step
// ============================================================
describe("Case B3: in-step Good advances step", () => {
  it("advances learningStep on a non-final step", () => {
    const inStep = cardInStep(0); // first of two new-card learning steps
    const next = nextReview(inStep, 4, NOW);
    expect(next.learningStep).toBe(1);
    expect(next.stepStartedAt).toBe(NOW.getTime());
  });

  it("graduates at the final new-card learning step", () => {
    const inStep = cardInStep(LEARNING_STEPS_MS.length - 1, null, { firstSeen: TODAY });
    const next = nextReview(inStep, 4, NOW);
    expect(next.learningStep).toBeNull();
    expect(next.stepStartedAt).toBeNull();
    expect(next.lastReview).toBe(TODAY);
    expect(next.scheduledDays).toBe(GRAD_INTERVAL_GOOD);
    expect(next.fsrsState).toBe("review");
  });

  it("graduates at the final relearning step (lastReview is preserved)", () => {
    const inStep = cardInStep(RELEARNING_STEPS_MS.length - 1, "2026-05-01");
    const next = nextReview(inStep, 4, NOW);
    expect(next.learningStep).toBeNull();
    expect(next.scheduledDays).toBe(GRAD_INTERVAL_GOOD);
    expect(next.lastReview).toBe(TODAY);
  });
});

// ============================================================
// Case B4: in-step Easy → graduate immediately
// ============================================================
describe("Case B4: in-step Easy graduates immediately", () => {
  it("graduates with GRAD_INTERVAL_EASY", () => {
    const inStep = cardInStep(0);
    const next = nextReview(inStep, 5, NOW);
    expect(next.learningStep).toBeNull();
    expect(next.stepStartedAt).toBeNull();
    expect(next.lastReview).toBe(TODAY);
    expect(next.scheduledDays).toBe(GRAD_INTERVAL_EASY);
    expect(next.fsrsState).toBe("review");
  });
});

// ============================================================
// FSRS state is frozen during in-step grading (B1, B2)
// ============================================================
describe("FSRS state is frozen during in-step Again/Hard", () => {
  it("stability and difficulty unchanged on in-step Again", () => {
    const inStep = cardInStep(1, "2026-05-01", { stability: 6, difficulty: 4 });
    const next = nextReview(inStep, 1, NOW);
    expect(next.stability).toBe(6);
    expect(next.difficulty).toBe(4);
  });

  it("stability and difficulty unchanged on in-step Hard", () => {
    const inStep = cardInStep(0, null, { stability: 0, difficulty: 0 });
    const next = nextReview(inStep, 2, NOW);
    expect(next.stability).toBe(0);
    expect(next.difficulty).toBe(0);
  });
});

// ============================================================
// Full scenarios
// ============================================================
describe("Full scenario: new card Good twice → graduates", () => {
  it("ends in fsrsState='review' with scheduledDays=GRAD_INTERVAL_GOOD", () => {
    let state: ReviewState = newCard();
    state = nextReview(state, 4, NOW); // learning step 0 → 1
    expect(state.learningStep).toBe(0);
    state = nextReview(state, 4, NOW); // step 1 → step 2 (graduate)
    expect(state.learningStep).toBe(1);
    state = nextReview(state, 4, NOW); // step 2 (no such step) → graduates
    expect(state.learningStep).toBeNull();
    expect(state.fsrsState).toBe("review");
    expect(state.scheduledDays).toBe(GRAD_INTERVAL_GOOD);
  });
});

describe("Full scenario: graduated → lapse → relearning Good → graduate", () => {
  it("returns to fsrsState='review' after relearning completes", () => {
    let state: ReviewState = graduatedCard();
    state = nextReview(state, 1, NOW); // lapse → relearning step 0
    expect(state.learningStep).toBe(0);
    expect(state.fsrsState).toBe("relearning");
    state = nextReview(state, 4, NOW); // good → graduate (single relearning step)
    expect(state.learningStep).toBeNull();
    expect(state.fsrsState).toBe("review");
    expect(state.scheduledDays).toBe(GRAD_INTERVAL_GOOD);
  });
});

// ============================================================
// firstSeen preservation
// ============================================================
describe("firstSeen preservation through graduation", () => {
  it("preserves firstSeen when a learning-step card graduates via Easy", () => {
    const inStep = cardInStep(0, null, { firstSeen: TODAY });
    const next = nextReview(inStep, 5, NOW);
    expect(next.firstSeen).toBe(TODAY);
  });

  it("preserves firstSeen when a learning-step card graduates via Good at the last step", () => {
    const inStep = cardInStep(LEARNING_STEPS_MS.length - 1, null, { firstSeen: TODAY });
    const next = nextReview(inStep, 4, NOW);
    expect(next.firstSeen).toBe(TODAY);
  });

  it("preserves firstSeen on graduated card paths (A3 lapse, A4 standard)", () => {
    const graduated = graduatedCard({ firstSeen: "2026-04-01" });
    const lapsed = nextReview(graduated, 1, NOW);
    const reviewed = nextReview(graduated, 4, NOW);
    expect(lapsed.firstSeen).toBe("2026-04-01");
    expect(reviewed.firstSeen).toBe("2026-04-01");
  });
});

// ============================================================
// stepStartedAt tracking
// ============================================================
describe("stepStartedAt tracking", () => {
  it("stamps stepStartedAt when entering a step (brand-new + Good)", () => {
    const next = nextReview(newCard(), 4, NOW);
    expect(next.stepStartedAt).toBe(NOW.getTime());
  });

  it("re-stamps stepStartedAt on B3 advance", () => {
    const inStep = cardInStep(0, null, { stepStartedAt: NOW.getTime() - 60_000 });
    const next = nextReview(inStep, 4, NOW);
    expect(next.stepStartedAt).toBe(NOW.getTime());
  });

  it("preserves stepStartedAt on B2 (Hard, no advance)", () => {
    const original = NOW.getTime() - 60_000;
    const inStep = cardInStep(0, null, { stepStartedAt: original });
    const next = nextReview(inStep, 2, NOW);
    expect(next.stepStartedAt).toBe(original);
  });

  it("nullifies stepStartedAt on graduation paths", () => {
    const inStep = cardInStep(0);
    const next = nextReview(inStep, 5, NOW);
    expect(next.stepStartedAt).toBeNull();
  });
});

// ============================================================
// Legacy migration via migrateReviewState
// ============================================================
describe("migrateReviewState: SM-2 → FSRS conversion", () => {
  it("converts a graduated SM-2 row to FSRS state and removes legacy fields", () => {
    const legacy: Record<string, unknown> = {
      repetitions: 2,
      interval: 6,
      easeFactor: 2.5,
      dueDate: "2026-05-10",
      lastReview: "2026-05-04",
      firstSeen: "2026-05-04",
    };
    migrateReviewState(legacy);
    expect(legacy.stability).toBe(6);
    expect(legacy.scheduledDays).toBe(6);
    expect(legacy.reps).toBe(2);
    expect(legacy.lapses).toBe(0);
    expect(legacy.fsrsState).toBe("review");
    // SM-2 fields are removed
    expect(legacy.repetitions).toBeUndefined();
    expect(legacy.interval).toBeUndefined();
    expect(legacy.easeFactor).toBeUndefined();
  });

  it("converts a brand-new SM-2 row to fsrsState='new' with zeroed FSRS fields", () => {
    const legacy: Record<string, unknown> = {
      repetitions: 0,
      interval: 0,
      easeFactor: 2.5,
      dueDate: "2026-05-08",
      lastReview: null,
      firstSeen: null,
    };
    migrateReviewState(legacy);
    expect(legacy.fsrsState).toBe("new");
    expect(legacy.stability).toBe(0);
    expect(legacy.reps).toBe(0);
  });

  it("is a no-op on already-FSRS state (stability present)", () => {
    const state: Record<string, unknown> = {
      stability: 5,
      difficulty: 3,
      reps: 1,
      lapses: 0,
      fsrsState: "review",
      learningStep: null,
      stepStartedAt: null,
      firstSeen: "2026-05-01",
      lastReview: "2026-05-04",
      dueDate: "2026-05-09",
    };
    migrateReviewState(state);
    expect(state.stability).toBe(5);
    expect(state.difficulty).toBe(3);
  });

  it("backfills learningStep and firstSeen on a pre-firstSeen legacy card", () => {
    const legacy: Record<string, unknown> = {
      repetitions: 1,
      interval: 6,
      easeFactor: 2.5,
      dueDate: "2026-05-10",
      lastReview: "2026-05-04",
    };
    migrateReviewState(legacy);
    expect(legacy.firstSeen).toBe("2026-05-04");
    expect(legacy.learningStep).toBeNull();
    expect(legacy.fsrsState).toBe("review");
  });

  it("does not overwrite an existing learningStep value", () => {
    const state: Record<string, unknown> = { learningStep: 0 };
    migrateReviewState(state);
    expect(state.learningStep).toBe(0);
  });
});

// ============================================================
// Retention target threading
// ============================================================
describe("retentionTarget option", () => {
  it("0.97 schedules sooner than 0.85 for the same Good grade on a graduated card", () => {
    const base = graduatedCard();
    const low = nextReview(base, 4, NOW, { retentionTarget: 0.85 });
    const high = nextReview(base, 4, NOW, { retentionTarget: 0.97 });
    expect(high.scheduledDays).toBeLessThan(low.scheduledDays);
  });

  it("omitting retentionTarget behaves identically to the FSRS default 0.9", () => {
    const base = graduatedCard();
    const omitted = nextReview(base, 4, NOW);
    const explicit = nextReview(base, 4, NOW, { retentionTarget: 0.9 });
    expect(explicit.scheduledDays).toBe(omitted.scheduledDays);
  });
});
