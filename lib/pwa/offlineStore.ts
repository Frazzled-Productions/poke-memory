/**
 * IndexedDB-backed store for the offline sprite/cry pack.
 *
 * Root cause of the #1803 cold-launch hang: when the user downloads the offline
 * pack (~10,000+ entries) into Cache Storage, WebKit's `cache.match` becomes
 * globally slow - even for the render-critical precache lookups that serve the
 * app shell on cold launch. Deleting the bloated cache instantly restores
 * sub-second cold launch (device-confirmed 2026-06-10).
 *
 * Fix: store sprite and cry blobs in IndexedDB instead of Cache Storage. IDB
 * handles tens of thousands of blob records without affecting `cache.match`
 * latency. Cache Storage stays small (just the Serwist app precache + navigation
 * / data), so cold-launch serving is fast regardless of whether the pack is
 * downloaded.
 *
 * Database layout:
 *   DB name : "poke-memory"          (shared with lib/idb/db.ts)
 *   Version : 2                      (upgrade from 1 adds the "offline-pack" store)
 *   Store   : "offline-pack"
 *   Key     : URL string (e.g. "/sprites/pokemon/webp/25/320.webp")
 *   Value   : { blob: Blob; contentType: string }
 *
 * Service worker access: the SW opens the same DB via its own raw IDBFactory
 * (self.indexedDB). Both the client and the SW share the same IDB schema so
 * the client writes once and the SW reads on every sprite/cry request.
 *
 * Compatibility: IndexedDB is supported on all targeted platforms (iOS 10+,
 * Safari 10+). Blob storage in IDB is supported on Safari 14+ / iOS 14+.
 * Earlier versions fall back to network (miss = fetch from CDN, not a crash).
 *
 * This module is safe to import on the server - all functions guard on
 * `typeof window` / `typeof indexedDB`.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Shared DB name - must stay byte-identical to IDB_DB_NAME in app/sw.ts. */
export const OFFLINE_IDB_DB_NAME = "poke-memory";

/** Object store for the offline pack. */
export const OFFLINE_IDB_STORE = "offline-pack";

/**
 * DB version that introduces the "offline-pack" store.
 *
 * The existing kv store was created at version 1 by lib/idb/db.ts. We bump
 * to version 2 to add the new store without touching the kv store. Both stores
 * coexist; the IDB upgrade handler guards against re-creating the kv store
 * (it already exists at v1).
 */
export const OFFLINE_IDB_VERSION = 2;

// ---------------------------------------------------------------------------
// Value shape stored per URL
// ---------------------------------------------------------------------------

export interface OfflineEntry {
  blob: Blob;
  contentType: string;
}

// ---------------------------------------------------------------------------
// DB opening (client-side only)
// ---------------------------------------------------------------------------

/** Module-level singleton promise so we open the DB at most once per page. */
let _dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Opens the poke-memory DB at version 2, creating the "offline-pack" store
 * when upgrading from version 1 (or from scratch). Returns null on failure so
 * callers can fall back gracefully.
 *
 * Server-safe: returns null immediately when `window` or `indexedDB` is absent.
 */
export function openOfflineDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  if (!_dbPromise) {
    _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      try {
        const req = indexedDB.open(OFFLINE_IDB_DB_NAME, OFFLINE_IDB_VERSION);
        req.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          // Create the kv store if it does not exist yet (fresh install on v2).
          if (!db.objectStoreNames.contains("kv")) {
            db.createObjectStore("kv");
          }
          // Create the offline-pack store (this is the v1→v2 upgrade).
          if (!db.objectStoreNames.contains(OFFLINE_IDB_STORE)) {
            db.createObjectStore(OFFLINE_IDB_STORE);
          }
        };
        req.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
        req.onerror = () => reject(new Error("[offline-store] IDB open failed"));
        req.onblocked = () => {
          // Another tab holds the old version open. Reject so the caller falls
          // back gracefully; the upgrade will complete once the old tab closes.
          reject(new Error("[offline-store] IDB upgrade blocked"));
        };
      } catch (err) {
        reject(err);
      }
    }).catch((err) => {
      // Clear the singleton so a future call retries.
      _dbPromise = null;
      console.warn("[offline-store] IndexedDB unavailable:", err);
      return Promise.reject(err);
    });
  }
  // Wrap in a catch that returns null so callers need not handle rejection.
  return _dbPromise.catch(() => null);
}

// ---------------------------------------------------------------------------
// Read a single entry (used by the SW to serve a cached response)
// ---------------------------------------------------------------------------

/**
 * Retrieve a blob from the offline-pack store by URL.
 * Returns null on miss or any failure (the caller should fall back to network).
 *
 * Client-safe: uses the browser `indexedDB` global.
 */
export async function offlineGet(url: string): Promise<OfflineEntry | null> {
  const db = await openOfflineDb();
  if (!db) return null;
  return new Promise<OfflineEntry | null>((resolve) => {
    try {
      const tx = db.transaction(OFFLINE_IDB_STORE, "readonly");
      const req = tx.objectStore(OFFLINE_IDB_STORE).get(url);
      req.onsuccess = () => {
        const val: unknown = req.result;
        if (
          val &&
          typeof val === "object" &&
          "blob" in val &&
          val.blob instanceof Blob &&
          "contentType" in val &&
          typeof val.contentType === "string"
        ) {
          resolve(val as OfflineEntry);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// ---------------------------------------------------------------------------
// Write a single entry (used by precache.ts during download)
// ---------------------------------------------------------------------------

/**
 * Persist a blob into the offline-pack store.
 * No-ops on failure - the download continues even if IDB is unavailable.
 */
export async function offlinePut(url: string, entry: OfflineEntry): Promise<void> {
  const db = await openOfflineDb();
  if (!db) return;
  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(OFFLINE_IDB_STORE, "readwrite");
      const req = tx.objectStore(OFFLINE_IDB_STORE).put(entry, url);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// Check existence (idempotency check in precache.ts)
// ---------------------------------------------------------------------------

/**
 * Returns true when `url` is already present in the offline-pack store.
 * Returns false on miss or any failure.
 */
export async function offlineHas(url: string): Promise<boolean> {
  const db = await openOfflineDb();
  if (!db) return false;
  return new Promise<boolean>((resolve) => {
    try {
      const tx = db.transaction(OFFLINE_IDB_STORE, "readonly");
      // Use `count` on the key range to check existence without reading the blob.
      const req = tx.objectStore(OFFLINE_IDB_STORE).count(IDBKeyRange.only(url));
      req.onsuccess = () => resolve((req.result as number) > 0);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

// ---------------------------------------------------------------------------
// Delete the entire offline-pack store contents
// ---------------------------------------------------------------------------

/**
 * Clears all entries from the offline-pack store.
 * Called by the "Delete offline cache" flow in OfflineSection.
 * No-ops on failure.
 */
export async function offlineClear(): Promise<void> {
  const db = await openOfflineDb();
  if (!db) return;
  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(OFFLINE_IDB_STORE, "readwrite");
      const req = tx.objectStore(OFFLINE_IDB_STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// Reset for testing
// ---------------------------------------------------------------------------

/**
 * Resets the module-level DB singleton.
 * ONLY call from test code. Do not use in production.
 * @internal
 */
export function _resetOfflineStoreForTests(): void {
  if (_dbPromise) {
    // Best-effort close; errors are swallowed.
    void _dbPromise.then((db) => {
      if (db) db.close();
    }).catch(() => undefined);
    _dbPromise = null;
  }
}
