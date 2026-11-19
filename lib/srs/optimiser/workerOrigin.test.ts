/**
 * The optimiser's two dedicated Web Workers ignore a message that carries
 * another origin (CodeQL js/missing-origin-check). A dedicated worker hears
 * only its parent page, whose messages arrive with an empty origin, so real
 * messages always pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handled = vi.hoisted(() => ({ optimiser: vi.fn(), thread: vi.fn() }));

vi.mock("./protocol", () => ({ createOptimiserHandler: () => handled.optimiser }));
vi.mock("./loadBinding", () => ({ loadFsrsBinding: vi.fn() }));
vi.mock("@napi-rs/wasm-runtime", () => ({
  instantiateNapiModuleSync: vi.fn(),
  WASI: vi.fn(),
  MessageHandler: class {
    handle = handled.thread;
  },
}));

type WorkerScope = { location: { origin: string }; postMessage: () => void; onmessage?: (event: unknown) => void };
let scope: WorkerScope;

beforeEach(() => {
  vi.resetModules();
  handled.optimiser.mockClear();
  handled.thread.mockClear();
  scope = { location: { origin: "https://pokememory.com" }, postMessage: vi.fn() };
  vi.stubGlobal("self", scope);
});
afterEach(() => vi.unstubAllGlobals());

describe.each([
  ["optimiser worker", "./worker", () => handled.optimiser],
  ["wasi thread worker", "./wasiThread", () => handled.thread],
] as const)("%s", (_name, entry, spy) => {
  it("handles a message from its parent (empty origin) and from its own origin", async () => {
    await import(entry);
    scope.onmessage?.({ origin: "", data: { type: "run", items: [] } });
    scope.onmessage?.({ origin: "https://pokememory.com", data: { type: "run", items: [] } });
    expect(spy()).toHaveBeenCalledTimes(2);
  });

  it("ignores a message from another origin", async () => {
    await import(entry);
    scope.onmessage?.({ origin: "https://evil.example", data: { type: "run", items: [] } });
    expect(spy()).not.toHaveBeenCalled();
  });
});
