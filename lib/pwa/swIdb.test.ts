/**
 * Unit tests for lib/pwa/swIdb.ts.
 *
 * Placement: lib/ so the "node" vitest project picks it up (node env +
 * fake-indexeddb polyfill via vitest.setup.node.ts). No DOM required.
 *
 * Focus areas (#1845 regression fix):
 *   1. Singleton: concurrent calls to openSwIdb() return the same promise /
 *      connection, preventing multiple concurrent IDB opens from blocking each
 *      other's upgrade handler.
 *   2. Blocked-upgrade timeout: when onblocked fires, the promise rejects after
 *      SW_IDB_OPEN_TIMEOUT_MS and the singleton is nulled so subsequent calls
 *      can retry.
 *   3. Network fallback: when openSwIdb() rejects (open error OR blocked
 *      timeout), the caller receives a rejection and must fall through to fetch.
 *      The sprite handler's Promise.race() covers this; here we confirm the
 *      rejection propagates from the helper.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DB_NAME = "poke-memory-sw-test";
const DB_VERSION = 2;

/** Delete the fake IDB database between tests. */
async function deleteTestDb(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // DB did not exist
  });
}

/** A minimal onUpgrade that creates a single "kv" store. */
function onUpgrade(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1 && !db.objectStoreNames.contains("kv")) {
    db.createObjectStore("kv");
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("openSwIdb - singleton and resilience", () => {
  beforeEach(async () => {
    vi.resetModules();
    await deleteTestDb();
  });

  afterEach(async () => {
    const { _resetSwIdbForTests } = await import("./swIdb");
    _resetSwIdbForTests();
    vi.useRealTimers();
  });

  it("returns the same promise on concurrent calls (singleton)", async () => {
    const { openSwIdb } = await import("./swIdb");
    const idb = globalThis.indexedDB;

    const p1 = openSwIdb(idb, DB_NAME, DB_VERSION, onUpgrade);
    const p2 = openSwIdb(idb, DB_NAME, DB_VERSION, onUpgrade);

    // Both calls must return the identical promise object - no second IDB open.
    expect(p1).toBe(p2);

    const db = await p1;
    expect(db).toBeDefined();
  });

  it("subsequent awaited calls return the same open connection", async () => {
    const { openSwIdb } = await import("./swIdb");
    const idb = globalThis.indexedDB;

    const db1 = await openSwIdb(idb, DB_NAME, DB_VERSION, onUpgrade);
    const db2 = await openSwIdb(idb, DB_NAME, DB_VERSION, onUpgrade);

    // Must be the exact same IDBDatabase instance.
    expect(db1).toBe(db2);
  });

  it("only calls indexedDB.open() once for multiple concurrent calls", async () => {
    const { openSwIdb } = await import("./swIdb");
    const idb = globalThis.indexedDB;
    const openSpy = vi.spyOn(idb, "open");

    // Fire three concurrent opens.
    const [db1, db2, db3] = await Promise.all([
      openSwIdb(idb, DB_NAME, DB_VERSION, onUpgrade),
      openSwIdb(idb, DB_NAME, DB_VERSION, onUpgrade),
      openSwIdb(idb, DB_NAME, DB_VERSION, onUpgrade),
    ]);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(db1).toBe(db2);
    expect(db2).toBe(db3);
  });

  it("nulls the singleton and rejects on open error, allowing a retry", async () => {
    const { openSwIdb, _swIdbPromise: initialPromise } = await import("./swIdb");
    expect(initialPromise).toBeNull();

    // Stub the IDB factory to return an immediately-erroring request.
    const errorRequest = {
      onupgradeneeded: null as ((event: IDBVersionChangeEvent) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onsuccess: null as ((event: Event) => void) | null,
      onblocked: null as ((event: Event) => void) | null,
    };
    const failingFactory: import("./swIdb").IDBFactoryLike = {
      open: () => {
        // Trigger onerror asynchronously, mirroring real IDB behaviour.
        setTimeout(() => {
          if (errorRequest.onerror) {
            errorRequest.onerror(new Event("error"));
          }
        }, 0);
        return errorRequest as unknown as IDBOpenDBRequest;
      },
    };

    await expect(
      openSwIdb(failingFactory, DB_NAME, DB_VERSION, onUpgrade),
    ).rejects.toThrow(/IDB open failed/);

    // After rejection, the singleton must be null so a retry can be made.
    const { _swIdbPromise: afterFailure } = await import("./swIdb");
    expect(afterFailure).toBeNull();
  });

  it("rejects after SW_IDB_OPEN_TIMEOUT_MS when onblocked fires, then allows retry", async () => {
    vi.useFakeTimers();

    const { openSwIdb, SW_IDB_OPEN_TIMEOUT_MS } = await import("./swIdb");

    // Stub a request that fires onblocked but never resolves.
    let capturedOnBlocked: (() => void) | null = null;
    const blockedRequest = {
      onupgradeneeded: null,
      onerror: null,
      onsuccess: null,
      set onblocked(fn: (() => void) | null) {
        capturedOnBlocked = fn;
      },
      get onblocked() { return capturedOnBlocked; },
    };
    const blockingFactory: import("./swIdb").IDBFactoryLike = {
      open: () => {
        // Trigger onblocked asynchronously.
        setTimeout(() => {
          if (capturedOnBlocked) capturedOnBlocked();
        }, 10);
        return blockedRequest as unknown as IDBOpenDBRequest;
      },
    };

    const openPromise = openSwIdb(blockingFactory, DB_NAME, DB_VERSION, onUpgrade);

    // Advance past the onblocked trigger.
    vi.advanceTimersByTime(50);
    // Advance past the timeout.
    vi.advanceTimersByTime(SW_IDB_OPEN_TIMEOUT_MS + 100);

    await expect(openPromise).rejects.toThrow(/blocked.*timed out/i);

    // Singleton must be null after the timeout rejection.
    const { _swIdbPromise: afterTimeout } = await import("./swIdb");
    expect(afterTimeout).toBeNull();
  });
});
