/**
 * Main-thread side of the optimiser: feature detection and a promise wrapper
 * around the Web Worker in `public/fsrs/optimiser-worker.js`.
 */

import type { OptimizerInputItem } from "@/lib/srs/optimizer";
import type { OptimiserErrorReason, OptimiserRequest, OptimiserResponse } from "./protocol";

export const OPTIMISER_WORKER_URL = "/fsrs/optimiser-worker.js";

/**
 * The wasm binding runs Rust threads on a shared WebAssembly.Memory, which
 * browsers only allow on cross-origin-isolated pages with SharedArrayBuffer.
 */
export function isOptimiserSupported(scope: typeof globalThis = globalThis): boolean {
  return (
    scope.crossOriginIsolated === true &&
    typeof scope.SharedArrayBuffer === "function" &&
    typeof scope.WebAssembly === "object" &&
    typeof scope.Worker === "function"
  );
}

export class OptimiserError extends Error {
  constructor(
    readonly reason: OptimiserErrorReason,
    detail: string,
  ) {
    super(detail);
    this.name = "OptimiserError";
  }
}

type RunOptions = {
  onProgress?: (current: number, total: number) => void;
  createWorker?: () => Worker;
};

export function runOptimiserInWorker(
  items: OptimizerInputItem[],
  {
    onProgress,
    createWorker = () => new Worker(OPTIMISER_WORKER_URL, { type: "module" }),
  }: RunOptions = {},
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    const finish = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<OptimiserResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        onProgress?.(message.current, message.total);
      } else if (message.type === "done") {
        finish();
        resolve(message.weights);
      } else if (message.type === "error") {
        finish();
        reject(new OptimiserError(message.reason, message.detail));
      }
    };
    worker.onerror = (event: ErrorEvent) => {
      finish();
      reject(new OptimiserError("failed", event.message || "worker failed to start"));
    };
    const request: OptimiserRequest = { type: "run", items };
    worker.postMessage(request);
  });
}
