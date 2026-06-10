/**
 * Singleton IDB connection helper for the service worker.
 *
 * Extracted from app/sw.ts so the singleton and timeout logic can be unit-tested
 * without a real ServiceWorkerGlobalScope. app/sw.ts re-exports and calls these
 * functions, passing its own `self.indexedDB` as the factory argument.
 *
 * Why a singleton matters (#1845):
 *   Without caching the open promise, every concurrent sprite/cry request during
 *   a card-grid render calls indexedDB.open() independently. Multiple concurrent
 *   opens on the same DB name block each other's v1→v2 upgrade handler, leaving
 *   ALL of their promises permanently pending. Cards and the Pokédex grid then
 *   never finish rendering because the sprite Response promises never resolve.
 *
 * The fix mirrors lib/pwa/offlineStore.ts::openOfflineDb (the client-side twin),
 * which already uses the same singleton pattern.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * How long (ms) the singleton open is allowed to block (e.g. due to a stale
 * v1 connection) before the sprite handler falls through to a network fetch.
 * Callers that need a timeout should race `openSwIdb(...)` themselves.
 */
export const SW_IDB_OPEN_TIMEOUT_MS = 1500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal IDB factory surface needed by the helper.
 * Matches the shape of both `self.indexedDB` (SW) and `globalThis.indexedDB`
 * (tests with fake-indexeddb).
 */
export interface IDBFactoryLike {
  open(name: string, version?: number): IDBOpenDBRequest;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/**
 * Cached open-connection promise. Null means no connection is held yet, or the
 * previous one was invalidated by a version-change or close event.
 *
 * Exported only for tests that need to reset between runs. Do not mutate from
 * production code outside this module.
 */
export let _swIdbPromise: Promise<IDBDatabase> | null = null;

/** Reset the singleton (test use only). */
export function _resetSwIdbForTests(): void {
  if (_swIdbPromise) {
    void _swIdbPromise
      .then((db) => {
        try { db.close(); } catch { /* ignore */ }
      })
      .catch(() => undefined);
    _swIdbPromise = null;
  }
}

// ---------------------------------------------------------------------------
// Core open helper
// ---------------------------------------------------------------------------

/**
 * Opens `dbName` at `dbVersion` using `idbFactory`, caching the resulting
 * connection as a module-level singleton. Concurrent calls return the same
 * promise so only one `indexedDB.open()` is ever in flight at a time.
 *
 * On success the returned `IDBDatabase` has an `onversionchange` handler that
 * closes the connection and nulls the singleton, allowing the next call to
 * reopen at the new version.
 *
 * On `onblocked` (a stale connection elsewhere is blocking the upgrade), the
 * promise rejects after `SW_IDB_OPEN_TIMEOUT_MS` and the singleton is nulled
 * so the next call can retry. This prevents sprite handlers from hanging
 * indefinitely when an old tab holds the DB open during an upgrade.
 *
 * @param idbFactory  The IDB factory to use (`self.indexedDB` in the SW,
 *                    `globalThis.indexedDB` in tests).
 * @param dbName      Database name (e.g. `"poke-memory"`).
 * @param dbVersion   Target version (e.g. `2`).
 * @param onUpgrade   Called during `onupgradeneeded` to create/migrate stores.
 */
export function openSwIdb(
  idbFactory: IDBFactoryLike,
  dbName: string,
  dbVersion: number,
  onUpgrade: (db: IDBDatabase, oldVersion: number) => void,
): Promise<IDBDatabase> {
  if (_swIdbPromise) return _swIdbPromise;

  _swIdbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let blockedTimer: ReturnType<typeof setTimeout> | null = null;

    const clearBlockedTimer = () => {
      if (blockedTimer !== null) {
        clearTimeout(blockedTimer);
        blockedTimer = null;
      }
    };

    try {
      const request = idbFactory.open(dbName, dbVersion);

      request.onupgradeneeded = (event) => {
        clearBlockedTimer();
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
        onUpgrade(db, oldVersion);
      };

      request.onerror = () => {
        clearBlockedTimer();
        _swIdbPromise = null;
        reject(new Error(`[sw-idb] IDB open failed for "${dbName}"`));
      };

      request.onsuccess = (event) => {
        clearBlockedTimer();
        const db = (event.target as IDBOpenDBRequest).result;
        // When another context fires a version-change (future v3 upgrade),
        // close the connection and null the singleton so the next caller
        // reopens at the new version.
        db.onversionchange = () => {
          db.close();
          _swIdbPromise = null;
        };
        resolve(db);
      };

      request.onblocked = () => {
        // A stale connection elsewhere is blocking the upgrade. Rather than
        // waiting indefinitely (which hangs sprite responses), schedule a
        // rejection so the sprite handler can fall through to network.
        console.warn(
          `[sw-idb] IDB upgrade for "${dbName}" blocked; will fall through to network after ${String(SW_IDB_OPEN_TIMEOUT_MS)} ms.`,
        );
        blockedTimer = setTimeout(() => {
          _swIdbPromise = null;
          reject(new Error(`[sw-idb] IDB open for "${dbName}" blocked - timed out`));
        }, SW_IDB_OPEN_TIMEOUT_MS);
      };
    } catch (err) {
      clearBlockedTimer();
      _swIdbPromise = null;
      reject(err);
    }
  }).catch((err) => {
    // Ensure the singleton is nulled on any unhandled rejection path so
    // retries are possible.
    _swIdbPromise = null;
    return Promise.reject(err);
  });

  return _swIdbPromise;
}
