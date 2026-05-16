import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  readLastSeenVersion,
  writeLastSeenVersion,
  LAST_SEEN_VERSION_KEY,
} from "./lastSeen";

// ---------------------------------------------------------------------------
// Mock localStorage
// ---------------------------------------------------------------------------

function makeMockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    _store: store,
  };
}

let storage: ReturnType<typeof makeMockStorage>;

beforeEach(() => {
  storage = makeMockStorage();
  vi.stubGlobal("window", { localStorage: storage, dispatchEvent: vi.fn() });
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// readLastSeenVersion
// ---------------------------------------------------------------------------

describe("readLastSeenVersion", () => {
  it("returns null when the key is absent", () => {
    expect(readLastSeenVersion()).toBeNull();
  });

  it("returns the stored version string", () => {
    storage.setItem(LAST_SEEN_VERSION_KEY, "0.9.65");
    expect(readLastSeenVersion()).toBe("0.9.65");
  });

  it("returns null when window is undefined (SSR path)", () => {
    vi.unstubAllGlobals();
    expect(readLastSeenVersion()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// writeLastSeenVersion
// ---------------------------------------------------------------------------

describe("writeLastSeenVersion", () => {
  it("persists the version to localStorage", () => {
    writeLastSeenVersion("0.9.66");
    expect(storage.getItem(LAST_SEEN_VERSION_KEY)).toBe("0.9.66");
  });

  it("overwrites a previously stored version", () => {
    writeLastSeenVersion("0.9.65");
    writeLastSeenVersion("0.9.66");
    expect(storage.getItem(LAST_SEEN_VERSION_KEY)).toBe("0.9.66");
  });

  it("dispatches a synthetic StorageEvent so same-tab listeners are notified", () => {
    const dispatchEvent = vi.fn();
    // The node environment has no StorageEvent constructor; stub it so the
    // source's try/catch does not swallow the dispatch call.
    vi.stubGlobal("StorageEvent", class {
      type = "storage";
      key: string | null;
      newValue: string | null;
      constructor(_type: string, init: { key?: string; newValue?: string }) {
        this.key = init.key ?? null;
        this.newValue = init.newValue ?? null;
      }
    });
    vi.stubGlobal("window", { localStorage: storage, dispatchEvent });
    writeLastSeenVersion("0.9.66");
    expect(dispatchEvent).toHaveBeenCalledOnce();
    const evt = dispatchEvent.mock.calls[0][0] as { type: string; key: string | null; newValue: string | null };
    expect(evt.type).toBe("storage");
    expect(evt.key).toBe(LAST_SEEN_VERSION_KEY);
    expect(evt.newValue).toBe("0.9.66");
  });

  it("round-trips correctly through readLastSeenVersion", () => {
    writeLastSeenVersion("1.0.0");
    expect(readLastSeenVersion()).toBe("1.0.0");
  });

  it("is a no-op when window is undefined (SSR path)", () => {
    vi.unstubAllGlobals();
    expect(() => writeLastSeenVersion("0.9.66")).not.toThrow();
  });
});
