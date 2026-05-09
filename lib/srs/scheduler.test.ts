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

// Helper: a graduated card (has been reviewed at least once).
function graduatedCard(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    repetitions: 2,
    interval: 6,
    easeFactor: 2.5,
    dueDate: TODAY,
    lastReview: "2026-05-02",
    firstSeen: "2026-04-26",
    learningStep: null,
    stepStartedAt: null,
    ...overrides,
  };
}

// Helper: a brand-new card (never graded).
function newCard(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    ...initialReviewState(NOW),
    ...overrides,
  };
}

// Helper: a card in a learning or relearning step.
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
  it("includes learningStep: null", () => {
    const state = initialReviewState(NOW);
    expect(state.learningStep).toBeNull();
    expect(state.lastReview).toBeNull();
    expect(state.firstSeen).toBeNull();
  });
});

// ============================================================
// Case A1: Brand-new card graded Good → enter learning step 0
// ============================================================
describe("Case A1: brand-new card graded Good", () => {
  const state = newCard();
  const result = nextReview(state, 4, NOW);

  it("enters learningStep 0", () => {
    expect(result.learningStep).toBe(0);
  });

  it("lastReview stays null (not yet graduated)", () => {
    expect(result.lastReview).toBeNull();
  });

  it("firstSeen is set to today", () => {
    expect(result.firstSeen).toBe(TODAY);
  });

  it("easeFactor is unchanged", () => {
    expect(result.easeFactor).toBe(state.easeFactor);
  });
});

// ============================================================
// Case A1: Brand-new card graded Again → enter learning step 0
// ============================================================
describe("Case A1: brand-new card graded Again", () => {
  const state = newCard();
  const result = nextReview(state, 1, NOW);

  it("enters learningStep 0", () => {
    expect(result.learningStep).toBe(0);
  });

  it("lastReview stays null", () => {
    expect(result.lastReview).toBeNull();
  });

  it("firstSeen is set to today", () => {
    expect(result.firstSeen).toBe(TODAY);
  });
});

// ============================================================
// Case A1: Brand-new card graded Hard → enter learning step 0
// ============================================================
describe("Case A1: brand-new card graded Hard", () => {
  const state = newCard();
  const result = nextReview(state, 2, NOW);

  it("enters learningStep 0", () => {
    expect(result.learningStep).toBe(0);
  });

  it("lastReview stays null", () => {
    expect(result.lastReview).toBeNull();
  });
});

// ============================================================
// Case A2: Brand-new card graded Easy → graduate immediately
// ============================================================
describe("Case A2: brand-new card graded Easy", () => {
  const state = newCard();
  const result = nextReview(state, 5, NOW);

  it("learningStep is null (graduated)", () => {
    expect(result.learningStep).toBeNull();
  });

  it("repetitions = 1", () => {
    expect(result.repetitions).toBe(1);
  });

  it("interval = GRAD_INTERVAL_EASY (4 days)", () => {
    expect(result.interval).toBe(GRAD_INTERVAL_EASY);
  });

  it("dueDate is 4 days from now", () => {
    expect(result.dueDate).toBe("2026-05-12");
  });

  it("lastReview = today", () => {
    expect(result.lastReview).toBe(TODAY);
  });

  it("firstSeen = today", () => {
    expect(result.firstSeen).toBe(TODAY);
  });
});

// ============================================================
// Case A3: Graduated card graded Again → lapse
// ============================================================
describe("Case A3: graduated card graded Again (lapse)", () => {
  const state = graduatedCard({ easeFactor: 2.5 });
  const result = nextReview(state, 1, NOW);

  it("enters learningStep 0 (relearning)", () => {
    expect(result.learningStep).toBe(0);
  });

  it("repetitions reset to 0", () => {
    expect(result.repetitions).toBe(0);
  });

  it("interval = 1", () => {
    expect(result.interval).toBe(1);
  });

  it("easeFactor is penalised (EF decreased)", () => {
    // EF' = max(1.3, 2.5 + 0.1 - (5-1)*(0.08 + (5-1)*0.02))
    //      = max(1.3, 2.5 + 0.1 - 4*(0.08 + 0.08))
    //      = max(1.3, 2.5 + 0.1 - 4*0.16)
    //      = max(1.3, 2.5 + 0.1 - 0.64) = max(1.3, 1.96)
    expect(result.easeFactor).toBeCloseTo(1.96, 5);
    expect(result.easeFactor).toBeLessThan(state.easeFactor);
  });

  it("dueDate = today (stays in today's queue)", () => {
    expect(result.dueDate).toBe(TODAY);
  });

  it("lastReview = today", () => {
    expect(result.lastReview).toBe(TODAY);
  });

  it("firstSeen is preserved (not today)", () => {
    expect(result.firstSeen).toBe("2026-04-26");
  });
});

// ============================================================
// Case B1: In-step Again → reset to step 0
// ============================================================
describe("Case B1: in-step Again resets to step 0", () => {
  it("from step 1 back to step 0", () => {
    const state = cardInStep(1);
    const result = nextReview(state, 1, NOW);
    expect(result.learningStep).toBe(0);
    // Other fields unchanged
    expect(result.lastReview).toBe(state.lastReview);
    expect(result.easeFactor).toBe(state.easeFactor);
  });

  it("from step 0 stays at step 0", () => {
    const state = cardInStep(0);
    const result = nextReview(state, 1, NOW);
    expect(result.learningStep).toBe(0);
  });
});

// ============================================================
// Case B2: In-step Hard → repeat current step
// ============================================================
describe("Case B2: in-step Hard repeats current step", () => {
  it("learningStep unchanged", () => {
    const state = cardInStep(0);
    const result = nextReview(state, 2, NOW);
    expect(result.learningStep).toBe(0);
    expect(result.lastReview).toBe(state.lastReview);
    expect(result.easeFactor).toBe(state.easeFactor);
  });
});

// ============================================================
// Case B3: In-step Good → advance or graduate
// ============================================================
describe("Case B3: in-step Good advances step", () => {
  it("new-card step 0 → step 1 (not yet graduated; 2 total steps)", () => {
    const state = cardInStep(0, null); // new-card learning, lastReview null
    const result = nextReview(state, 4, NOW);
    expect(result.learningStep).toBe(1);
    expect(result.lastReview).toBeNull(); // still not graduated
  });

  it("new-card step 1 (final step) → graduate with interval=1", () => {
    const state = cardInStep(1, null); // step 1 of 2
    const result = nextReview(state, 4, NOW);
    expect(result.learningStep).toBeNull();
    expect(result.repetitions).toBe(1);
    expect(result.interval).toBe(GRAD_INTERVAL_GOOD);
    expect(result.dueDate).toBe("2026-05-09"); // +1 day
    expect(result.lastReview).toBe(TODAY);
  });

  it("relearning step 0 (final step) → graduate with interval=1", () => {
    const state = cardInStep(0, "2026-05-01"); // lastReview set = relearning
    const result = nextReview(state, 4, NOW);
    expect(result.learningStep).toBeNull();
    expect(result.repetitions).toBe(1);
    expect(result.interval).toBe(GRAD_INTERVAL_GOOD);
    expect(result.lastReview).toBe(TODAY);
  });
});

// ============================================================
// Case B4: In-step Easy → graduate immediately
// ============================================================
describe("Case B4: in-step Easy graduates immediately", () => {
  it("from step 0 (new-card learning)", () => {
    const state = cardInStep(0, null);
    const result = nextReview(state, 5, NOW);
    expect(result.learningStep).toBeNull();
    expect(result.repetitions).toBe(1);
    expect(result.interval).toBe(GRAD_INTERVAL_EASY);
    expect(result.dueDate).toBe("2026-05-12"); // +4 days
    expect(result.lastReview).toBe(TODAY);
  });

  it("from step 0 (relearning)", () => {
    const state = cardInStep(0, "2026-05-01");
    const result = nextReview(state, 5, NOW);
    expect(result.learningStep).toBeNull();
    expect(result.interval).toBe(GRAD_INTERVAL_EASY);
  });
});

// ============================================================
// EF frozen during in-step grading
// ============================================================
describe("EF is frozen during in-step grading", () => {
  it("Again in step does not change EF", () => {
    const state = cardInStep(0);
    const ef = state.easeFactor;
    expect(nextReview(state, 1, NOW).easeFactor).toBe(ef);
  });

  it("Hard in step does not change EF", () => {
    const state = cardInStep(0);
    const ef = state.easeFactor;
    expect(nextReview(state, 2, NOW).easeFactor).toBe(ef);
  });

  it("Good in step does not change EF", () => {
    const state = cardInStep(0);
    const ef = state.easeFactor;
    expect(nextReview(state, 4, NOW).easeFactor).toBe(ef);
  });

  it("Easy in step does not change EF", () => {
    const state = cardInStep(0);
    const ef = state.easeFactor;
    expect(nextReview(state, 5, NOW).easeFactor).toBe(ef);
  });
});

// ============================================================
// Full scenario: new card Good → Good → graduate
// ============================================================
describe("Full scenario: new card Good twice → graduates with interval=1", () => {
  it("step 0 → step 1 → graduated", () => {
    const initial = newCard();

    const after1 = nextReview(initial, 4, NOW); // enter step 0
    expect(after1.learningStep).toBe(0);
    expect(after1.lastReview).toBeNull();

    const after2 = nextReview(after1, 4, NOW); // advance to step 1
    expect(after2.learningStep).toBe(1);
    expect(after2.lastReview).toBeNull();

    const after3 = nextReview(after2, 4, NOW); // graduate
    expect(after3.learningStep).toBeNull();
    expect(after3.repetitions).toBe(1);
    expect(after3.interval).toBe(1);
    expect(after3.lastReview).toBe(TODAY);
  });
});

// ============================================================
// Full scenario: graduated → Again (lapse) → relearning Good → graduate
// ============================================================
describe("Full scenario: graduated → lapse → relearning Good → graduate", () => {
  it("lapse → relearning step 0 → graduate with interval=1", () => {
    const graduated = graduatedCard();

    const lapsed = nextReview(graduated, 1, NOW); // lapse
    expect(lapsed.learningStep).toBe(0);
    expect(lapsed.lastReview).toBe(TODAY);
    expect(lapsed.repetitions).toBe(0);

    const relearned = nextReview(lapsed, 4, NOW); // only 1 relearning step
    expect(relearned.learningStep).toBeNull();
    expect(relearned.repetitions).toBe(1);
    expect(relearned.interval).toBe(GRAD_INTERVAL_GOOD);
    expect(relearned.lastReview).toBe(TODAY);
  });
});

// ============================================================
// Migration: legacy state without learningStep field
// ============================================================
describe("migration of legacy state (no learningStep field)", () => {
  it("backfills learningStep: null via migrateReviewState", () => {
    const legacyState: Record<string, unknown> = {
      repetitions: 1,
      interval: 6,
      easeFactor: 2.5,
      dueDate: "2026-05-10",
      lastReview: "2026-05-04",
      firstSeen: "2026-05-04",
      // learningStep is absent
    };

    migrateReviewState(legacyState);

    expect(legacyState.learningStep).toBeNull();
  });

  it("does not overwrite an existing learningStep value", () => {
    const state: Record<string, unknown> = {
      learningStep: 0,
    };

    migrateReviewState(state);

    expect(state.learningStep).toBe(0); // preserved
  });

  it("backfills firstSeen from lastReview on a pre-firstSeen legacy card", () => {
    const legacyState: Record<string, unknown> = {
      repetitions: 1,
      interval: 6,
      easeFactor: 2.5,
      dueDate: "2026-05-10",
      lastReview: "2026-05-04",
      // firstSeen and learningStep both absent (oldest legacy shape)
    };

    migrateReviewState(legacyState);

    expect(legacyState.firstSeen).toBe("2026-05-04");
    expect(legacyState.learningStep).toBeNull();
  });
});

// ============================================================
// Graduated card + Hard (A4 path, soft fail)
// ============================================================
describe("Case A4: graduated card + Hard", () => {
  it("resets repetitions and interval but does NOT enter relearning", () => {
    const graduated = graduatedCard();

    const next = nextReview(graduated, 2, NOW);

    expect(next.learningStep).toBeNull(); // stays graduated, no relearning step
    expect(next.repetitions).toBe(0);
    expect(next.interval).toBe(1);
    expect(next.lastReview).toBe(TODAY);
    // EF is penalised (this is the graduated path, not in-step)
    expect(next.easeFactor).toBeLessThan(graduated.easeFactor);
    expect(next.easeFactor).toBeGreaterThanOrEqual(1.3);
  });
});

// ============================================================
// firstSeen preservation through graduation paths
// ============================================================
describe("firstSeen preservation through graduation", () => {
  it("preserves firstSeen when a learning-step card graduates via Easy", () => {
    const inStep = cardInStep(0, null, { firstSeen: TODAY });

    const next = nextReview(inStep, 5, NOW);

    expect(next.learningStep).toBeNull();
    expect(next.firstSeen).toBe(TODAY); // preserved unchanged
  });

  it("preserves firstSeen when a learning-step card graduates via Good", () => {
    const inStep = cardInStep(1, null, { firstSeen: TODAY }); // last new-card step

    const next = nextReview(inStep, 4, NOW);

    expect(next.learningStep).toBeNull();
    expect(next.firstSeen).toBe(TODAY); // preserved unchanged
  });
});

// ============================================================
// stepStartedAt: set on step entry, null on graduation
// ============================================================
describe('stepStartedAt tracking', () => {
  it('A1: brand-new Good → enter step 0 sets stepStartedAt to now.getTime()', () => {
    const state = newCard();
    const result = nextReview(state, 4, NOW);
    expect(result.stepStartedAt).toBe(NOW.getTime());
  });

  it('A1: brand-new Again → enter step 0 sets stepStartedAt', () => {
    const state = newCard();
    const result = nextReview(state, 1, NOW);
    expect(result.stepStartedAt).toBe(NOW.getTime());
  });

  it('A1: brand-new Hard → enter step 0 sets stepStartedAt', () => {
    const state = newCard();
    const result = nextReview(state, 2, NOW);
    expect(result.stepStartedAt).toBe(NOW.getTime());
  });

  it('A2: brand-new Easy → graduate immediately → stepStartedAt null', () => {
    const state = newCard();
    const result = nextReview(state, 5, NOW);
    expect(result.stepStartedAt).toBeNull();
  });

  it('A3: graduated + Again (lapse) → relearning step 0 → stepStartedAt set', () => {
    const state = graduatedCard();
    const result = nextReview(state, 1, NOW);
    expect(result.stepStartedAt).toBe(NOW.getTime());
  });

  it('A4 Hard: graduated + Hard → stays graduated → stepStartedAt null', () => {
    const state = graduatedCard();
    const result = nextReview(state, 2, NOW);
    expect(result.stepStartedAt).toBeNull();
  });

  it('A4 Good/Easy: graduated + Good → stays graduated → stepStartedAt null', () => {
    const state = graduatedCard();
    const result = nextReview(state, 4, NOW);
    expect(result.stepStartedAt).toBeNull();
  });

  it('B1: in-step Again → reset to step 0 → stepStartedAt updated to now', () => {
    const state = cardInStep(1, null, { stepStartedAt: NOW.getTime() - 30000 });
    const result = nextReview(state, 1, NOW);
    expect(result.learningStep).toBe(0);
    expect(result.stepStartedAt).toBe(NOW.getTime());
  });

  it('B2: in-step Hard → repeat step → stepStartedAt preserved', () => {
    const original = NOW.getTime() - 30000;
    const state = cardInStep(0, null, { stepStartedAt: original });
    const result = nextReview(state, 2, NOW);
    expect(result.learningStep).toBe(0);
    expect(result.stepStartedAt).toBe(original); // unchanged
  });

  it('B3 advance: in-step Good → advance → stepStartedAt updated to now', () => {
    const state = cardInStep(0, null, { stepStartedAt: NOW.getTime() - 60000 });
    const result = nextReview(state, 4, NOW);
    expect(result.learningStep).toBe(1);
    expect(result.stepStartedAt).toBe(NOW.getTime());
  });

  it('B3 graduate: in-step Good at final step → graduate → stepStartedAt null', () => {
    const state = cardInStep(1, null, { stepStartedAt: NOW.getTime() - 60000 });
    const result = nextReview(state, 4, NOW);
    expect(result.learningStep).toBeNull();
    expect(result.stepStartedAt).toBeNull();
  });

  it('B4: in-step Easy → graduate → stepStartedAt null', () => {
    const state = cardInStep(0, null, { stepStartedAt: NOW.getTime() - 30000 });
    const result = nextReview(state, 5, NOW);
    expect(result.learningStep).toBeNull();
    expect(result.stepStartedAt).toBeNull();
  });

  it('initialReviewState includes stepStartedAt: null', () => {
    const state = initialReviewState(NOW);
    expect(state.stepStartedAt).toBeNull();
  });
});

// ============================================================
// Migration 3: stepStartedAt backfill
// ============================================================
describe('migration of legacy state (no stepStartedAt field)', () => {
  it('backfills stepStartedAt: null via migrateReviewState', () => {
    const legacyState: Record<string, unknown> = {
      repetitions: 1,
      interval: 6,
      easeFactor: 2.5,
      dueDate: '2026-05-10',
      lastReview: '2026-05-04',
      firstSeen: '2026-05-04',
      learningStep: null,
      // stepStartedAt absent
    };
    migrateReviewState(legacyState);
    expect(legacyState.stepStartedAt).toBeNull();
  });

  it('does not overwrite an existing stepStartedAt value', () => {
    const state: Record<string, unknown> = {
      stepStartedAt: 1234567890,
    };
    migrateReviewState(state);
    expect(state.stepStartedAt).toBe(1234567890);
  });
});
