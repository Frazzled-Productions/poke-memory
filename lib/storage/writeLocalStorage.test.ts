/**
 * Unit tests for the writeLocalStorage / writeLocalStorageRaw helpers.
 *
 * The node vitest project runs without a real browser, so window is not
 * defined by default. We stub it per test to exercise the SSR guard
 * (window undefined), the happy path, quota errors, and the notify option.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeLocalStorage, writeLocalStorageRaw } from "./writeLocalStorage";

function makeStorage(initial: Record<string, string> = {}): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => { data.clear(); },
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    get length() { return data.size; },
  } as Storage & { data: Map<string, string> };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── SSR guard ───────────────────────────────────────────────────────────────

describe("writeLocalStorage — SSR guard (window undefined)", () => {
  it("is a no-op when window is undefined", () => {
    // window is not stubbed in the node environment — this must not throw.
    expect(() => writeLocalStorage("k", "v")).not.toThrow();
  });

  it("does not write to any storage when window is undefined", () => {
    // No observable side-effect possible when window is absent.
    writeLocalStorage("k", { x: 1 });
    // If we reach here without throwing, the SSR guard worked.
  });
});

describe("writeLocalStorageRaw — SSR guard (window undefined)", () => {
  it("is a no-op when window is undefined", () => {
    expect(() => writeLocalStorageRaw("k", "raw-value")).not.toThrow();
  });
});

// ─── Happy path ──────────────────────────────────────────────────────────────

describe("writeLocalStorage — happy path", () => {
  it("serialises the value and stores it under the key", () => {
    const store = makeStorage();
    vi.stubGlobal("window", { localStorage: store, dispatchEvent: vi.fn() });
    writeLocalStorage("my-key", { score: 42 });
    expect(store.getItem("my-key")).toBe('{"score":42}');
  });

  it("stores a primitive number correctly", () => {
    const store = makeStorage();
    vi.stubGlobal("window", { localStorage: store, dispatchEvent: vi.fn() });
    writeLocalStorage("num", 99);
    expect(store.getItem("num")).toBe("99");
  });

  it("stores a boolean correctly", () => {
    const store = makeStorage();
    vi.stubGlobal("window", { localStorage: store, dispatchEvent: vi.fn() });
    writeLocalStorage("flag", true);
    expect(store.getItem("flag")).toBe("true");
  });

  it("stores an array correctly", () => {
    const store = makeStorage();
    vi.stubGlobal("window", { localStorage: store, dispatchEvent: vi.fn() });
    writeLocalStorage("arr", [1, 2, 3]);
    expect(store.getItem("arr")).toBe("[1,2,3]");
  });

  it("overwrites an existing value", () => {
    const store = makeStorage({ "k": "old" });
    vi.stubGlobal("window", { localStorage: store, dispatchEvent: vi.fn() });
    writeLocalStorage("k", "new");
    expect(store.getItem("k")).toBe('"new"');
  });
});

describe("writeLocalStorageRaw — happy path", () => {
  it("stores a raw string without double-encoding", () => {
    const store = makeStorage();
    vi.stubGlobal("window", { localStorage: store, dispatchEvent: vi.fn() });
    writeLocalStorageRaw("ver", "1.2.3");
    expect(store.getItem("ver")).toBe("1.2.3");
  });

  it("stores an empty string", () => {
    const store = makeStorage();
    vi.stubGlobal("window", { localStorage: store, dispatchEvent: vi.fn() });
    writeLocalStorageRaw("empty", "");
    expect(store.getItem("empty")).toBe("");
  });
});

// ─── notify: false (default) ─────────────────────────────────────────────────

describe("writeLocalStorage — notify off (default)", () => {
  it("does not dispatch a StorageEvent when notify is not set", () => {
    const store = makeStorage();
    const dispatch = vi.fn();
    vi.stubGlobal("window", { localStorage: store, dispatchEvent: dispatch });
    writeLocalStorage("k", "v");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not dispatch when notify is explicitly false", () => {
    const store = makeStorage();
    const dispatch = vi.fn();
    vi.stubGlobal("window", { localStorage: store, dispatchEvent: dispatch });
    writeLocalStorage("k", "v", { notify: false });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

// ─── notify: true ────────────────────────────────────────────────────────────

describe("writeLocalStorage — notify on", () => {
  it("dispatches a StorageEvent with the key and serialised newValue", () => {
    const store = makeStorage();
    let capturedEvent: StorageEvent | null = null;
    const dispatch = vi.fn((e: Event) => { capturedEvent = e as StorageEvent; });
    vi.stubGlobal("window", { localStorage: store, dispatchEvent: dispatch });
    // StorageEvent constructor needs to be available in the test env.
    vi.stubGlobal("StorageEvent", class MockStorageEvent extends Event {
      key: string | null;
      storageArea: Storage | null;
      newValue: string | null;
      constructor(type: string, init: { key?: string; storageArea?: Storage | null; newValue?: string | null }) {
        super(type);
        this.key = init.key ?? null;
        this.storageArea = init.storageArea ?? null;
        this.newValue = init.newValue ?? null;
      }
    });
    writeLocalStorage("settings-key", { a: 1 }, { notify: true });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent!.key).toBe("settings-key");
    expect(capturedEvent!.newValue).toBe('{"a":1}');
  });

  it("still writes the value even when StorageEvent dispatch throws", () => {
    const store = makeStorage();
    vi.stubGlobal("window", {
      localStorage: store,
      dispatchEvent: () => { throw new Error("dispatch failed"); },
    });
    vi.stubGlobal("StorageEvent", class MockStorageEvent extends Event {
      key: string | null = null;
      storageArea: Storage | null = null;
      newValue: string | null = null;
      constructor(type: string, init: { key?: string; storageArea?: Storage | null; newValue?: string | null }) {
        super(type);
        this.key = init.key ?? null;
        this.storageArea = init.storageArea ?? null;
        this.newValue = init.newValue ?? null;
      }
    });
    // Should not throw — dispatch errors are swallowed.
    expect(() => writeLocalStorage("k", "v", { notify: true })).not.toThrow();
    // The value is still written.
    expect(store.getItem("k")).toBe('"v"');
  });
});

describe("writeLocalStorageRaw — notify on", () => {
  it("dispatches a StorageEvent with the raw string as newValue", () => {
    const store = makeStorage();
    let capturedEvent: StorageEvent | null = null;
    const dispatch = vi.fn((e: Event) => { capturedEvent = e as StorageEvent; });
    vi.stubGlobal("window", { localStorage: store, dispatchEvent: dispatch });
    vi.stubGlobal("StorageEvent", class MockStorageEvent extends Event {
      key: string | null;
      storageArea: Storage | null;
      newValue: string | null;
      constructor(type: string, init: { key?: string; storageArea?: Storage | null; newValue?: string | null }) {
        super(type);
        this.key = init.key ?? null;
        this.storageArea = init.storageArea ?? null;
        this.newValue = init.newValue ?? null;
      }
    });
    writeLocalStorageRaw("ver", "0.9.1", { notify: true });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(capturedEvent!.key).toBe("ver");
    expect(capturedEvent!.newValue).toBe("0.9.1");
  });
});

// ─── Quota / write error swallowing ──────────────────────────────────────────

describe("writeLocalStorage — quota error swallowing", () => {
  it("does not throw when setItem throws QuotaExceededError", () => {
    const brokenStorage = {
      setItem: () => {
        const e = new DOMException("QuotaExceededError");
        Object.defineProperty(e, "name", { value: "QuotaExceededError" });
        throw e;
      },
      getItem: () => null,
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
    vi.stubGlobal("window", { localStorage: brokenStorage, dispatchEvent: vi.fn() });
    expect(() => writeLocalStorage("k", { x: 1 })).not.toThrow();
  });

  it("does not dispatch notify when setItem throws", () => {
    const brokenStorage = {
      setItem: () => { throw new DOMException("QuotaExceededError"); },
      getItem: () => null,
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
    const dispatch = vi.fn();
    vi.stubGlobal("window", { localStorage: brokenStorage, dispatchEvent: dispatch });
    vi.stubGlobal("StorageEvent", class MockStorageEvent extends Event {
      key: string | null = null;
      storageArea: Storage | null = null;
      newValue: string | null = null;
      constructor(type: string, init: { key?: string; storageArea?: Storage | null; newValue?: string | null }) {
        super(type);
        this.key = init.key ?? null;
        this.storageArea = init.storageArea ?? null;
        this.newValue = init.newValue ?? null;
      }
    });
    writeLocalStorage("k", "v", { notify: true });
    // notify should NOT fire since the setItem failed (we return early).
    expect(dispatch).not.toHaveBeenCalled();
  });
});

// ─── JSON.stringify failure ───────────────────────────────────────────────────

describe("writeLocalStorage — JSON.stringify failure", () => {
  it("does not throw when JSON.stringify throws (circular reference)", () => {
    const store = makeStorage();
    vi.stubGlobal("window", { localStorage: store, dispatchEvent: vi.fn() });
    const circular: Record<string, unknown> = {};
    circular.self = circular; // circular reference
    expect(() => writeLocalStorage("k", circular)).not.toThrow();
    // Nothing should be written.
    expect(store.getItem("k")).toBeNull();
  });
});
