import { describe, it, expect } from "vitest";
import { previewIntervals } from "./intervalPreview";
import { ReviewState } from "@/lib/srs/scheduler";

const NOW = new Date("2026-05-12T12:00:00Z");

function makeState(overrides: Partial<ReviewState>): ReviewState {
  return {
    repetitions: 0,
    interval: 0,
    easeFactor: 2.5,
    dueDate: "2026-05-12",
    lastReview: null,
    firstSeen: null,
    learningStep: null,
    stepStartedAt: null,
    ...overrides,
  };
}

describe("previewIntervals", () => {
  describe("brand-new card (learningStep: null, lastReview: null)", () => {
    const state = makeState({});

    it("Grade 1 (Again) → <1m", () => {
      expect(previewIntervals(state, NOW)[1]).toBe("<1m");
    });

    it("Grade 2 (Hard) → <1m", () => {
      expect(previewIntervals(state, NOW)[2]).toBe("<1m");
    });

    it("Grade 4 (Good) → <1m", () => {
      expect(previewIntervals(state, NOW)[4]).toBe("<1m");
    });

    it("Grade 5 (Easy) → 4d", () => {
      expect(previewIntervals(state, NOW)[5]).toBe("4d");
    });
  });

  describe("in-step-0 new card (learningStep: 0, stepStartedAt: NOW, lastReview: null)", () => {
    const state = makeState({
      learningStep: 0,
      stepStartedAt: NOW.getTime(),
    });

    it("Grade 1 (Again) → <1m", () => {
      expect(previewIntervals(state, NOW)[1]).toBe("<1m");
    });

    it("Grade 2 (Hard) → <1m (repeats step 0, LEARNING_STEPS_MS[0] = 60_000 → 1 min)", () => {
      expect(previewIntervals(state, NOW)[2]).toBe("<1m");
    });

    it("Grade 4 (Good) → <10m (advances to step 1)", () => {
      expect(previewIntervals(state, NOW)[4]).toBe("<10m");
    });

    it("Grade 5 (Easy) → 4d (graduates)", () => {
      expect(previewIntervals(state, NOW)[5]).toBe("4d");
    });
  });

  describe("in-step-1 new card (learningStep: 1, stepStartedAt: NOW, lastReview: null)", () => {
    const state = makeState({
      learningStep: 1,
      stepStartedAt: NOW.getTime(),
    });

    it("Grade 1 (Again) → <1m (resets to step 0)", () => {
      expect(previewIntervals(state, NOW)[1]).toBe("<1m");
    });

    it("Grade 2 (Hard) → <10m (repeats step 1, LEARNING_STEPS_MS[1] = 600_000 → 10 min)", () => {
      expect(previewIntervals(state, NOW)[2]).toBe("<10m");
    });

    it("Grade 4 (Good) → 1d (graduates — step 1 is the last new-card step)", () => {
      expect(previewIntervals(state, NOW)[4]).toBe("1d");
    });

    it("Grade 5 (Easy) → 4d", () => {
      expect(previewIntervals(state, NOW)[5]).toBe("4d");
    });
  });

  describe("relearning step-0 (learningStep: 0, stepStartedAt: NOW, lastReview set)", () => {
    const state = makeState({
      learningStep: 0,
      stepStartedAt: NOW.getTime(),
      lastReview: "2026-05-12",
      firstSeen: "2026-05-01",
      repetitions: 0,
      interval: 1,
    });

    it("Grade 1 (Again) → <10m (resets to step 0, RELEARNING_STEPS_MS[0] = 600_000)", () => {
      expect(previewIntervals(state, NOW)[1]).toBe("<10m");
    });

    it("Grade 2 (Hard) → <10m (repeats step 0 via RELEARNING_STEPS_MS, preserves stepStartedAt)", () => {
      expect(previewIntervals(state, NOW)[2]).toBe("<10m");
    });

    it("Grade 4 (Good) → 1d (graduates from relearning)", () => {
      expect(previewIntervals(state, NOW)[4]).toBe("1d");
    });

    it("Grade 5 (Easy) → 4d", () => {
      expect(previewIntervals(state, NOW)[5]).toBe("4d");
    });
  });

  describe("graduated card (repetitions: 2, interval: 6)", () => {
    const state = makeState({
      repetitions: 2,
      interval: 6,
      easeFactor: 2.5,
      lastReview: "2026-05-07",
      firstSeen: "2026-05-01",
      learningStep: null,
      stepStartedAt: null,
    });

    it("Grade 1 (Again) → <10m (lapse → relearning step 0)", () => {
      expect(previewIntervals(state, NOW)[1]).toBe("<10m");
    });

    it("Grade 2 (Hard) → 1d (A4 Hard: SM-2 hard reschedule, interval=1)", () => {
      expect(previewIntervals(state, NOW)[2]).toBe("1d");
    });

    it("Grade 4 (Good) → 15d (rep 3, interval = floor(6 * 2.5))", () => {
      expect(previewIntervals(state, NOW)[4]).toBe("15d");
    });

    it("Grade 5 (Easy) → 15d (rep 3, interval = floor(6 * 2.6))", () => {
      expect(previewIntervals(state, NOW)[5]).toBe("15d");
    });
  });
});
