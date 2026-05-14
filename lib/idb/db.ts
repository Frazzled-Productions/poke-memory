import { openDB, type IDBPDatabase } from "idb";

// Module-level availability flag. Set to false on the first open() failure
// so subsequent calls fall back to localStorage gracefully.
let idbAvailable = true;
let dbPromise: Promise<IDBPDatabase> | null = null;

const DB_NAME = "poke-memory";
const DB_VERSION = 1;
const STORE_NAME = "kv";

/** Opens the poke-memory database at version 1 with a `kv` object store. */
export function openAppDb(): Promise<IDBPDatabase> {
  if (typeof window === "undefined") {
    // Server-side: return a promise that never resolves — all callers guard on
    // `typeof window === "undefined"` before calling, so this is never awaited.
    return new Promise(() => {});
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    }).catch((err) => {
      console.warn("[poke-memory] IndexedDB unavailable, falling back to localStorage:", err);
      idbAvailable = false;
      dbPromise = null;
      return Promise.reject(err);
    });
  }
  return dbPromise;
}

/** Returns true when IndexedDB opened successfully. */
export function isIdbAvailable(): boolean {
  return idbAvailable;
}

/** Gets a value from the kv store. Returns null when unavailable or missing. */
export async function idbGet(key: string): Promise<string | null> {
  if (typeof window === "undefined" || !idbAvailable) return null;
  try {
    const db = await openAppDb();
    const val: unknown = await db.get(STORE_NAME, key);
    return typeof val === "string" ? val : null;
  } catch (err) {
    console.warn("[poke-memory] idbGet failed:", err);
    return null;
  }
}

/** Puts a string value into the kv store. No-ops on failure. */
export async function idbSet(key: string, value: string): Promise<void> {
  if (typeof window === "undefined" || !idbAvailable) return;
  try {
    const db = await openAppDb();
    await db.put(STORE_NAME, value, key);
  } catch (err) {
    console.warn("[poke-memory] idbSet failed:", err);
  }
}

/** Deletes a key from the kv store. No-ops on failure. */
export async function idbDelete(key: string): Promise<void> {
  if (typeof window === "undefined" || !idbAvailable) return;
  try {
    const db = await openAppDb();
    await db.delete(STORE_NAME, key);
  } catch (err) {
    console.warn("[poke-memory] idbDelete failed:", err);
  }
}

/**
 * Atomically reads, transforms, and writes a single key in the kv store.
 * Prevents lost-write races when concurrent callers modify the same key
 * (e.g. rapid grade double-taps or background-sync overlapping a grade).
 * No-ops when IDB is unavailable.
 */
export async function idbReadModifyWrite(
  key: string,
  transform: (current: string | null) => string,
): Promise<void> {
  if (typeof window === "undefined" || !idbAvailable) return;
  try {
    const db = await openAppDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const val: unknown = await tx.store.get(key);
    const current = typeof val === "string" ? val : null;
    await tx.store.put(transform(current), key);
    await tx.done;
  } catch (err) {
    console.warn("[poke-memory] idbReadModifyWrite failed:", err);
  }
}

/**
 * Closes the open DB connection and resets the module-level state.
 * Only call from tests — not for production use.
 */
export async function __resetForTests(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // ignore
    }
    dbPromise = null;
  }
  idbAvailable = true;
}

const MIGRATION_FLAG_KEY = "migration_done_v1";
const SESSION_LS_KEY = "poke-memory:review-session:v1";
const GRADE_LOG_LS_KEY = "poke-memory:grade-log:v1";

/**
 * One-time migration from localStorage to IndexedDB. Idempotent: checks
 * `migration_done_v1` in IndexedDB before copying. If already set, returns
 * immediately.
 *
 * Handles two-tab races by setting the flag and moving data in a single
 * IndexedDB transaction so a second tab opening concurrently will find the
 * flag already set and bail.
 */
export async function migrateFromLocalStorage(): Promise<void> {
  if (typeof window === "undefined" || !idbAvailable) return;

  try {
    const db = await openAppDb();

    // Check the flag first with a separate read so we can bail cheaply.
    const alreadyDone: unknown = await db.get(STORE_NAME, MIGRATION_FLAG_KEY);
    if (alreadyDone === true) return;

    // Read both values from localStorage before opening the transaction.
    const sessionRaw = window.localStorage.getItem(SESSION_LS_KEY);
    const gradeLogRaw = window.localStorage.getItem(GRADE_LOG_LS_KEY);

    // Single readwrite transaction: set the flag + copy data atomically.
    // If another tab races and the tx fails, the next open will retry.
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.store;

    // Re-check inside the transaction to close the race window.
    const flagInTx: unknown = await store.get(MIGRATION_FLAG_KEY);
    if (flagInTx === true) {
      tx.abort();
      // Consuming the rejection from tx.done prevents an unhandled-promise
      // warning — aborting always causes tx.done to reject with AbortError.
      await tx.done.catch(() => {});
      return;
    }

    await store.put(true, MIGRATION_FLAG_KEY);
    if (sessionRaw !== null) {
      await store.put(sessionRaw, SESSION_LS_KEY);
    }
    if (gradeLogRaw !== null) {
      await store.put(gradeLogRaw, GRADE_LOG_LS_KEY);
    }
    await tx.done;

    // Only delete from localStorage after the IDB write committed.
    if (sessionRaw !== null) {
      window.localStorage.removeItem(SESSION_LS_KEY);
    }
    if (gradeLogRaw !== null) {
      window.localStorage.removeItem(GRADE_LOG_LS_KEY);
    }
  } catch (err) {
    // A migration failure (malformed JSON, missing key, etc.) does NOT mean
    // IDB itself is broken — log and continue. Only openAppDb flips
    // idbAvailable to false, when the DB itself fails to open.
    console.warn("[poke-memory] migrateFromLocalStorage failed:", err);
  }
}
