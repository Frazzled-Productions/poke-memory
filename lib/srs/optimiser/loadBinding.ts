/**
 * Browser loader for the FSRS binding's wasm32-wasi build, run inside the
 * optimiser Web Worker. A port of the binding's own browser loader
 * (`fsrs-binding.wasi-browser.js` in @open-spaced-repetition/binding-wasm32-wasi
 * 0.5.0, MIT) that takes its wasm and thread-worker URLs relative to this
 * worker's script, so all three files are served from `public/fsrs/`.
 *
 * Threads need a shared WebAssembly.Memory, so the page must be
 * cross-origin isolated (COOP same-origin + COEP require-corp, next.config.ts).
 */

import {
  getDefaultContext,
  instantiateNapiModuleSync,
  WASI,
} from "@napi-rs/wasm-runtime";
import type { FsrsBinding } from "./protocol";

/** File names under `public/fsrs/`, written by scripts/build-fsrs-optimiser.mjs. */
export const FSRS_WASM_FILE = "fsrs-binding.wasm32-wasi.wasm";
export const FSRS_THREAD_FILE = "wasi-thread.js";

let bindingPromise: Promise<FsrsBinding> | null = null;

export function loadFsrsBinding(baseUrl: string = self.location.href): Promise<FsrsBinding> {
  bindingPromise ??= instantiate(baseUrl).catch((err) => {
    bindingPromise = null;
    throw err;
  });
  return bindingPromise;
}

async function instantiate(baseUrl: string): Promise<FsrsBinding> {
  const response = await fetch(new URL(FSRS_WASM_FILE, baseUrl));
  if (!response.ok) throw new Error(`wasm fetch failed (${response.status})`);
  const wasm = await response.arrayBuffer();
  const threadUrl = new URL(FSRS_THREAD_FILE, baseUrl);
  const memory = new WebAssembly.Memory({ initial: 4000, maximum: 65536, shared: true });
  const { napiModule } = instantiateNapiModuleSync(wasm, {
    context: getDefaultContext(),
    asyncWorkPoolSize: 4,
    wasi: new WASI({ version: "preview1" }),
    onCreateWorker: () => new Worker(threadUrl, { type: "module" }),
    overwriteImports(importObject) {
      importObject.env = {
        ...importObject.env,
        ...importObject.napi,
        ...importObject.emnapi,
        memory,
      };
      return importObject;
    },
    beforeInit({ instance }) {
      for (const name of Object.keys(instance.exports)) {
        if (name.startsWith("__napi_register__")) {
          (instance.exports[name] as () => void)();
        }
      }
    },
  });
  return napiModule.exports as unknown as FsrsBinding;
}
