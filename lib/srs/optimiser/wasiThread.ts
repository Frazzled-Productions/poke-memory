/**
 * Thread worker for the FSRS wasm binding, bundled to `public/fsrs/wasi-thread.js`.
 * A port of `wasi-worker-browser.mjs` from
 * @open-spaced-repetition/binding-wasm32-wasi 0.5.0 (MIT): each Rust thread
 * the binding spawns runs in one of these, sharing the wasm memory.
 */

import { instantiateNapiModuleSync, MessageHandler, WASI } from "@napi-rs/wasm-runtime";

const handler = new MessageHandler({
  onLoad({ wasmModule, wasmMemory }) {
    return instantiateNapiModuleSync(wasmModule, {
      childThread: true,
      wasi: new WASI({ version: "preview1" }),
      overwriteImports(importObject) {
        importObject.env = {
          ...importObject.env,
          ...importObject.napi,
          ...importObject.emnapi,
          memory: wasmMemory,
        };
        return importObject;
      },
    });
  },
  onError(error) {
    self.postMessage({ type: "error", error });
  },
});

self.onmessage = (event: MessageEvent) => {
  // A dedicated worker hears only the worker that spawned it, whose messages
  // carry an empty origin; anything naming another origin is not ours.
  if (event.origin !== "" && event.origin !== self.location.origin) return;
  handler.handle(event);
};
