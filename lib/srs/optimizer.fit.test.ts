/**
 * End-to-end fit of the optimiser input against the real FSRS binding (#2392).
 *
 * Builds items from a realistic synthetic grade log through
 * `gradeLogToOptimizerItems` and runs `computeParameters`. With one item per
 * card this returned NotEnoughData; with one item per review prefix it returns
 * a full weight vector.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { gradeLogToOptimizerItems } from "./optimizer";
import { syntheticGradeLog } from "./syntheticGradeLog";

type Binding = typeof import("@open-spaced-repetition/binding");
const binding = createRequire(import.meta.url)("@open-spaced-repetition/binding") as Binding;

describe("optimiser fit on a synthetic grade log (#2392)", () => {
  it("returns FSRS weights rather than NotEnoughData", async () => {
    const items = gradeLogToOptimizerItems(syntheticGradeLog({ days: 60, newPerDay: 8 }));
    const weights = await binding.computeParameters(
      items.map(
        (item) =>
          new binding.FSRSBindingItem(
            item.reviews.map((r) => new binding.FSRSBindingReview(r.rating, r.deltaT)),
          ),
      ),
      { enableShortTerm: true },
    );
    expect(weights).toHaveLength(21);
    expect(weights.every(Number.isFinite)).toBe(true);
  }, 60_000);
});
