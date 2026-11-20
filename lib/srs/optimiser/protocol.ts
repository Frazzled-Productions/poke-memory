/**
 * Message protocol between the optimiser page and its Web Worker (D7 of the
 * move to Cloudflare). Pure: no DOM, no wasm. The worker entry wires
 * `createOptimiserHandler` to the real binding and `postMessage`; tests wire
 * it to fakes or to the binding loaded in Node.
 */

import type { OptimizerInputItem } from "@/lib/srs/optimizer";

/** Page to worker: fit FSRS weights to these items. */
export type OptimiserRequest = { type: "run"; items: OptimizerInputItem[] };

/** Worker to page. */
export type OptimiserResponse =
  | { type: "progress"; current: number; total: number }
  | { type: "done"; weights: number[] }
  | { type: "error"; reason: OptimiserErrorReason; detail: string };

/**
 * `not_enough_data`: the binding rejected the review distribution
 * (NotEnoughData), so the learner should keep studying. `failed`: anything else.
 */
export type OptimiserErrorReason = "not_enough_data" | "failed";

/** The slice of the FSRS binding the optimiser uses. */
export type FsrsBinding = {
  FSRSBindingReview: new (rating: number, deltaT: number) => unknown;
  FSRSBindingItem: new (reviews: unknown[]) => unknown;
  computeParameters: (
    items: unknown[],
    options: {
      enableShortTerm: boolean;
      progress?: (current: number, total: number) => void;
    },
  ) => Promise<number[]>;
};

/** FSRS-6 has 21 weights; anything else means the binding misbehaved. */
export const FSRS_WEIGHT_COUNT = 21;

/** Short, non-identifying detail string for an unknown thrown value. */
export function errorDetail(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return raw.slice(0, 200) || "internal_error";
}

export function createOptimiserHandler(
  loadBinding: () => Promise<FsrsBinding>,
  post: (message: OptimiserResponse) => void,
): (request: OptimiserRequest) => Promise<void> {
  return async (request) => {
    if (request?.type !== "run") return;
    try {
      const binding = await loadBinding();
      const items = request.items.map(
        (item) =>
          new binding.FSRSBindingItem(
            item.reviews.map((r) => new binding.FSRSBindingReview(r.rating, r.deltaT)),
          ),
      );
      // The binding reports progress very often; forward whole-percent steps.
      let lastPercent = -1;
      const weights = await binding.computeParameters(items, {
        enableShortTerm: true,
        progress: (current, total) => {
          const percent = total > 0 ? Math.floor((current / total) * 100) : 0;
          if (percent === lastPercent) return;
          lastPercent = percent;
          post({ type: "progress", current, total });
        },
      });
      if (weights.length !== FSRS_WEIGHT_COUNT || !weights.every(Number.isFinite)) {
        post({ type: "error", reason: "failed", detail: `unexpected weights (${weights.length})` });
        return;
      }
      post({ type: "done", weights });
    } catch (err) {
      const detail = errorDetail(err);
      post({
        type: "error",
        reason: detail.includes("NotEnoughData") ? "not_enough_data" : "failed",
        detail,
      });
    }
  };
}
