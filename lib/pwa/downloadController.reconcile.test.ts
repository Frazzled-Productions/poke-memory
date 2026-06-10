/**
 * Unit tests for reconcileWithStorage() in downloadController.ts.
 *
 * These test the three cases required by the #1845 gap fix:
 *   (a) manifest "done" + IDB empty → resets to idle + clears manifest keys
 *   (b) manifest "done" + IDB has entries → stays done, no reset
 *   (c) IDB unavailable/throws → no reset (state preserved)
 *
 * The test file lives in lib/pwa/ so the "node" vitest project picks it up.
 * fake-indexeddb is provided by vitest.setup.node.ts.
 *
 * Module-mock strategy: `downloadController.ts` uses a static import for
 * `offlineCount`. To intercept calls in a fresh module instance (after
 * vi.resetModules()), we use vi.doMock on "./offlineStore" BEFORE the dynamic
 * import of "./downloadController" in each test, so the freshly-loaded module
 * receives the mocked version. vi.doMock is hoisted within the current
 * describe scope only, not at the file level.
 *
 * localStorage / window are stubbed so `seedFromStorage()` can read the keys
 * it needs (readLocalStorage uses window.localStorage, which requires `window`
 * to be defined in the node env).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// localStorage / window stub
// ---------------------------------------------------------------------------

function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { store.set(k, String(v)); },
  };
}

/**
 * Stub `window` and `localStorage` so readLocalStorage() works in the node
 * project (it uses window.localStorage, which requires window to be defined).
 * Returns the stubbed localStorage instance.
 */
function stubWindowWithLocalStorage(): Storage {
  const ls = makeLocalStorage();
  vi.stubGlobal("window", { localStorage: ls });
  vi.stubGlobal("localStorage", ls);
  return ls;
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Shared helpers (called inside each test after vi.resetModules + vi.doMock)
// ---------------------------------------------------------------------------

/**
 * Seed the controller singleton to "done" by writing the expected localStorage
 * keys to the stubbed window.localStorage, then calling getState() to trigger
 * seedFromStorage().
 *
 * Must be called after stubWindowWithLocalStorage() is active.
 */
async function seedDoneState(): Promise<void> {
  const { OFFLINE_DOWNLOADED_AT_KEY } = await import("./precache");
  const { KEY_OFFLINE_MANIFEST } = await import("@/lib/storage/keys");
  globalThis.window.localStorage.setItem(OFFLINE_DOWNLOADED_AT_KEY, "2026-06-01T10:00:00.000Z");
  globalThis.window.localStorage.setItem(KEY_OFFLINE_MANIFEST, JSON.stringify({ signature: "abc123", count: 100 }));
  const { getState } = await import("./downloadController");
  // Trigger seedFromStorage() which reads window.localStorage.
  getState();
}

// ---------------------------------------------------------------------------
// (a) manifest "done" + IDB empty → resets to idle + clears manifest keys
// ---------------------------------------------------------------------------

describe("reconcileWithStorage - case (a): done + IDB empty → idle", () => {
  beforeEach(() => {
    vi.resetModules();
    stubWindowWithLocalStorage();
    // Mock offlineStore BEFORE downloadController is imported in each test.
    vi.doMock("./offlineStore", async () => {
      const actual = await vi.importActual<typeof import("./offlineStore")>("./offlineStore");
      return { ...actual, offlineCount: vi.fn().mockResolvedValue(0) };
    });
  });

  afterEach(async () => {
    const { _resetForTesting } = await import("./downloadController");
    _resetForTesting();
    vi.doUnmock("./offlineStore");
  });

  it("resets to idle and clears localStorage when IDB is empty", async () => {
    await seedDoneState();

    const { getState, reconcileWithStorage } = await import("./downloadController");
    expect(getState().phase).toBe("done");

    await reconcileWithStorage();

    expect(getState().phase).toBe("idle");

    const { OFFLINE_DOWNLOADED_AT_KEY } = await import("./precache");
    const { KEY_OFFLINE_MANIFEST } = await import("@/lib/storage/keys");
    expect(globalThis.window.localStorage.getItem(OFFLINE_DOWNLOADED_AT_KEY)).toBeNull();
    expect(globalThis.window.localStorage.getItem(KEY_OFFLINE_MANIFEST)).toBeNull();
  });

  it("notifies subscribers when resetting to idle", async () => {
    await seedDoneState();

    const { subscribe, reconcileWithStorage } = await import("./downloadController");

    const states: string[] = [];
    // subscribe() immediately calls the listener with the current state ("done").
    const unsub = subscribe((s) => states.push(s.phase));

    await reconcileWithStorage();
    unsub();

    // Should have received "done" (from immediate subscribe call) then "idle".
    expect(states).toEqual(["done", "idle"]);
  });
});

// ---------------------------------------------------------------------------
// (b) manifest "done" + IDB has entries → stays done, no reset
// ---------------------------------------------------------------------------

describe("reconcileWithStorage - case (b): done + IDB has entries → stays done", () => {
  beforeEach(() => {
    vi.resetModules();
    stubWindowWithLocalStorage();
    vi.doMock("./offlineStore", async () => {
      const actual = await vi.importActual<typeof import("./offlineStore")>("./offlineStore");
      return { ...actual, offlineCount: vi.fn().mockResolvedValue(1025) };
    });
  });

  afterEach(async () => {
    const { _resetForTesting } = await import("./downloadController");
    _resetForTesting();
    vi.doUnmock("./offlineStore");
  });

  it("leaves state as done when IDB has entries", async () => {
    await seedDoneState();

    const { getState, reconcileWithStorage } = await import("./downloadController");
    expect(getState().phase).toBe("done");

    await reconcileWithStorage();

    expect(getState().phase).toBe("done");
  });

  it("does not touch localStorage when IDB has entries", async () => {
    await seedDoneState();

    const { reconcileWithStorage } = await import("./downloadController");

    const { OFFLINE_DOWNLOADED_AT_KEY } = await import("./precache");
    const { KEY_OFFLINE_MANIFEST } = await import("@/lib/storage/keys");

    const atBefore = globalThis.window.localStorage.getItem(OFFLINE_DOWNLOADED_AT_KEY);
    const manifestBefore = globalThis.window.localStorage.getItem(KEY_OFFLINE_MANIFEST);

    await reconcileWithStorage();

    expect(globalThis.window.localStorage.getItem(OFFLINE_DOWNLOADED_AT_KEY)).toBe(atBefore);
    expect(globalThis.window.localStorage.getItem(KEY_OFFLINE_MANIFEST)).toBe(manifestBefore);
  });
});

// ---------------------------------------------------------------------------
// (c) IDB unavailable/throws → no reset (state preserved)
// ---------------------------------------------------------------------------

describe("reconcileWithStorage - case (c): IDB throws → state preserved", () => {
  beforeEach(() => {
    vi.resetModules();
    stubWindowWithLocalStorage();
    vi.doMock("./offlineStore", async () => {
      const actual = await vi.importActual<typeof import("./offlineStore")>("./offlineStore");
      return {
        ...actual,
        offlineCount: vi.fn().mockRejectedValue(new Error("[offline-store] IDB unavailable")),
      };
    });
  });

  afterEach(async () => {
    const { _resetForTesting } = await import("./downloadController");
    _resetForTesting();
    vi.doUnmock("./offlineStore");
  });

  it("preserves done state when offlineCount throws", async () => {
    await seedDoneState();

    const { getState, reconcileWithStorage } = await import("./downloadController");
    expect(getState().phase).toBe("done");

    await reconcileWithStorage();

    // State must remain "done" - never reset on a transient IDB error.
    expect(getState().phase).toBe("done");
  });

  it("preserves localStorage keys when offlineCount throws", async () => {
    await seedDoneState();

    const { reconcileWithStorage } = await import("./downloadController");

    const { OFFLINE_DOWNLOADED_AT_KEY } = await import("./precache");
    const { KEY_OFFLINE_MANIFEST } = await import("@/lib/storage/keys");

    const atBefore = globalThis.window.localStorage.getItem(OFFLINE_DOWNLOADED_AT_KEY);

    await reconcileWithStorage();

    expect(globalThis.window.localStorage.getItem(OFFLINE_DOWNLOADED_AT_KEY)).toBe(atBefore);
    expect(globalThis.window.localStorage.getItem(KEY_OFFLINE_MANIFEST)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// No-op when phase is not "done"
// ---------------------------------------------------------------------------

describe("reconcileWithStorage - no-op when phase is not done", () => {
  beforeEach(() => {
    vi.resetModules();
    stubWindowWithLocalStorage();
    vi.doMock("./offlineStore", async () => {
      const actual = await vi.importActual<typeof import("./offlineStore")>("./offlineStore");
      return { ...actual, offlineCount: vi.fn() };
    });
  });

  afterEach(async () => {
    const { _resetForTesting } = await import("./downloadController");
    _resetForTesting();
    vi.doUnmock("./offlineStore");
  });

  it("is a no-op in idle phase (offlineCount is never called)", async () => {
    const { getState, reconcileWithStorage } = await import("./downloadController");
    // No localStorage seeding - stays idle.
    expect(getState().phase).toBe("idle");

    const { offlineCount } = await import("./offlineStore");
    const countSpy = offlineCount as ReturnType<typeof vi.fn>;

    await reconcileWithStorage();

    expect(getState().phase).toBe("idle");
    expect(countSpy).not.toHaveBeenCalled();
  });
});
