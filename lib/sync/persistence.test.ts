import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadSyncStatus,
  saveSyncStatus,
  markPushSucceeded,
  markPushFailed,
  markStructuralSyncError,
  clearStructuralSyncError,
  STORAGE_KEY,
  type SyncStatus,
} from "./persistence";

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

const ZERO: SyncStatus = {
  lastPushAt: null,
  lastPushFailed: false,
  lastPushAttemptAt: null,
  failedCardCount: null,
  lastPullAt: null,
  lastSettingsPullAt: null,
  lastSeenResetAt: null,
  structuralSyncError: null,
};

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
// loadSyncStatus
// ---------------------------------------------------------------------------

describe("loadSyncStatus", () => {
  it("returns the zero state when the key is absent", () => {
    expect(loadSyncStatus()).toEqual(ZERO);
  });

  it("returns the zero state when window is undefined (SSR path)", () => {
    vi.unstubAllGlobals();
    expect(loadSyncStatus()).toEqual(ZERO);
  });

  it("returns the zero state on malformed JSON", () => {
    storage.setItem(STORAGE_KEY, "not-valid-json{{{");
    expect(loadSyncStatus()).toEqual(ZERO);
  });

  it("returns the zero state when the stored value is a JSON string (not object)", () => {
    storage.setItem(STORAGE_KEY, JSON.stringify("a string"));
    expect(loadSyncStatus()).toEqual(ZERO);
  });

  it("returns the zero state when the stored value is a JSON number", () => {
    storage.setItem(STORAGE_KEY, JSON.stringify(42));
    expect(loadSyncStatus()).toEqual(ZERO);
  });

  it("returns the zero state when the stored value is null (JSON null)", () => {
    storage.setItem(STORAGE_KEY, "null");
    expect(loadSyncStatus()).toEqual(ZERO);
  });

  it("returns the zero state when the stored value is a JSON array", () => {
    storage.setItem(STORAGE_KEY, "[]");
    expect(loadSyncStatus()).toEqual(ZERO);
  });

  it("reads back a fully-populated status written by saveSyncStatus", () => {
    const status: SyncStatus = {
      lastPushAt: "2026-05-01T10:00:00.000Z",
      lastPushFailed: true,
      lastPushAttemptAt: "2026-05-01T09:00:00.000Z",
      failedCardCount: 3,
      lastPullAt: "2026-05-01T08:00:00.000Z",
      lastSettingsPullAt: "2026-05-01T07:00:00.000Z",
      lastSeenResetAt: "2026-04-30T00:00:00.000Z",
      structuralSyncError: null,
    };
    saveSyncStatus(status);
    expect(loadSyncStatus()).toEqual(status);
  });

  it("reads back structuralSyncError when written", () => {
    const status: SyncStatus = { ...ZERO, structuralSyncError: "42P10" };
    saveSyncStatus(status);
    expect(loadSyncStatus().structuralSyncError).toBe("42P10");
  });

  it("defaults structuralSyncError to null when field is absent (legacy record)", () => {
    // Simulate a record stored before this field was added.
    storage.setItem(STORAGE_KEY, JSON.stringify({ lastPushFailed: false }));
    expect(loadSyncStatus().structuralSyncError).toBeNull();
  });

  it("defaults structuralSyncError to null when field is not a string", () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ structuralSyncError: 42 }));
    expect(loadSyncStatus().structuralSyncError).toBeNull();
  });

  it("defaults lastPushFailed to false when stored value is not boolean", () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ lastPushFailed: "yes" }));
    expect(loadSyncStatus().lastPushFailed).toBe(false);
  });

  it("defaults lastPushAt to null when stored value is not a string", () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ lastPushAt: 12345 }));
    expect(loadSyncStatus().lastPushAt).toBeNull();
  });

  it("defaults failedCardCount to null when stored value is negative", () => {
    // Negative count is not a valid state — guard rejects it
    storage.setItem(STORAGE_KEY, JSON.stringify({ failedCardCount: -1 }));
    expect(loadSyncStatus().failedCardCount).toBeNull();
  });

  it("defaults failedCardCount to null when stored value is a float", () => {
    // Only integer values are accepted
    storage.setItem(STORAGE_KEY, JSON.stringify({ failedCardCount: 1.5 }));
    expect(loadSyncStatus().failedCardCount).toBeNull();
  });

  it("accepts failedCardCount: 0", () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ failedCardCount: 0 }));
    expect(loadSyncStatus().failedCardCount).toBe(0);
  });

  it("defaults all string fields to null when stored values are booleans", () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        lastPushAt: true,
        lastPushAttemptAt: false,
        lastPullAt: true,
        lastSettingsPullAt: false,
        lastSeenResetAt: true,
      }),
    );
    const status = loadSyncStatus();
    expect(status.lastPushAt).toBeNull();
    expect(status.lastPushAttemptAt).toBeNull();
    expect(status.lastPullAt).toBeNull();
    expect(status.lastSettingsPullAt).toBeNull();
    expect(status.lastSeenResetAt).toBeNull();
  });

  it("forwards all string fields when they are valid strings", () => {
    const raw = {
      lastPushAt: "2026-01-01T00:00:00.000Z",
      lastPushFailed: false,
      lastPushAttemptAt: "2026-01-01T00:00:00.000Z",
      failedCardCount: 5,
      lastPullAt: "2026-01-01T00:00:00.000Z",
      lastSettingsPullAt: "2026-01-01T00:00:00.000Z",
      lastSeenResetAt: "2026-01-01T00:00:00.000Z",
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(raw));
    const status = loadSyncStatus();
    expect(status.lastPushAt).toBe("2026-01-01T00:00:00.000Z");
    expect(status.lastPullAt).toBe("2026-01-01T00:00:00.000Z");
    expect(status.lastSettingsPullAt).toBe("2026-01-01T00:00:00.000Z");
    expect(status.lastSeenResetAt).toBe("2026-01-01T00:00:00.000Z");
    expect(status.failedCardCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// saveSyncStatus
// ---------------------------------------------------------------------------

describe("saveSyncStatus", () => {
  it("persists the status to localStorage", () => {
    const status: SyncStatus = { ...ZERO, lastPushAt: "2026-05-10T12:00:00.000Z" };
    saveSyncStatus(status);
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(loadSyncStatus().lastPushAt).toBe("2026-05-10T12:00:00.000Z");
  });

  it("dispatches a synthetic StorageEvent after writing", () => {
    const dispatchEvent = vi.fn();
    // The node environment has no StorageEvent constructor; stub it so the
    // source's try/catch does not silently swallow the dispatch call.
    vi.stubGlobal("StorageEvent", class {
      type = "storage";
      key: string | null;
      constructor(_type: string, init: { key?: string; storageArea?: unknown; newValue?: string | null }) {
        this.key = init.key ?? null;
      }
    });
    vi.stubGlobal("window", { localStorage: storage, dispatchEvent });
    saveSyncStatus(ZERO);
    expect(dispatchEvent).toHaveBeenCalledOnce();
    const evt = dispatchEvent.mock.calls[0][0] as { type: string; key: string | null };
    expect(evt.type).toBe("storage");
    expect(evt.key).toBe(STORAGE_KEY);
  });

  it("is a no-op when window is undefined (SSR path)", () => {
    vi.unstubAllGlobals();
    expect(() => saveSyncStatus(ZERO)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// markPushSucceeded
// ---------------------------------------------------------------------------

describe("markPushSucceeded", () => {
  it("sets lastPushAt to the provided timestamp", () => {
    markPushSucceeded("2026-05-10T12:00:00.000Z");
    expect(loadSyncStatus().lastPushAt).toBe("2026-05-10T12:00:00.000Z");
  });

  it("clears lastPushFailed", () => {
    // Write a failed state first
    saveSyncStatus({ ...ZERO, lastPushFailed: true, failedCardCount: 2 });
    markPushSucceeded("2026-05-10T12:00:00.000Z");
    expect(loadSyncStatus().lastPushFailed).toBe(false);
  });

  it("clears structuralSyncError — a successful push proves the schema mismatch is resolved", () => {
    saveSyncStatus({ ...ZERO, structuralSyncError: "42P10", lastPushFailed: true });
    markPushSucceeded("2026-05-10T12:00:00.000Z");
    expect(loadSyncStatus().structuralSyncError).toBeNull();
    expect(loadSyncStatus().lastPushFailed).toBe(false);
  });

  it("preserves failedCardCount (intentional — callers gate on lastPushFailed)", () => {
    saveSyncStatus({ ...ZERO, lastPushFailed: true, failedCardCount: 7 });
    markPushSucceeded("2026-05-10T12:00:00.000Z");
    // failedCardCount deliberately left untouched on success
    expect(loadSyncStatus().failedCardCount).toBe(7);
    expect(loadSyncStatus().lastPushFailed).toBe(false);
  });

  it("uses a default timestamp when none is provided (smoke test)", () => {
    const before = Date.now();
    markPushSucceeded();
    const after = Date.now();
    const ts = loadSyncStatus().lastPushAt;
    expect(ts).not.toBeNull();
    const parsed = new Date(ts!).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// markPushFailed
// ---------------------------------------------------------------------------

describe("markPushFailed", () => {
  it("sets lastPushFailed to true", () => {
    markPushFailed(3, "2026-05-10T12:00:00.000Z");
    expect(loadSyncStatus().lastPushFailed).toBe(true);
  });

  it("sets failedCardCount to the provided count", () => {
    markPushFailed(5, "2026-05-10T12:00:00.000Z");
    expect(loadSyncStatus().failedCardCount).toBe(5);
  });

  it("stamps lastPushAttemptAt", () => {
    markPushFailed(1, "2026-05-10T12:00:00.000Z");
    expect(loadSyncStatus().lastPushAttemptAt).toBe("2026-05-10T12:00:00.000Z");
  });

  it("preserves lastPushAt from before the failure", () => {
    saveSyncStatus({ ...ZERO, lastPushAt: "2026-05-09T08:00:00.000Z" });
    markPushFailed(2, "2026-05-10T12:00:00.000Z");
    // lastPushAt should remain — it's the last *successful* sync
    expect(loadSyncStatus().lastPushAt).toBe("2026-05-09T08:00:00.000Z");
  });

  it("uses a default timestamp when none is provided (smoke test)", () => {
    const before = Date.now();
    markPushFailed(1);
    const after = Date.now();
    const ts = loadSyncStatus().lastPushAttemptAt;
    expect(ts).not.toBeNull();
    const parsed = new Date(ts!).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// markStructuralSyncError (#1358)
// ---------------------------------------------------------------------------

describe("markStructuralSyncError", () => {
  it("sets structuralSyncError to the provided code", () => {
    markStructuralSyncError("42P10", "2026-05-30T12:00:00.000Z");
    expect(loadSyncStatus().structuralSyncError).toBe("42P10");
  });

  it("sets lastPushFailed to true", () => {
    markStructuralSyncError("42P10", "2026-05-30T12:00:00.000Z");
    expect(loadSyncStatus().lastPushFailed).toBe(true);
  });

  it("stamps lastPushAttemptAt", () => {
    markStructuralSyncError("42P10", "2026-05-30T12:00:00.000Z");
    expect(loadSyncStatus().lastPushAttemptAt).toBe("2026-05-30T12:00:00.000Z");
  });

  it("preserves lastPushAt — the last successful sync should remain visible", () => {
    saveSyncStatus({ ...ZERO, lastPushAt: "2026-05-29T08:00:00.000Z" });
    markStructuralSyncError("42P10", "2026-05-30T12:00:00.000Z");
    expect(loadSyncStatus().lastPushAt).toBe("2026-05-29T08:00:00.000Z");
  });

  it("stores any SQLSTATE string, not just 42P10", () => {
    markStructuralSyncError("23505", "2026-05-30T12:00:00.000Z");
    expect(loadSyncStatus().structuralSyncError).toBe("23505");
  });

  it("is a no-op when window is undefined (SSR path)", () => {
    vi.unstubAllGlobals();
    expect(() => markStructuralSyncError("42P10")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// clearStructuralSyncError (#1358)
// ---------------------------------------------------------------------------

describe("clearStructuralSyncError", () => {
  it("clears structuralSyncError to null", () => {
    saveSyncStatus({ ...ZERO, structuralSyncError: "42P10" });
    clearStructuralSyncError();
    expect(loadSyncStatus().structuralSyncError).toBeNull();
  });

  it("is a no-op when structuralSyncError is already null", () => {
    saveSyncStatus(ZERO);
    expect(() => clearStructuralSyncError()).not.toThrow();
    expect(loadSyncStatus().structuralSyncError).toBeNull();
  });

  it("preserves other fields when clearing", () => {
    saveSyncStatus({
      ...ZERO,
      lastPushAt: "2026-05-29T08:00:00.000Z",
      lastPushFailed: true,
      structuralSyncError: "42P10",
    });
    clearStructuralSyncError();
    const status = loadSyncStatus();
    expect(status.structuralSyncError).toBeNull();
    expect(status.lastPushAt).toBe("2026-05-29T08:00:00.000Z");
    expect(status.lastPushFailed).toBe(true);
  });
});
