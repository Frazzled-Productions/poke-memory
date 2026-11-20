import { describe, expect, it, vi } from "vitest";
import {
  createOptimiserHandler,
  errorDetail,
  FSRS_WEIGHT_COUNT,
  type FsrsBinding,
  type OptimiserResponse,
} from "./protocol";

const WEIGHTS = Array.from({ length: FSRS_WEIGHT_COUNT }, (_, i) => i / 10);

function fakeBinding(compute: FsrsBinding["computeParameters"]): FsrsBinding {
  return {
    FSRSBindingReview: class {
      constructor(
        readonly rating: number,
        readonly deltaT: number,
      ) {}
    },
    FSRSBindingItem: class {
      constructor(readonly reviews: unknown[]) {}
    },
    computeParameters: compute,
  };
}

async function run(binding: FsrsBinding | Error, request: unknown = {
  type: "run",
  items: [{ reviews: [{ rating: 3, deltaT: 0 }, { rating: 4, deltaT: 2 }] }],
}) {
  const messages: OptimiserResponse[] = [];
  const handle = createOptimiserHandler(
    async () => {
      if (binding instanceof Error) throw binding;
      return binding;
    },
    (m) => messages.push(m),
  );
  await handle(request as Parameters<typeof handle>[0]);
  return messages;
}

describe("createOptimiserHandler", () => {
  it("converts items to binding objects and posts done with the weights", async () => {
    const compute = vi.fn(async () => WEIGHTS);
    const messages = await run(fakeBinding(compute));
    expect(messages).toEqual([{ type: "done", weights: WEIGHTS }]);
    const [items, options] = compute.mock.calls[0] as unknown as [
      { reviews: { rating: number; deltaT: number }[] }[],
      { enableShortTerm: boolean },
    ];
    expect(items[0].reviews.map((r) => [r.rating, r.deltaT])).toEqual([[3, 0], [4, 2]]);
    expect(options.enableShortTerm).toBe(true);
  });

  it("forwards progress once per whole percent", async () => {
    const messages = await run(
      fakeBinding(async (_items, options) => {
        for (const current of [0, 1, 2, 50, 51, 100]) options.progress?.(current, 200);
        return WEIGHTS;
      }),
    );
    expect(messages.filter((m) => m.type === "progress")).toEqual([
      { type: "progress", current: 0, total: 200 },
      { type: "progress", current: 2, total: 200 },
      { type: "progress", current: 50, total: 200 },
      { type: "progress", current: 100, total: 200 },
    ]);
  });

  it("maps a NotEnoughData failure to not_enough_data", async () => {
    const messages = await run(
      fakeBinding(async () => {
        throw new Error("compute_parameters failed: NotEnoughData");
      }),
    );
    expect(messages).toEqual([
      {
        type: "error",
        reason: "not_enough_data",
        detail: "compute_parameters failed: NotEnoughData",
      },
    ]);
  });

  it("maps any other failure, including a failed wasm load, to failed", async () => {
    expect(await run(new Error("wasm fetch failed (404)"))).toEqual([
      { type: "error", reason: "failed", detail: "wasm fetch failed (404)" },
    ]);
  });

  it("rejects a weight vector of the wrong length", async () => {
    const messages = await run(fakeBinding(async () => [1, 2, 3]));
    expect(messages).toEqual([
      { type: "error", reason: "failed", detail: "unexpected weights (3)" },
    ]);
  });

  it("ignores messages that are not run requests", async () => {
    const compute = vi.fn(async () => WEIGHTS);
    expect(await run(fakeBinding(compute), { type: "other" })).toEqual([]);
    expect(compute).not.toHaveBeenCalled();
  });
});

describe("errorDetail", () => {
  it("truncates messages and falls back for empty values", () => {
    expect(errorDetail(new Error("x".repeat(300)))).toHaveLength(200);
    expect(errorDetail("plain")).toBe("plain");
    expect(errorDetail(undefined)).toBe("internal_error");
  });
});
