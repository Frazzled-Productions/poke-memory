/**
 * Unit tests for lib/pwa/offlineStore.ts.
 *
 * Placement rationale: the test file lives in lib/ so the "node" vitest
 * project picks it up. The node setup file (vitest.setup.node.ts) installs
 * fake-indexeddb/auto, which polyfills IndexedDB on globalThis - no DOM is
 * required.
 *
 * Each test case:
 *   1. Calls vi.resetModules() so the module-level _dbPromise singleton is
 *      cleared (matching the pattern in lib/idb/db.test.ts).
 *   2. Deletes the "poke-memory" database so state does not leak between cases.
 *   3. Stubs globalThis.window so the `typeof window === "undefined"` guard in
 *      offlineStore.ts passes and openOfflineDb() proceeds to open the DB.
 *   4. Dynamically imports the module to get a fresh instance.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Delete the fake poke-memory IDB database between tests. */
async function deleteIdbDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = globalThis.indexedDB.deleteDatabase("poke-memory");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // unblocked = DB did not exist
  });
}

/**
 * Stub globalThis.window so the `typeof window === "undefined"` guard in
 * offlineStore.ts passes. Also exposes the polyfilled indexedDB.
 */
function stubWindow(): void {
  vi.stubGlobal("window", {
    indexedDB: globalThis.indexedDB,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("offlineStore (put / get / has / clear)", () => {
  beforeEach(async () => {
    vi.resetModules();
    await deleteIdbDatabase();
    stubWindow();
  });

  afterEach(async () => {
    // Use the current module instance to reset the singleton before unstubbing.
    const { _resetOfflineStoreForTests } = await import("./offlineStore");
    _resetOfflineStoreForTests();
    vi.unstubAllGlobals();
  });

  it("offlinePut stores an entry and offlineGet retrieves it", async () => {
    const { offlinePut, offlineGet } = await import("./offlineStore");

    const url = "/sprites/pokemon/webp/25/320.webp";
    const blob = new Blob(["fake-image"], { type: "image/webp" });
    await offlinePut(url, { blob, contentType: "image/webp" });

    const entry = await offlineGet(url);
    expect(entry).not.toBeNull();
    expect(entry?.contentType).toBe("image/webp");
    expect(entry?.blob).toBeInstanceOf(Blob);
  });

  it("offlineGet returns null for a missing key", async () => {
    const { offlineGet } = await import("./offlineStore");

    const entry = await offlineGet("/sprites/pokemon/webp/99/320.webp");
    expect(entry).toBeNull();
  });

  it("offlineHas returns true after offlinePut", async () => {
    const { offlinePut, offlineHas } = await import("./offlineStore");

    const url = "/cries/25.ogg";
    await offlinePut(url, { blob: new Blob(["audio"]), contentType: "audio/ogg" });

    const exists = await offlineHas(url);
    expect(exists).toBe(true);
  });

  it("offlineHas returns false for a missing key", async () => {
    const { offlineHas } = await import("./offlineStore");

    const exists = await offlineHas("/cries/9999.ogg");
    expect(exists).toBe(false);
  });

  it("offlineClear removes all entries", async () => {
    const { offlinePut, offlineGet, offlineHas, offlineClear } = await import("./offlineStore");

    const url1 = "/sprites/pokemon/webp/1/64.webp";
    const url2 = "/cries/1.ogg";
    await offlinePut(url1, { blob: new Blob(["a"]), contentType: "image/webp" });
    await offlinePut(url2, { blob: new Blob(["b"]), contentType: "audio/ogg" });

    await offlineClear();

    expect(await offlineGet(url1)).toBeNull();
    expect(await offlineHas(url2)).toBe(false);
  });

  it("offlineGet returns null for a stored value with wrong shape (no blob field)", async () => {
    // Directly insert a malformed value into IDB via the raw DB to simulate a
    // corrupted or schema-mismatched entry. offlineGet must return null, not throw.
    const { openOfflineDb, offlineGet, OFFLINE_IDB_STORE } = await import("./offlineStore");

    const db = await openOfflineDb();
    if (db) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(OFFLINE_IDB_STORE, "readwrite");
        const req = tx.objectStore(OFFLINE_IDB_STORE).put(
          { notABlob: "hello", contentType: "text/plain" },
          "/bad-entry",
        );
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }

    const entry = await offlineGet("/bad-entry");
    expect(entry).toBeNull();
  });

  it("offlinePut is idempotent - second put overwrites the first", async () => {
    const { offlinePut, offlineGet } = await import("./offlineStore");

    const url = "/sprites/pokemon/webp/4/320.webp";
    const blob1 = new Blob(["v1"]);
    const blob2 = new Blob(["version-two"]);

    await offlinePut(url, { blob: blob1, contentType: "image/webp" });
    await offlinePut(url, { blob: blob2, contentType: "image/webp" });

    const entry = await offlineGet(url);
    expect(entry).not.toBeNull();
    // The second blob should be stored (size differs from the first).
    expect(entry?.blob.size).toBe(blob2.size);
    expect(entry?.blob.size).not.toBe(blob1.size);
  });

  it("openOfflineDb returns null when window is undefined (server-side guard)", async () => {
    // Unstub window so the server guard in openOfflineDb() triggers.
    vi.unstubAllGlobals();
    vi.resetModules();

    // Re-stub window as undefined to simulate SSR.
    vi.stubGlobal("window", undefined);
    const { openOfflineDb } = await import("./offlineStore");
    const db = await openOfflineDb();
    expect(db).toBeNull();
  });

});

// ---------------------------------------------------------------------------
// offlineCount helper
// ---------------------------------------------------------------------------

describe("offlineCount", () => {
  beforeEach(async () => {
    vi.resetModules();
    await deleteIdbDatabase();
    stubWindow();
  });

  afterEach(async () => {
    const { _resetOfflineStoreForTests } = await import("./offlineStore");
    _resetOfflineStoreForTests();
    vi.unstubAllGlobals();
  });

  it("returns 0 for an empty store", async () => {
    const { offlineCount } = await import("./offlineStore");
    const count = await offlineCount();
    expect(count).toBe(0);
  });

  it("returns the correct count after entries are added", async () => {
    const { offlinePut, offlineCount } = await import("./offlineStore");

    await offlinePut("/sprites/pokemon/webp/1/320.webp", {
      blob: new Blob(["a"]),
      contentType: "image/webp",
    });
    await offlinePut("/cries/1.ogg", {
      blob: new Blob(["b"]),
      contentType: "audio/ogg",
    });

    const count = await offlineCount();
    expect(count).toBe(2);
  });

  it("returns 0 after offlineClear", async () => {
    const { offlinePut, offlineClear, offlineCount } = await import("./offlineStore");

    await offlinePut("/sprites/pokemon/webp/2/320.webp", {
      blob: new Blob(["data"]),
      contentType: "image/webp",
    });

    await offlineClear();
    const count = await offlineCount();
    expect(count).toBe(0);
  });

  it("throws when IDB is unavailable (server-side guard)", async () => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.stubGlobal("window", undefined);

    const { offlineCount } = await import("./offlineStore");
    await expect(offlineCount()).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Concern A - offlinePut must REJECT on IDB write error
// ---------------------------------------------------------------------------
//
// When the IDB transaction.objectStore() call throws (e.g. no such store, or
// quota exceeded), offlinePut must reject so fetchAndStore's try/catch
// surfaces the failure. Previously offlinePut swallowed these errors by
// calling resolve() unconditionally.

describe("offlinePut rejects on write error (Concern A)", () => {
  beforeEach(async () => {
    vi.resetModules();
    await deleteIdbDatabase();
    stubWindow();
  });

  afterEach(async () => {
    const { _resetOfflineStoreForTests } = await import("./offlineStore");
    _resetOfflineStoreForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await deleteIdbDatabase();
  });

  it("offlinePut rejects when transaction().objectStore() throws synchronously", async () => {
    // Open the DB at v2 normally first so openOfflineDb() resolves to a real DB.
    const { openOfflineDb, offlinePut, OFFLINE_IDB_STORE } = await import("./offlineStore");

    const db = await openOfflineDb();
    expect(db).not.toBeNull();

    // Patch the db's `transaction` method to throw, simulating an IDB error
    // such as a missing store or quota exceeded during the transaction open.
    const originalTransaction = db!.transaction.bind(db);
    const thrownError = new DOMException("NotFoundError", "NotFoundError");
    (db as unknown as Record<string, unknown>).transaction = () => {
      throw thrownError;
    };

    const blob = new Blob(["data"], { type: "image/webp" });
    await expect(
      offlinePut("/sprites/pokemon/webp/25/320.webp", { blob, contentType: "image/webp" }),
    ).rejects.toBeTruthy();

    // Restore for cleanup.
    (db as unknown as Record<string, unknown>).transaction = originalTransaction;

    // Sanity-check: normal put still works after restoring.
    await expect(
      offlinePut("/sprites/pokemon/webp/25/320.webp", { blob, contentType: "image/webp" }),
    ).resolves.toBeUndefined();

    // Verify the value is actually in the store.
    const { offlineHas } = await import("./offlineStore");
    expect(await offlineHas("/sprites/pokemon/webp/25/320.webp")).toBe(true);
    void OFFLINE_IDB_STORE; // used for type reference only
  });
});

// ---------------------------------------------------------------------------
// Concern B - write-key / read-key format contract (Blocker 1 regression guard)
// ---------------------------------------------------------------------------
//
// precache.ts (write side) uses RELATIVE paths (e.g. "/sprites/...") produced
// by spriteVariantUrl().
// app/sw.ts (read side) looks up blobs via `new URL(request.url).pathname`,
// which is also the RELATIVE path.
// Both sides must use the same key format so IDB lookups hit.

describe("key-format contract: precache write-key matches SW read-key", () => {
  it("spriteVariantUrl produces a relative path that equals the SW pathname extraction", async () => {
    // This mirrors the exact transformation the SW now applies:
    //   key = new URL(request.url).pathname
    // where request.url is the absolute URL.
    const { spriteVariantUrl } = await import("@/lib/sprites/url");

    const relativeKey = spriteVariantUrl(25, 320);

    // Verify the write-side produces a relative path.
    expect(relativeKey).toBe("/sprites/pokemon/webp/25/320.webp");
    expect(relativeKey.startsWith("/")).toBe(true);
    expect(relativeKey.startsWith("http")).toBe(false);

    // Simulate the SW read-side transform: new URL(absoluteUrl).pathname
    const origin = "https://pokememory.com";
    const absoluteUrl = `${origin}${relativeKey}`;
    const swKey = new URL(absoluteUrl).pathname;

    // The two keys must be identical - if they differ the IDB lookup misses.
    expect(swKey).toBe(relativeKey);
  });

  it("cry URL format also matches on both sides", async () => {
    // Cries use a simple path: /cries/<id>.ogg
    const relativeKey = "/cries/25.ogg";
    const absoluteUrl = `https://pokememory.com${relativeKey}`;
    const swKey = new URL(absoluteUrl).pathname;

    expect(swKey).toBe(relativeKey);
  });
});
