/**
 * End-to-end fit of the optimiser input against the real FSRS binding (#2392).
 *
 * Builds items from a realistic synthetic grade log through
 * `gradeLogToOptimizerItems` and runs them through the optimiser worker's
 * message handler with the vendored wasm32-wasi binding, loaded in Node: the
 * same wasm the /settings/optimiser page runs. With one item per card this
 * returned NotEnoughData; with one item per review prefix it returns weights.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { gradeLogToOptimizerItems } from "./optimizer";
import { syntheticGradeLog } from "./syntheticGradeLog";
import {
  createOptimiserHandler,
  FSRS_WEIGHT_COUNT,
  type FsrsBinding,
  type OptimiserResponse,
} from "./optimiser/protocol";

const binding = createRequire(import.meta.url)(
  "../../vendor/fsrs-binding-wasm32-wasi/fsrs-binding.wasi.cjs",
) as FsrsBinding;

describe("optimiser fit on a synthetic grade log (#2392)", () => {
  it("returns FSRS weights rather than NotEnoughData", async () => {
    const items = gradeLogToOptimizerItems(syntheticGradeLog({ days: 60, newPerDay: 8 }));
    const messages: OptimiserResponse[] = [];
    await createOptimiserHandler(async () => binding, (m) => messages.push(m))({
      type: "run",
      items,
    });
    const last = messages[messages.length - 1];
    expect(last.type).toBe("done");
    const weights = last.type === "done" ? last.weights : [];
    expect(weights).toHaveLength(FSRS_WEIGHT_COUNT);
    expect(weights.every(Number.isFinite)).toBe(true);
  }, 60_000);

  it("reports not_enough_data for one item per card, the pre-#2392 shape", async () => {
    // Collapse the prefixes back to the longest item per card.
    const items = gradeLogToOptimizerItems(syntheticGradeLog({ days: 60, newPerDay: 8 }));
    const perCard = items.filter(
      (item, i) => i === items.length - 1 || items[i + 1].reviews.length <= item.reviews.length,
    );
    const messages: OptimiserResponse[] = [];
    await createOptimiserHandler(async () => binding, (m) => messages.push(m))({
      type: "run",
      items: perCard,
    });
    expect(messages[messages.length - 1]).toMatchObject({
      type: "error",
      reason: "not_enough_data",
    });
  }, 60_000);
});
