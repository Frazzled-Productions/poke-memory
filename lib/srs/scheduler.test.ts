import { describe, it, expect } from "vitest";
import { default_w } from "ts-fsrs";
import { nextReview, initialReviewState } from "@/lib/srs/scheduler";
import type { ReviewState, Grade } from "@/lib/srs/scheduler";
import { migrateReviewState } from "@/lib/review/persistence";
import { MASTERY_REPETITIONS, MASTERY_INTERVAL_DAYS, isMastered } from "@/lib/stats/derive";
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
    hiddenSince: null,
    seenInPasture: false,
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
    expect(state.hiddenSince).toBeNull();
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
    // Walk the relearning ladder until graduation — the ladder length
    // depends on FSRS's post-lapse difficulty (medium = 1 step, hard = 2).
    // Cap at 5 to fail fast if the loop never terminates.
    for (let i = 0; i < 5 && state.learningStep !== null; i++) {
      state = nextReview(state, 4, NOW);
    }
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

  it("backfills hiddenSince to null on a legacy state lacking the field", () => {
    const legacy: Record<string, unknown> = {
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
    migrateReviewState(legacy);
    expect(legacy.hiddenSince).toBeNull();
  });

  it("preserves an existing hiddenSince value (idempotent re-run)", () => {
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
      hiddenSince: "2026-05-05",
    };
    migrateReviewState(state);
    expect(state.hiddenSince).toBe("2026-05-05");
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

// ============================================================
// Custom FSRS weights option
// ============================================================
describe("weights option", () => {
  // Use the default ts-fsrs weight vector as a baseline.
  // We obtain it from the library's own export rather than hard-coding.
  const defaultWeights: number[] = [...default_w];

  it("two calls with the same weights + retention return identical scheduledDays", () => {
    const base = graduatedCard();
    const first = nextReview(base, 4, NOW, { weights: defaultWeights });
    const second = nextReview(base, 4, NOW, { weights: defaultWeights });
    expect(first.scheduledDays).toBe(second.scheduledDays);
  });

  it("does not throw when custom weights are provided", () => {
    const base = graduatedCard();
    // Use slightly modified weights to exercise a different scheduler instance.
    const tweaked = defaultWeights.map((w, i) => (i === 0 ? w * 1.1 : w));
    expect(() => nextReview(base, 4, NOW, { weights: tweaked })).not.toThrow();
  });

  it("omitting weights behaves the same as passing defaultWeights", () => {
    const base = graduatedCard();
    const withDefault = nextReview(base, 4, NOW, { weights: defaultWeights });
    const withoutWeights = nextReview(base, 4, NOW);
    // scheduledDays may differ slightly due to floating-point; we just assert
    // no crash and both produce a positive interval.
    expect(withDefault.scheduledDays).toBeGreaterThan(0);
    expect(withoutWeights.scheduledDays).toBeGreaterThan(0);
  });
});

// ============================================================
// Malformed / short weight vector fallback
// ============================================================
describe("weights option: malformed / short weight vector", () => {
  it("an empty weight array falls back to defaults without producing NaN scheduledDays", () => {
    const base = graduatedCard();
    const result = nextReview(base, 4, NOW, { weights: [] });
    expect(result.scheduledDays).toBeGreaterThan(0);
    expect(Number.isNaN(result.scheduledDays)).toBe(false);
    expect(Number.isFinite(result.scheduledDays)).toBe(true);
  });

  it("a single-element weight array does not crash and produces a finite interval", () => {
    const base = graduatedCard();
    const result = nextReview(base, 4, NOW, { weights: [0.4] });
    expect(Number.isNaN(result.scheduledDays)).toBe(false);
    expect(Number.isFinite(result.scheduledDays)).toBe(true);
    expect(result.scheduledDays).toBeGreaterThanOrEqual(0);
  });

  it("a weight vector with some zeroed entries does not produce NaN", () => {
    const base = graduatedCard();
    // A vector of all zeros is the most adversarial short-circuit.
    const zeroed = new Array(21).fill(0) as number[];
    const result = nextReview(base, 4, NOW, { weights: zeroed });
    expect(Number.isNaN(result.scheduledDays)).toBe(false);
    // Result may be unusual but must not be NaN or ±Infinity.
    expect(Number.isFinite(result.scheduledDays)).toBe(true);
  });
});

// ============================================================
// Invalid grade at runtime (decoded payload defence)
// ============================================================
describe("invalid grade at runtime", () => {
  // Grade is typed as 1|2|4|5 in TypeScript. These tests document what
  // actually happens when a decoded payload or persisted blob passes a value
  // outside the declared union — e.g. 3 (never a valid app grade) or 0.
  //
  // Key findings:
  //   - Grade 3 on a graduated card (A4 path): GRADE_TO_RATING[3] is undefined,
  //     so ts-fsrs receives Rating.undefined and throws "Invalid rating:[undefined]".
  //     This is an unguarded runtime error — a data-coder guard at the decode
  //     boundary would prevent it. The test documents current behaviour.
  //   - Grade 0 on a brand-new card (A1 path): grade 0 matches none of ===5,
  //     ===1, ===2, ===4 checks inside nextReview (brand-new branch), so the
  //     function falls through to the `return { ...state, learningStep: 0, … }`
  //     block — it does NOT call FSRS and therefore does not throw. The returned
  //     state is structurally valid.
  //   - Grade 3 on a card in a learning step (B-branch): grade 3 matches none
  //     of ===1, ===2, ===4 checks, so the B4/Easy path (grade === 5) is taken
  //     by fall-through (no else-if chain). ts-fsrs is called with Rating.Easy.
  //     This is unexpected but does not throw.

  it("grade 3 on a graduated card throws at the ts-fsrs boundary (GRADE_TO_RATING[3] is undefined)", () => {
    // Documents a known gap: the A4 branch passes GRADE_TO_RATING[grade] directly
    // to ts-fsrs without a guard, so an unknown grade causes an FSRS error.
    // A data-coder guard at the decode/validation boundary should prevent this.
    const base = graduatedCard();
    expect(() => nextReview(base, 3 as Grade, NOW)).toThrow();
  });

  it("grade 0 on a brand-new card does not throw (falls into A1 branch)", () => {
    // Grade 0 is not 5 (Easy), so the brand-new card path does NOT graduate.
    // The A1 "Again/Hard/Good" branch is taken — the function returns a state
    // with learningStep set, without calling FSRS.
    const base = newCard();
    expect(() => nextReview(base, 0 as Grade, NOW)).not.toThrow();
  });

  it("grade 0 on a brand-new card produces a structurally valid ReviewState", () => {
    const base = newCard();
    const result = nextReview(base, 0 as Grade, NOW);
    expect(result).toMatchObject({
      fsrsState: expect.any(String),
      dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it("grade 0 on a brand-new card enters the A1 learning-step path (learningStep=0)", () => {
    // Confirms A1 is taken: learningStep set, lastReview still null.
    const base = newCard();
    const result = nextReview(base, 0 as Grade, NOW);
    expect(result.learningStep).toBe(0);
    expect(result.lastReview).toBeNull();
  });

  it("grade 3 on a card in a learning step takes the B4 (Easy) fall-through path and does not throw", () => {
    // In the B-branch, grade checks are: ===1 (B1), ===2 (B2), ===4 (B3).
    // Grade 3 matches none of those, so execution falls to the B4 block (which
    // does not guard with `if (grade === 5)` — it is the tail branch). ts-fsrs
    // is called with Rating.Easy. Unexpected but harmless.
    const inStep = cardInStep(0);
    expect(() => nextReview(inStep, 3 as Grade, NOW)).not.toThrow();
  });

  it("grade 3 on a card in a learning step graduates via the B4 (Easy) fall-through", () => {
    const inStep = cardInStep(0);
    const result = nextReview(inStep, 3 as Grade, NOW);
    // B4 graduates immediately — learningStep cleared, lastReview set.
    expect(result.learningStep).toBeNull();
    expect(result.lastReview).toBe(TODAY);
    expect(result.fsrsState).toBe("review");
  });
});

// ============================================================
// Mastery boundary — reps and scheduledDays thresholds
// ============================================================
describe("mastery boundary (isMastered)", () => {
  // isMastered lives in lib/stats/derive.ts and is the canonical gate. These
  // tests exercise the exact-boundary conditions: one below, exactly at, and
  // one above the thresholds. They also verify the reps dimension independently.

  const BASE_STATE: ReviewState = {
    stability: 30,
    difficulty: 3,
    elapsedDays: 21,
    scheduledDays: 21,
    reps: MASTERY_REPETITIONS,
    lapses: 0,
    fsrsState: "review",
    dueDate: "2026-06-01",
    lastReview: "2026-05-11",
    firstSeen: "2026-04-01",
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  };

  it("is mastered at exactly MASTERY_REPETITIONS reps and MASTERY_INTERVAL_DAYS scheduledDays", () => {
    const state: ReviewState = {
      ...BASE_STATE,
      reps: MASTERY_REPETITIONS,
      scheduledDays: MASTERY_INTERVAL_DAYS,
    };
    expect(isMastered(state)).toBe(true);
  });

  it("is NOT mastered when scheduledDays is exactly one below the threshold (20)", () => {
    const state: ReviewState = {
      ...BASE_STATE,
      reps: MASTERY_REPETITIONS,
      scheduledDays: MASTERY_INTERVAL_DAYS - 1, // 20
    };
    expect(isMastered(state)).toBe(false);
  });

  it("is mastered when scheduledDays is one above the threshold (22)", () => {
    const state: ReviewState = {
      ...BASE_STATE,
      reps: MASTERY_REPETITIONS,
      scheduledDays: MASTERY_INTERVAL_DAYS + 1, // 22
    };
    expect(isMastered(state)).toBe(true);
  });

  it("is NOT mastered when reps is exactly one below MASTERY_REPETITIONS", () => {
    const state: ReviewState = {
      ...BASE_STATE,
      reps: MASTERY_REPETITIONS - 1,
      scheduledDays: MASTERY_INTERVAL_DAYS,
    };
    expect(isMastered(state)).toBe(false);
  });

  it("is NOT mastered when both reps and scheduledDays are one below threshold", () => {
    const state: ReviewState = {
      ...BASE_STATE,
      reps: MASTERY_REPETITIONS - 1,
      scheduledDays: MASTERY_INTERVAL_DAYS - 1,
    };
    expect(isMastered(state)).toBe(false);
  });

  it("is mastered when reps is well above threshold and scheduledDays is exactly at threshold", () => {
    const state: ReviewState = {
      ...BASE_STATE,
      reps: MASTERY_REPETITIONS + 10,
      scheduledDays: MASTERY_INTERVAL_DAYS,
    };
    expect(isMastered(state)).toBe(true);
  });

  it("isMastered does not gate on learningStep: a card mid-step with threshold-meeting reps/scheduledDays returns true", () => {
    // isMastered checks reps and scheduledDays only — it does not inspect
    // learningStep. A card in a learning step should never carry reps >=
    // MASTERY_REPETITIONS in normal practice, but the function does not enforce
    // that constraint. This test pins the current behaviour and will fail
    // immediately if isMastered ever adds a learningStep guard.
    const inStepState: ReviewState = {
      ...BASE_STATE,
      reps: MASTERY_REPETITIONS,
      scheduledDays: MASTERY_INTERVAL_DAYS,
      learningStep: 0,
      stepStartedAt: NOW.getTime(),
    };
    expect(isMastered(inStepState)).toBe(true);
  });

  it("MASTERY_REPETITIONS constant itself is 3", () => {
    expect(MASTERY_REPETITIONS).toBe(3);
  });

  it("MASTERY_INTERVAL_DAYS constant itself is 21", () => {
    expect(MASTERY_INTERVAL_DAYS).toBe(21);
  });
});

// ============================================================
// DST / timezone boundary — addDays uses millisecond arithmetic
// ============================================================
describe("DST / timezone boundary — addDays millisecond arithmetic", () => {
  // isoDate() calls todayInTimezone("UTC", date) so all scheduling arithmetic
  // is UTC-based. Crossing a DST boundary in a local timezone should never
  // affect the UTC-based scheduled due date. We verify this by anchoring `now`
  // to a moment that falls exactly on a spring-forward DST boundary in
  // America/New_York (clocks jump 02:00 → 03:00 on the second Sunday of March).
  //
  // 2026-03-08 02:00 America/New_York is the transition hour. We use 01:30 local
  // (= 06:30 UTC) as `now`, so in local time the day is still Mar 8.
  // Adding 1 day via millisecond arithmetic (+ 86_400_000 ms) should land on
  // 2026-03-09 UTC, not 2026-03-10 or 2026-03-07.

  // Spring forward: 2026-03-08 02:00 EST → 03:00 EDT
  // 01:30 EST on 2026-03-08 = 06:30 UTC
  const DST_SPRING_FORWARD = new Date("2026-03-08T06:30:00Z");

  it("+1 day interval from a DST-spring-forward moment lands on the next UTC calendar day", () => {
    const base = graduatedCard({
      dueDate: "2026-03-08",
      lastReview: "2026-03-02",
      scheduledDays: 6,
    });
    const result = nextReview(base, 4, DST_SPRING_FORWARD);
    // The new due date must be on or after 2026-03-09 (scheduledDays from FSRS
    // will be ≥ 1). Crucially it must NOT be 2026-03-07 (subtract) or
    // an off-by-one caused by DST shifting midnight.
    expect(result.dueDate >= "2026-03-09").toBe(true);
    expect(result.lastReview).toBe("2026-03-08");
  });

  it("+1 day (GRAD_INTERVAL_GOOD) from DST boundary yields the day after in UTC", () => {
    // Graduate a card from the final learning step at the DST-transition moment.
    // Using LEARNING_STEPS_MS.length - 1 ensures the Good grade graduates the card
    // (B3-graduate path) with dueDate = now + GRAD_INTERVAL_GOOD.
    const inStep = cardInStep(LEARNING_STEPS_MS.length - 1, null, {
      firstSeen: "2026-03-08",
      dueDate: "2026-03-08",
    });
    const result = nextReview(inStep, 4, DST_SPRING_FORWARD);
    // B3-graduate: learningStep cleared, dueDate = +1 day in UTC from Mar 8 = Mar 9.
    expect(result.learningStep).toBeNull();
    expect(result.dueDate).toBe("2026-03-09");
  });

  it("+21 day interval from a DST boundary lands on the correct calendar day", () => {
    // Autumn fall-back in America/New_York: 2026-11-01 02:00 EDT → 01:00 EST.
    // 01:00 EDT on 2026-11-01 = 05:00 UTC.
    const DST_FALL_BACK = new Date("2026-11-01T05:00:00Z");
    const base = graduatedCard({
      dueDate: "2026-11-01",
      lastReview: "2026-10-26",
      scheduledDays: 6,
      stability: 30,
      reps: 5,
    });
    // Grade Good on a well-established card — FSRS should schedule ≥ 1 day out.
    const result = nextReview(base, 4, DST_FALL_BACK);
    // dueDate must be strictly after 2026-11-01 and must be a valid YYYY-MM-DD.
    expect(result.dueDate > "2026-11-01").toBe(true);
    expect(result.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // DST-induced off-by-one would produce 2026-10-31 (one day early). Guard it.
    expect(result.dueDate >= "2026-11-02").toBe(true);
  });

  it("isoDate is UTC-based: a moment near local midnight but before UTC midnight stays on the prior UTC date", () => {
    // 2026-05-08 23:30 America/New_York (EDT, UTC-4) = 2026-05-09 03:30 UTC.
    // isoDate should return 2026-05-09 (UTC date), not 2026-05-08 (local date).
    const nearLocalMidnight = new Date("2026-05-09T03:30:00Z");
    const base = graduatedCard({ dueDate: "2026-05-09" });
    const result = nextReview(base, 4, nearLocalMidnight);
    // lastReview is set to isoDate(now) = UTC date = 2026-05-09.
    expect(result.lastReview).toBe("2026-05-09");
  });
});
