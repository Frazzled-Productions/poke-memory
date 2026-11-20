/**
 * Optimiser Web Worker entry, bundled to `public/fsrs/optimiser-worker.js` by
 * scripts/build-fsrs-optimiser.mjs. Receives an `OptimiserRequest`, fits FSRS
 * weights with the wasm binding and posts `OptimiserResponse` messages back.
 */

import { createOptimiserHandler, type OptimiserRequest } from "./protocol";
import { loadFsrsBinding } from "./loadBinding";

const handle = createOptimiserHandler(
  () => loadFsrsBinding(),
  (message) => self.postMessage(message),
);

self.onmessage = (event: MessageEvent<OptimiserRequest>) => {
  // A dedicated worker hears only its page, whose messages carry an empty
  // origin; anything naming another origin is not ours.
  if (event.origin !== "" && event.origin !== self.location.origin) return;
  void handle(event.data);
};
