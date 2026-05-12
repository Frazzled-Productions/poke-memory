import { describe, it, expect } from "vitest";
import {
  learningStepsFor,
  relearningStepsFor,
  LEARNING_STEPS_MS,
  RELEARNING_STEPS_MS,
} from "./constants";

describe("learningStepsFor", () => {
  it("difficulty 0 (brand-new) falls into the medium band", () => {
    expect(learningStepsFor(0)).toEqual(LEARNING_STEPS_MS);
  });

  it("easy band (≤4) graduates after a single 1m step", () => {
    expect(learningStepsFor(1)).toEqual([60_000]);
    expect(learningStepsFor(4)).toEqual([60_000]);
  });

  it("medium band (5..7) matches the existing default", () => {
    expect(learningStepsFor(5)).toEqual(LEARNING_STEPS_MS);
    expect(learningStepsFor(7)).toEqual(LEARNING_STEPS_MS);
  });

  it("hard band (≥8) has three steps", () => {
    expect(learningStepsFor(8)).toEqual([60_000, 300_000, 900_000]);
    expect(learningStepsFor(10)).toEqual([60_000, 300_000, 900_000]);
  });
});

describe("relearningStepsFor", () => {
  it("difficulty ≤ 7 returns the default single-step ladder", () => {
    expect(relearningStepsFor(0)).toEqual(RELEARNING_STEPS_MS);
    expect(relearningStepsFor(7)).toEqual(RELEARNING_STEPS_MS);
  });

  it("difficulty ≥ 8 returns a two-step relearning ladder", () => {
    expect(relearningStepsFor(8)).toEqual([300_000, 900_000]);
    expect(relearningStepsFor(10)).toEqual([300_000, 900_000]);
  });
});
