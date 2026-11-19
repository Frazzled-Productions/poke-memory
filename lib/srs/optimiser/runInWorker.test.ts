import { describe, expect, it } from "vitest";
import {
  isOptimiserSupported,
  OptimiserError,
  OPTIMISER_WORKER_URL,
  runOptimiserInWorker,
} from "./runInWorker";
import type { OptimiserRequest, OptimiserResponse } from "./protocol";

class FakeWorker {
  onmessage: ((event: MessageEvent<OptimiserResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: OptimiserRequest[] = [];
  terminated = false;
  postMessage(request: OptimiserRequest) {
    this.posted.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  reply(message: OptimiserResponse) {
    this.onmessage?.({ data: message } as MessageEvent<OptimiserResponse>);
  }
}

const ITEMS = [{ reviews: [{ rating: 3 as const, deltaT: 0 }, { rating: 3 as const, deltaT: 1 }] }];

function start(onProgress?: (current: number, total: number) => void) {
  const worker = new FakeWorker();
  const promise = runOptimiserInWorker(ITEMS, {
    onProgress,
    createWorker: () => worker as unknown as Worker,
  });
  return { worker, promise };
}

describe("runOptimiserInWorker", () => {
  it("posts a run request and resolves with the weights, then terminates", async () => {
    const progress: number[][] = [];
    const { worker, promise } = start((c, t) => progress.push([c, t]));
    expect(worker.posted).toEqual([{ type: "run", items: ITEMS }]);
    worker.reply({ type: "progress", current: 5, total: 10 });
    worker.reply({ type: "done", weights: [1, 2] });
    await expect(promise).resolves.toEqual([1, 2]);
    expect(progress).toEqual([[5, 10]]);
    expect(worker.terminated).toBe(true);
  });

  it("rejects with the worker's reason on an error message", async () => {
    const { worker, promise } = start();
    worker.reply({ type: "error", reason: "not_enough_data", detail: "NotEnoughData" });
    await expect(promise).rejects.toMatchObject({
      name: "OptimiserError",
      reason: "not_enough_data",
      message: "NotEnoughData",
    });
    expect(worker.terminated).toBe(true);
  });

  it("rejects as failed when the worker script errors", async () => {
    const { worker, promise } = start();
    worker.onerror?.({ message: "" } as ErrorEvent);
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OptimiserError);
    expect(err).toMatchObject({ reason: "failed", message: "worker failed to start" });
  });

  it("starts a module worker from the static asset path by default", () => {
    expect(OPTIMISER_WORKER_URL).toBe("/fsrs/optimiser-worker.js");
  });
});

describe("isOptimiserSupported", () => {
  const supported = {
    crossOriginIsolated: true,
    SharedArrayBuffer: function SharedArrayBuffer() {},
    WebAssembly: {},
    Worker: function Worker() {},
  };
  const check = (scope: object) => isOptimiserSupported(scope as typeof globalThis);

  it("is true on a cross-origin-isolated page with threads and workers", () => {
    expect(check(supported)).toBe(true);
  });

  it("is false without cross-origin isolation", () => {
    expect(check({ ...supported, crossOriginIsolated: false })).toBe(false);
    expect(check({ ...supported, crossOriginIsolated: undefined })).toBe(false);
  });

  it("is false without SharedArrayBuffer, WebAssembly or Worker", () => {
    expect(check({ ...supported, SharedArrayBuffer: undefined })).toBe(false);
    expect(check({ ...supported, WebAssembly: undefined })).toBe(false);
    expect(check({ ...supported, Worker: undefined })).toBe(false);
  });
});
