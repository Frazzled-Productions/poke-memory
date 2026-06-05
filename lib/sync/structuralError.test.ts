import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  hasStructuralProbeBeenAttempted,
  markStructuralProbeAttempted,
  resetStructuralProbe,
  getStructuralSyncError,
  markStructuralSyncError,
  clearStructuralSyncError,
} from "./structuralError";
import { KEY_SYNC_STATUS } from "@/lib/storage/keys";

// ---------------------------------------------------------------------------
// Mock localStorage (same pattern as persistence.test.ts)
// ---------------------------------------------------------------------------

function makeMockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    _store: store,
  };
}

let storage: ReturnType<typeof makeMockStorage>;

beforeEach(() => {
  storage = makeMockStorage();
  vi.stubGlobal("window", { localStorage: storage, dispatchEvent: vi.fn() });
  vi.stubGlobal("localStorage", storage);
  // Reset the module-level probe guard before each test.
  resetStructuralProbe();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Session-scoped probe state machine
// ---------------------------------------------------------------------------

describe("probe state machine", () => {
  it("reports false before the probe has been attempted", () => {
    expect(hasStructuralProbeBeenAttempted()).toBe(false);
  });

  it("reports true after markStructuralProbeAttempted", () => {
    markStructuralProbeAttempted();
    expect(hasStructuralProbeBeenAttempted()).toBe(true);
  });

  it("resetStructuralProbe resets an attempted probe back to false", () => {
    markStructuralProbeAttempted();
    resetStructuralProbe();
    expect(hasStructuralProbeBeenAttempted()).toBe(false);
  });

  it("calling resetStructuralProbe when already false is a no-op", () => {
    // Should not throw.
    resetStructuralProbe();
    expect(hasStructuralProbeBeenAttempted()).toBe(false);
  });

  it("probe transitions: false → attempted → reset → attempted again", () => {
    expect(hasStructuralProbeBeenAttempted()).toBe(false);
    markStructuralProbeAttempted();
    expect(hasStructuralProbeBeenAttempted()).toBe(true);
    resetStructuralProbe();
    expect(hasStructuralProbeBeenAttempted()).toBe(false);
    markStructuralProbeAttempted();
    expect(hasStructuralProbeBeenAttempted()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getStructuralSyncError
// ---------------------------------------------------------------------------

describe("getStructuralSyncError", () => {
  it("returns null when the key is absent", () => {
    expect(getStructuralSyncError()).toBeNull();
  });

  describe("SSR path", () => {
    beforeEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns null when window is undefined", () => {
      expect(getStructuralSyncError()).toBeNull();
    });
  });

  it("returns the stored code when structuralSyncError is set", () => {
    storage.setItem(
      KEY_SYNC_STATUS,
      JSON.stringify({ structuralSyncError: "42P10" }),
    );
    expect(getStructuralSyncError()).toBe("42P10");
  });

  it("returns null when structuralSyncError is null in the stored object", () => {
    storage.setItem(
      KEY_SYNC_STATUS,
      JSON.stringify({ structuralSyncError: null }),
    );
    expect(getStructuralSyncError()).toBeNull();
  });

  it("returns null when the stored value is invalid JSON (JSON parse error path)", () => {
    // A raw non-JSON string causes JSON.parse to throw; readLocalStorage
    // catches that and returns the fallback (null).
    storage.setItem(KEY_SYNC_STATUS, "not-valid-json{{{");
    expect(getStructuralSyncError()).toBeNull();
  });

  it("returns null when the stored value is a JSON primitive (not an object)", () => {
    storage.setItem(KEY_SYNC_STATUS, JSON.stringify("just-a-string"));
    expect(getStructuralSyncError()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// markStructuralSyncError
// ---------------------------------------------------------------------------

describe("markStructuralSyncError", () => {
  it("writes the structuralSyncError code to localStorage", () => {
    markStructuralSyncError("42P10", "2026-05-30T12:00:00.000Z");
    const stored = JSON.parse(storage.getItem(KEY_SYNC_STATUS)!) as Record<string, unknown>;
    expect(stored.structuralSyncError).toBe("42P10");
  });

  it("stamps lastPushAttemptAt and sets lastPushFailed", () => {
    markStructuralSyncError("42P10", "2026-05-30T12:00:00.000Z");
    const stored = JSON.parse(storage.getItem(KEY_SYNC_STATUS)!) as Record<string, unknown>;
    expect(stored.lastPushAttemptAt).toBe("2026-05-30T12:00:00.000Z");
    expect(stored.lastPushFailed).toBe(true);
  });

  it("preserves pre-existing fields (lastPushAt) when writing", () => {
    storage.setItem(
      KEY_SYNC_STATUS,
      JSON.stringify({ lastPushAt: "2026-05-28T08:00:00.000Z" }),
    );
    markStructuralSyncError("42P10", "2026-05-30T12:00:00.000Z");
    const stored = JSON.parse(storage.getItem(KEY_SYNC_STATUS)!) as Record<string, unknown>;
    expect(stored.lastPushAt).toBe("2026-05-28T08:00:00.000Z");
    expect(stored.structuralSyncError).toBe("42P10");
  });

  it("stores any SQLSTATE code, not just 42P10", () => {
    markStructuralSyncError("23505", "2026-05-30T12:00:00.000Z");
    const stored = JSON.parse(storage.getItem(KEY_SYNC_STATUS)!) as Record<string, unknown>;
    expect(stored.structuralSyncError).toBe("23505");
  });

  describe("SSR path", () => {
    beforeEach(() => {
      vi.unstubAllGlobals();
    });

    it("is a no-op when window is undefined", () => {
      // Should not throw; localStorage is inaccessible.
      expect(() => markStructuralSyncError("42P10")).not.toThrow();
    });
  });

  it("patchSyncStatus recovers gracefully when stored value is invalid JSON", () => {
    // Pre-seed a corrupt value; patchSyncStatus falls back to {} and overwrites.
    storage.setItem(KEY_SYNC_STATUS, "not-valid-json{{{");
    // Should not throw; the bad value is replaced with a valid patch.
    expect(() => markStructuralSyncError("42P10", "2026-05-30T12:00:00.000Z")).not.toThrow();
    const stored = JSON.parse(storage.getItem(KEY_SYNC_STATUS)!) as Record<string, unknown>;
    expect(stored.structuralSyncError).toBe("42P10");
  });

  it("does not throw even if the StorageEvent constructor is unavailable (non-browser env)", () => {
    // Node has no StorageEvent; patchSyncStatus catches that and continues.
    // The important thing is the write still lands - no exception escapes.
    expect(() => markStructuralSyncError("42P10", "2026-05-30T12:00:00.000Z")).not.toThrow();
    const stored = JSON.parse(storage.getItem(KEY_SYNC_STATUS)!) as Record<string, unknown>;
    expect(stored.structuralSyncError).toBe("42P10");
  });
});

// ---------------------------------------------------------------------------
// clearStructuralSyncError
// ---------------------------------------------------------------------------

describe("clearStructuralSyncError", () => {
  it("clears structuralSyncError to null when an error is set", () => {
    storage.setItem(
      KEY_SYNC_STATUS,
      JSON.stringify({ structuralSyncError: "42P10" }),
    );
    clearStructuralSyncError();
    const stored = JSON.parse(storage.getItem(KEY_SYNC_STATUS)!) as Record<string, unknown>;
    expect(stored.structuralSyncError).toBeNull();
  });

  it("idempotent: calling twice does not write to localStorage a second time", () => {
    storage.setItem(
      KEY_SYNC_STATUS,
      JSON.stringify({ structuralSyncError: "42P10" }),
    );

    clearStructuralSyncError(); // first call: clears the error
    // Capture the state after the first clear.
    const afterFirst = storage.getItem(KEY_SYNC_STATUS);

    // The spy works because beforeEach stubs both global.localStorage and
    // window.localStorage with the same `storage` object reference, so any
    // write via window.localStorage.setItem is intercepted here. If either stub
    // were changed to a separate object the spy would be inert and a genuine
    // double-write would become a false-positive pass.
    const setItemSpy = vi.spyOn(storage, "setItem");
    clearStructuralSyncError(); // second call: error already null, must not write

    expect(setItemSpy).not.toHaveBeenCalled();
    // State must not have changed.
    expect(storage.getItem(KEY_SYNC_STATUS)).toBe(afterFirst);
    setItemSpy.mockRestore();
  });

  it("idempotent: calling when already null does not throw", () => {
    storage.setItem(KEY_SYNC_STATUS, JSON.stringify({ structuralSyncError: null }));
    expect(() => clearStructuralSyncError()).not.toThrow();
  });

  it("idempotent: calling when key is entirely absent does not throw", () => {
    expect(() => clearStructuralSyncError()).not.toThrow();
  });

  it("preserves other fields when clearing", () => {
    storage.setItem(
      KEY_SYNC_STATUS,
      JSON.stringify({
        lastPushAt: "2026-05-29T08:00:00.000Z",
        lastPushFailed: true,
        structuralSyncError: "42P10",
      }),
    );
    clearStructuralSyncError();
    const stored = JSON.parse(storage.getItem(KEY_SYNC_STATUS)!) as Record<string, unknown>;
    expect(stored.structuralSyncError).toBeNull();
    expect(stored.lastPushAt).toBe("2026-05-29T08:00:00.000Z");
    expect(stored.lastPushFailed).toBe(true);
  });

  describe("SSR path", () => {
    beforeEach(() => {
      vi.unstubAllGlobals();
    });

    it("is a no-op when window is undefined", () => {
      expect(() => clearStructuralSyncError()).not.toThrow();
    });
  });
});
