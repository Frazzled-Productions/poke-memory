/**
 * Tests for getOrCreateClientSalt.
 *
 * The source lives in lib/identity/clientSalt.ts, but this test file must
 * live under components/ so vitest picks it up with the jsdom project — the
 * node project has no DOM and localStorage would be undefined.  See AGENTS.md
 * "Testing" for the jsdom vs node project split.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KEY_CLIENT_SALT } from "@/lib/storage/keys";

// ---------------------------------------------------------------------------
// localStorage stub — jsdom on this Node version does not provide a real
// localStorage by default, so we install our own in-memory implementation,
// matching the pattern from deleteAccount-local.test.tsx.
// ---------------------------------------------------------------------------

function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };
}

// ---------------------------------------------------------------------------
// We re-import getOrCreateClientSalt fresh for each describe block that needs
// a clean module state.  Because vitest caches modules, we call
// vi.resetModules() in afterEach so the cached `existing` lookup is not
// carried between tests.
// ---------------------------------------------------------------------------

describe("getOrCreateClientSalt — normal path", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, "localStorage", {
      value: makeLocalStorage(),
      configurable: true,
      writable: true,
    });
    // Provide a deterministic UUID so we can assert the stored value.
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" as `${string}-${string}-${string}-${string}-${string}`,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (window as unknown as { localStorage?: unknown }).localStorage;
  });

  it("first call generates a UUID and persists it to localStorage", async () => {
    const { getOrCreateClientSalt } = await import("@/lib/identity/clientSalt");
    const salt = getOrCreateClientSalt();
    expect(salt).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(localStorage.getItem(KEY_CLIENT_SALT)).toBe(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
  });

  it("second call returns the persisted value without re-generating", async () => {
    const { getOrCreateClientSalt } = await import("@/lib/identity/clientSalt");
    // Populate storage as if a previous page load had already run.
    localStorage.setItem(KEY_CLIENT_SALT, "persisted-uuid-value");

    const salt = getOrCreateClientSalt();
    expect(salt).toBe("persisted-uuid-value");
    // randomUUID should not have been called — the existing value was returned.
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });
});

describe("getOrCreateClientSalt — SSR / no window", () => {
  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    vi.resetModules();
    originalWindow = globalThis.window;
    // Simulate a server-side environment where window is not defined.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window;
  });

  afterEach(() => {
    vi.resetModules();
    globalThis.window = originalWindow;
    vi.restoreAllMocks();
  });

  it("returns empty string when window is undefined", async () => {
    const { getOrCreateClientSalt } = await import("@/lib/identity/clientSalt");
    expect(getOrCreateClientSalt()).toBe("");
  });
});

describe("getOrCreateClientSalt — quota-exceeded path", () => {
  beforeEach(() => {
    vi.resetModules();
    const ls = makeLocalStorage();
    // Override setItem to throw a QuotaExceededError, simulating a full storage.
    const originalSetItem = ls.setItem.bind(ls);
    ls.setItem = (k: string, _v: string) => {
      if (k === KEY_CLIENT_SALT) {
        throw new DOMException("QuotaExceededError");
      }
      originalSetItem(k, _v);
    };
    Object.defineProperty(window, "localStorage", {
      value: ls,
      configurable: true,
      writable: true,
    });
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "ffffffff-0000-1111-2222-333333333333" as `${string}-${string}-${string}-${string}-${string}`,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (window as unknown as { localStorage?: unknown }).localStorage;
  });

  it("returns the generated UUID for the session even when setItem throws", async () => {
    const { getOrCreateClientSalt } = await import("@/lib/identity/clientSalt");
    // Must not throw despite the storage write failing.
    const salt = getOrCreateClientSalt();
    expect(salt).toBe("ffffffff-0000-1111-2222-333333333333");
    // The value was not persisted (the write was rejected by the stub).
    expect(localStorage.getItem(KEY_CLIENT_SALT)).toBeNull();
  });
});
