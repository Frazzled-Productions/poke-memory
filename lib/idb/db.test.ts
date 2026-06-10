/**
 * Unit tests for lib/idb/db.ts.
 *
 * Placement rationale: the test file lives in lib/ so the "node" vitest
 * project picks it up. The node setup file (vitest.setup.node.ts) installs
 * fake-indexeddb/auto, which polyfills IndexedDB on globalThis - no DOM is
 * required and no new dev dependency is needed.
 *
 * Error-flip tests use vi.doMock to replace the idb module so we can simulate
 * IDB failures without wiring fake-indexeddb error paths. The pattern requires:
 *   1. vi.resetModules() to clear the module registry in beforeEach
 *   2. vi.doMock('idb', ...) to register the mock before the import
 *   3. dynamic import('./db') to get a fresh module with the mock applied
 *
 * Happy-path tests use the real fake-indexeddb (installed by the setup file).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Closes the module's DB handle and deletes the fake IDB database so state
 * does not leak across test cases. Must be called after vi.resetModules() so
 * the import here gets the currently-active module instance.
 */
async function deleteIdbDatabase() {
  await new Promise<void>((resolve, reject) => {
    const req = globalThis.indexedDB.deleteDatabase("poke-memory");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

/**
 * Minimal window stub that satisfies `typeof window === "undefined"` guards in
 * db.ts. Exposes the polyfilled indexedDB so openDB can reach the fake store.
 */
function stubWindow() {
  vi.stubGlobal("window", {
    indexedDB: globalThis.indexedDB,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    dispatchEvent: () => true,
  });
}

// ─── happy-path tests (use real fake-indexeddb) ───────────────────────────────

describe("openAppDb (happy path)", () => {
  beforeEach(async () => {
    vi.resetModules();
    await deleteIdbDatabase();
    stubWindow();
  });

  afterEach(async () => {
    const { __resetForTests } = await import("./db");
    await __resetForTests();
    vi.unstubAllGlobals();
  });

  it("resolves to a database with a kv object store", async () => {
    const { openAppDb } = await import("./db");
    const db = await openAppDb();
    expect(db.objectStoreNames.contains("kv")).toBe(true);
  });

  it("resolves to a database with an offline-pack object store (v2 schema)", async () => {
    const { openAppDb } = await import("./db");
    const db = await openAppDb();
    expect(db.objectStoreNames.contains("offline-pack")).toBe(true);
  });

  it("opens at version 2", async () => {
    const { openAppDb } = await import("./db");
    const db = await openAppDb();
    expect(db.version).toBe(2);
  });

  it("returns the same promise on successive calls (singleton pattern)", async () => {
    const { openAppDb } = await import("./db");
    const p1 = openAppDb();
    const p2 = openAppDb();
    expect(p1).toBe(p2);
  });
});

// ─── v1→v2 upgrade: kv data survives, offline-pack is added ──────────────────
//
// Blocker 2 regression guard: once the DB was opened at v1 by lib/idb/db.ts,
// bumping to v2 must create the offline-pack store without destroying the kv
// store or its data. Uses the raw fake-indexeddb API to simulate the v1 state.

describe("v1→v2 schema upgrade (kv data survives, offline-pack added)", () => {
  beforeEach(async () => {
    vi.resetModules();
    await deleteIdbDatabase();
    stubWindow();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await deleteIdbDatabase();
  });

  it("kv data written at v1 is readable after the v2 upgrade", async () => {
    // Step 1: seed data at v1 using the raw IDB API.
    await new Promise<void>((resolve, reject) => {
      const req = globalThis.indexedDB.open("poke-memory", 1);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        db.createObjectStore("kv");
      };
      req.onsuccess = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put("session-data", "poke-memory:review-session:v1");
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    // Step 2: open at v2 via openAppDb (triggers the upgrade).
    const { openAppDb, idbGet } = await import("./db");
    const db = await openAppDb();

    // Both stores must exist.
    expect(db.objectStoreNames.contains("kv")).toBe(true);
    expect(db.objectStoreNames.contains("offline-pack")).toBe(true);

    // kv data written at v1 must be intact.
    const val = await idbGet("poke-memory:review-session:v1");
    expect(val).toBe("session-data");
  });

  it("offline-pack store exists after upgrade even when starting from v1", async () => {
    // Seed v1 DB without offline-pack.
    await new Promise<void>((resolve, reject) => {
      const req = globalThis.indexedDB.open("poke-memory", 1);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        db.createObjectStore("kv");
      };
      req.onsuccess = (e) => {
        (e.target as IDBOpenDBRequest).result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });

    const { openAppDb } = await import("./db");
    const db = await openAppDb();
    expect(db.objectStoreNames.contains("offline-pack")).toBe(true);
  });
});

describe("isIdbAvailable (happy path)", () => {
  beforeEach(async () => {
    vi.resetModules();
    await deleteIdbDatabase();
    stubWindow();
  });

  afterEach(async () => {
    const { __resetForTests } = await import("./db");
    await __resetForTests();
    vi.unstubAllGlobals();
  });

  it("returns true initially", async () => {
    const { isIdbAvailable } = await import("./db");
    expect(isIdbAvailable()).toBe(true);
  });
});

describe("idbGet / idbSet / idbDelete (happy path)", () => {
  beforeEach(async () => {
    vi.resetModules();
    await deleteIdbDatabase();
    stubWindow();
  });

  afterEach(async () => {
    const { __resetForTests } = await import("./db");
    await __resetForTests();
    vi.unstubAllGlobals();
  });

  it("idbSet stores a value and idbGet retrieves it", async () => {
    const { idbGet, idbSet } = await import("./db");
    await idbSet("test-key", "hello");
    const result = await idbGet("test-key");
    expect(result).toBe("hello");
  });

  it("idbGet returns null for a key that has never been set", async () => {
    const { idbGet } = await import("./db");
    const result = await idbGet("missing-key");
    expect(result).toBeNull();
  });

  it("idbDelete removes a previously stored value", async () => {
    const { idbGet, idbSet, idbDelete } = await import("./db");
    await idbSet("del-key", "to-be-deleted");
    await idbDelete("del-key");
    const result = await idbGet("del-key");
    expect(result).toBeNull();
  });

  it("idbDelete is a no-op when the key does not exist", async () => {
    const { idbDelete } = await import("./db");
    await expect(idbDelete("nonexistent")).resolves.toBeUndefined();
  });
});

// ─── server-side guard (typeof window === "undefined") ───────────────────────

describe("server-side guard - window undefined", () => {
  beforeEach(async () => {
    vi.resetModules();
    // Do NOT stub window - the node environment has no window global.
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("idbGet returns null when window is undefined", async () => {
    const { idbGet } = await import("./db");
    expect(await idbGet("any-key")).toBeNull();
  });

  it("idbSet returns undefined without throwing when window is undefined", async () => {
    const { idbSet } = await import("./db");
    await expect(idbSet("any-key", "any-val")).resolves.toBeUndefined();
  });

  it("idbDelete returns undefined without throwing when window is undefined", async () => {
    const { idbDelete } = await import("./db");
    await expect(idbDelete("any-key")).resolves.toBeUndefined();
  });
});

// ─── error-flip tests (mocked idb) ───────────────────────────────────────────
//
// vi.resetModules() clears the module registry in beforeEach, so each test
// gets a fresh db.ts module instance with idbAvailable reset to true.
// vi.doMock must be called BEFORE the dynamic import so the module loader
// picks up the mock when resolving the idb dependency.

describe("openAppDb failure - permanent-disable behaviour", () => {
  beforeEach(() => {
    vi.resetModules();
    stubWindow();
    vi.doMock("idb", () => ({
      openDB: vi.fn().mockRejectedValue(new DOMException("QuotaExceededError")),
    }));
  });

  afterEach(() => {
    vi.doUnmock("idb");
    vi.unstubAllGlobals();
  });

  it("sets idbAvailable to false when openDB rejects", async () => {
    const { openAppDb, isIdbAvailable } = await import("./db");
    expect(isIdbAvailable()).toBe(true); // before the first attempt
    await openAppDb().catch(() => {});
    expect(isIdbAvailable()).toBe(false);
  });

  it("rejects the returned promise so callers can handle the failure", async () => {
    const { openAppDb } = await import("./db");
    await expect(openAppDb()).rejects.toBeInstanceOf(DOMException);
  });

  it("subsequent idbGet calls are no-ops once the flag is flipped", async () => {
    const { openAppDb, idbGet, isIdbAvailable } = await import("./db");
    await openAppDb().catch(() => {});
    expect(isIdbAvailable()).toBe(false);
    // With idbAvailable false, idbGet must short-circuit and return null.
    const result = await idbGet("any-key");
    expect(result).toBeNull();
  });
});

describe("idbGet failure - error-flip on db.get throw", () => {
  beforeEach(() => {
    vi.resetModules();
    stubWindow();
    vi.doMock("idb", () => ({
      openDB: vi.fn().mockResolvedValue({
        objectStoreNames: { contains: () => true },
        get: vi.fn().mockRejectedValue(new DOMException("UnknownError")),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      }),
    }));
  });

  afterEach(() => {
    vi.doUnmock("idb");
    vi.unstubAllGlobals();
  });

  it("returns null when db.get throws", async () => {
    const { idbGet } = await import("./db");
    const result = await idbGet("any-key");
    expect(result).toBeNull();
  });

  it("flips idbAvailable to false after db.get throws", async () => {
    const { idbGet, isIdbAvailable } = await import("./db");
    expect(isIdbAvailable()).toBe(true);
    await idbGet("any-key");
    expect(isIdbAvailable()).toBe(false);
  });

  it("subsequent idbGet calls short-circuit after the flag is flipped", async () => {
    const { idbGet, isIdbAvailable } = await import("./db");
    await idbGet("key1"); // triggers the error and flips the flag
    expect(isIdbAvailable()).toBe(false);
    // Second call must short-circuit (idbAvailable is false).
    const result = await idbGet("key2");
    expect(result).toBeNull();
  });
});

describe("idbSet failure - error-flip on db.put throw", () => {
  beforeEach(() => {
    vi.resetModules();
    stubWindow();
    vi.doMock("idb", () => ({
      openDB: vi.fn().mockResolvedValue({
        objectStoreNames: { contains: () => true },
        get: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockRejectedValue(new DOMException("QuotaExceededError")),
        delete: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      }),
    }));
  });

  afterEach(() => {
    vi.doUnmock("idb");
    vi.unstubAllGlobals();
  });

  it("does not throw when db.put rejects", async () => {
    const { idbSet } = await import("./db");
    await expect(idbSet("any-key", "any-val")).resolves.toBeUndefined();
  });

  it("flips idbAvailable to false after db.put throws", async () => {
    const { idbSet, isIdbAvailable } = await import("./db");
    expect(isIdbAvailable()).toBe(true);
    await idbSet("any-key", "any-val");
    expect(isIdbAvailable()).toBe(false);
  });

  it("subsequent idbSet calls are no-ops after the flag is flipped", async () => {
    const { idbSet, isIdbAvailable } = await import("./db");
    await idbSet("key1", "val1"); // triggers the error and flips the flag
    expect(isIdbAvailable()).toBe(false);
    await expect(idbSet("key2", "val2")).resolves.toBeUndefined();
    expect(isIdbAvailable()).toBe(false);
  });
});

describe("idbDelete failure - error-flip on db.delete throw", () => {
  beforeEach(() => {
    vi.resetModules();
    stubWindow();
    vi.doMock("idb", () => ({
      openDB: vi.fn().mockResolvedValue({
        objectStoreNames: { contains: () => true },
        get: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockRejectedValue(new DOMException("UnknownError")),
        close: vi.fn(),
      }),
    }));
  });

  afterEach(() => {
    vi.doUnmock("idb");
    vi.unstubAllGlobals();
  });

  it("does not throw when db.delete rejects", async () => {
    const { idbDelete } = await import("./db");
    await expect(idbDelete("any-key")).resolves.toBeUndefined();
  });

  it("flips idbAvailable to false after db.delete throws", async () => {
    const { idbDelete, isIdbAvailable } = await import("./db");
    expect(isIdbAvailable()).toBe(true);
    await idbDelete("any-key");
    expect(isIdbAvailable()).toBe(false);
  });
});

// ─── __resetForTests ──────────────────────────────────────────────────────────

describe("__resetForTests", () => {
  beforeEach(async () => {
    vi.resetModules();
    stubWindow();
  });

  afterEach(async () => {
    vi.doUnmock("idb");
    vi.unstubAllGlobals();
    await deleteIdbDatabase();
  });

  it("restores idbAvailable to true after a simulated openDB failure", async () => {
    // First: open with a failing mock to flip idbAvailable to false.
    vi.doMock("idb", () => ({
      openDB: vi.fn().mockRejectedValue(new DOMException("QuotaExceededError")),
    }));
    const { openAppDb, isIdbAvailable, __resetForTests } = await import("./db");
    await openAppDb().catch(() => {});
    expect(isIdbAvailable()).toBe(false);

    // Now reset - isIdbAvailable should return true again.
    await __resetForTests();
    expect(isIdbAvailable()).toBe(true);
  });

  it("restores idbAvailable to true after a db.get failure", async () => {
    vi.doMock("idb", () => ({
      openDB: vi.fn().mockResolvedValue({
        objectStoreNames: { contains: () => true },
        get: vi.fn().mockRejectedValue(new DOMException("UnknownError")),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      }),
    }));
    const { idbGet, isIdbAvailable, __resetForTests } = await import("./db");
    await idbGet("any-key");
    expect(isIdbAvailable()).toBe(false);

    await __resetForTests();
    expect(isIdbAvailable()).toBe(true);
  });
});

// ─── migrateFromLocalStorage ──────────────────────────────────────────────────

describe("migrateFromLocalStorage (happy path)", () => {
  const SESSION_LS_KEY = "poke-memory:review-session:v1";
  const GRADE_LOG_LS_KEY = "poke-memory:grade-log:v1";

  let store: Map<string, string>;

  beforeEach(async () => {
    vi.resetModules();
    await deleteIdbDatabase();
    store = new Map();
    vi.stubGlobal("window", {
      indexedDB: globalThis.indexedDB,
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
      dispatchEvent: () => true,
    });
  });

  afterEach(async () => {
    const { __resetForTests } = await import("./db");
    await __resetForTests();
    vi.unstubAllGlobals();
  });

  it("copies session and grade-log data from localStorage into IDB", async () => {
    store.set(SESSION_LS_KEY, '{"cards":[]}');
    store.set(GRADE_LOG_LS_KEY, "[]");
    const { migrateFromLocalStorage, idbGet } = await import("./db");
    await migrateFromLocalStorage();
    expect(await idbGet(SESSION_LS_KEY)).toBe('{"cards":[]}');
    expect(await idbGet(GRADE_LOG_LS_KEY)).toBe("[]");
  });

  it("removes both localStorage keys after migration", async () => {
    store.set(SESSION_LS_KEY, "session-data");
    store.set(GRADE_LOG_LS_KEY, "log-data");
    const { migrateFromLocalStorage } = await import("./db");
    await migrateFromLocalStorage();
    expect(store.has(SESSION_LS_KEY)).toBe(false);
    expect(store.has(GRADE_LOG_LS_KEY)).toBe(false);
  });

  it("is idempotent - a second call does not overwrite IDB data", async () => {
    store.set(SESSION_LS_KEY, "first-session");
    const { migrateFromLocalStorage, idbGet } = await import("./db");
    await migrateFromLocalStorage();
    // localStorage keys are removed; seed a new (stale) value then re-run.
    store.set(SESSION_LS_KEY, "second-session");
    await migrateFromLocalStorage();
    // The value written in the first migration must be preserved.
    expect(await idbGet(SESSION_LS_KEY)).toBe("first-session");
  });

  it("migrates session data only when grade-log key is absent", async () => {
    store.set(SESSION_LS_KEY, "session-only");
    const { migrateFromLocalStorage, idbGet } = await import("./db");
    await migrateFromLocalStorage();
    expect(await idbGet(SESSION_LS_KEY)).toBe("session-only");
    expect(await idbGet(GRADE_LOG_LS_KEY)).toBeNull();
    expect(store.has(SESSION_LS_KEY)).toBe(false);
  });

  it("is a no-op when both localStorage keys are absent", async () => {
    const { migrateFromLocalStorage } = await import("./db");
    // Should not throw, and a second call should also not throw.
    await expect(migrateFromLocalStorage()).resolves.toBeUndefined();
    await expect(migrateFromLocalStorage()).resolves.toBeUndefined();
  });
});

describe("migrateFromLocalStorage - short-circuits when idbAvailable is false", () => {
  beforeEach(() => {
    vi.resetModules();
    stubWindow();
    vi.doMock("idb", () => ({
      openDB: vi.fn().mockRejectedValue(new DOMException("QuotaExceededError")),
    }));
  });

  afterEach(() => {
    vi.doUnmock("idb");
    vi.unstubAllGlobals();
  });

  it("does not throw and is a no-op when IDB is unavailable", async () => {
    const { openAppDb, isIdbAvailable, migrateFromLocalStorage } = await import("./db");
    await openAppDb().catch(() => {}); // flip idbAvailable to false
    expect(isIdbAvailable()).toBe(false);
    await expect(migrateFromLocalStorage()).resolves.toBeUndefined();
  });
});
