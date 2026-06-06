import type { ReviewableCard } from "@/lib/review/session";
import { KEY_SYNC_STATUS, KEY_PENDING_GRADE_QUEUE } from "@/lib/storage/keys";
import { readLocalStorage } from "@/lib/storage/readLocalStorage";
import { writeLocalStorage } from "@/lib/storage/writeLocalStorage";
import { idbSet, idbDelete } from "@/lib/idb/db";
import { toCloudRows } from "@/lib/sync/cloud";

// Re-export from structuralError.ts so callers that already import from
// persistence.ts do not need to change their imports (#1358 FIX 1).
export {
  markStructuralSyncError,
  clearStructuralSyncError,
  getStructuralSyncError,
} from "@/lib/sync/structuralError";

export const STORAGE_KEY = KEY_SYNC_STATUS;
/**
 * localStorage key for the persisted pending-grade queue (#893).
 *
 * Stores the exact set of `ReviewableCard` objects that `usePerGradeSync` has
 * not yet successfully pushed to the cloud. Written on every debounce cycle
 * (with a trailing debounce so rapid grading does not thrash storage) and
 * cleared after a fully-successful drain so stale data does not accumulate.
 *
 * Only written when a real (non-superuser) session is active - a null
 * client/userId in `usePerGradeSync` causes the queue to be cleared rather
 * than persisted, ensuring a QA session never leaves fake state behind.
 */
export const PENDING_QUEUE_KEY = KEY_PENDING_GRADE_QUEUE;

export type SyncStatus = {
  lastPushAt: string | null;
  lastPushFailed: boolean;
  lastPushAttemptAt: string | null;
  /** Number of cards that failed the unload safety-net push. null = full-session failure or legacy record. */
  failedCardCount: number | null;
  /** ISO timestamp of the last successful background pull of card_reviews. Stored from server updated_at to avoid clock-skew. */
  lastPullAt: string | null;
  /** ISO timestamp of the last user_settings row this device applied (server updated_at). Tracked separately because settings live in a different table from cards and have an independent write cadence (#572). */
  lastSettingsPullAt: string | null;
  /** ISO timestamp of the `user_settings.last_reset_at` this device has already reconciled. When cloud advances this past the local value, `pullAndMerge` calls `clearLocalProgress` before merging - that's how stale local stops resurrecting deleted rows (#576). Null = never seen a reset on this device. */
  lastSeenResetAt: string | null;
  /**
   * SQLSTATE code of a structural (non-transient) error on the card_reviews
   * primary sync path (#1358). Set immediately on detection; never set by the
   * auxiliary legs (pushSettings, pushStreak, pushGradeLog, pushRegionalPrefs).
   * Non-null means retrying is pointless - the error signals a deploy/schema
   * mismatch (e.g. 42P10: ON CONFLICT column list does not match any unique
   * constraint). Only cleared when a push subsequently succeeds (structural
   * fixes require a deploy, not a user action).
   */
  structuralSyncError: string | null;
  /**
   * The Supabase user.id of the user whose data currently occupies local
   * storage on this device. null = guest/never-signed-in. Written once on
   * first sign-in (guest claim path) and updated on each account switch.
   *
   * Used by guardAccountSwitch (#1712) to detect when a different user signs
   * in and trigger the archive/restore cycle before pullAndMerge runs.
   *
   * Intentionally survives clearLocalProgress (sync-status:v1 is under
   * poke-memory:sync-status:v1, which IS wiped - but after the guard has
   * already archived and the caller writes a fresh status with the new owner).
   */
  ownerUserId: string | null;
};

const ZERO: SyncStatus = {
  lastPushAt: null,
  lastPushFailed: false,
  lastPushAttemptAt: null,
  failedCardCount: null,
  lastPullAt: null,
  lastSettingsPullAt: null,
  lastSeenResetAt: null,
  structuralSyncError: null,
  ownerUserId: null,
};

export function loadSyncStatus(): SyncStatus {
  return readLocalStorage(STORAGE_KEY, parseSyncStatus, ZERO);
}

function parseSyncStatus(raw: string): SyncStatus {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null) return ZERO;
  const obj = parsed as Record<string, unknown>;
  return {
    lastPushAt: typeof obj.lastPushAt === "string" ? obj.lastPushAt : null,
    lastPushFailed: typeof obj.lastPushFailed === "boolean" ? obj.lastPushFailed : false,
    lastPushAttemptAt: typeof obj.lastPushAttemptAt === "string" ? obj.lastPushAttemptAt : null,
    failedCardCount: Number.isInteger(obj.failedCardCount) && (obj.failedCardCount as number) >= 0 ? obj.failedCardCount as number : null,
    lastPullAt: typeof obj.lastPullAt === "string" ? obj.lastPullAt : null,
    lastSettingsPullAt: typeof obj.lastSettingsPullAt === "string" ? obj.lastSettingsPullAt : null,
    lastSeenResetAt: typeof obj.lastSeenResetAt === "string" ? obj.lastSeenResetAt : null,
    structuralSyncError: typeof obj.structuralSyncError === "string" ? obj.structuralSyncError : null,
    ownerUserId: typeof obj.ownerUserId === "string" ? obj.ownerUserId : null,
  };
}

/**
 * Record a successful push. Clears lastPushFailed and stamps lastPushAt.
 * Call this inside the success branch of ANY push path (card_reviews or
 * auxiliary legs) so the Stats page "Last synced" indicator stays current.
 *
 * Semantics notes (#473):
 * - `failedCardCount` is intentionally left as-is on success. `useRetryPush`
 *   reads `lastPushFailed` and `failedCardCount` jointly, so a stale
 *   `failedCardCount` value is shadowed by `lastPushFailed: false`. Any future
 *   UI that reads `failedCardCount` directly must also gate on
 *   `lastPushFailed` to avoid showing a phantom failure count.
 * - `usePerGradeSync` stamps `lastPushAt` on *any-success*
 *   (`results.some(r => r.ok)`), not all-success. The "any progress is
 *   progress" semantic is deliberate - a partial-success debounced push still
 *   moved the cloud forward - and differs from the unload path, which flags
 *   failure whenever `failedCardCount > 0`.
 * - `structuralSyncError` is deliberately NOT cleared here. A successful
 *   auxiliary-leg push (pushSettings, pushStreak, etc.) during a live 42P10
 *   incident must not clear the card_reviews structural banner - that would
 *   cause a false-clear flicker. Only a successful card_reviews push clears
 *   it, via clearStructuralSyncError in pushSingleCard / pushSession (#1358
 *   FIX 2). The Stats page banner correctly reads structuralSyncError from
 *   the SyncStatus record, so clearing the generic failed flag here does not
 *   hide the structural banner.
 */
export function markPushSucceeded(at = new Date().toISOString()): void {
  const current = loadSyncStatus();
  saveSyncStatus({ ...current, lastPushAt: at, lastPushFailed: false });
}

/**
 * Record a persistent push failure. Sets lastPushFailed and stamps
 * lastPushAttemptAt so the Stats page banner renders. Called by the per-grade
 * path after N consecutive all-failure drains (#606).
 *
 * Intentionally does not clear lastPushAt - the last successful sync timestamp
 * should remain visible until the user retries.
 */
export function markPushFailed(failedCardCount: number, at = new Date().toISOString()): void {
  const current = loadSyncStatus();
  saveSyncStatus({
    ...current,
    lastPushAttemptAt: at,
    lastPushFailed: true,
    failedCardCount,
  });
}

// markStructuralSyncError, clearStructuralSyncError, and getStructuralSyncError
// are re-exported from structuralError.ts above. Their implementations live
// there so cloud.ts can import them without creating a circular dependency
// through this module (#1358 FIX 1).

export function saveSyncStatus(status: SyncStatus): void {
  if (typeof window === "undefined") return;
  // writeLocalStorage handles SSR guard + try/catch. The StorageEvent dispatch
  // is kept explicit here because it re-reads the key after the write (so
  // newValue is always the serialised-and-stored form, not the pre-serialisation
  // value) - a deliberately defensive convention in the sync layer.
  writeLocalStorage(STORAGE_KEY, status);

  // Same-tab subscribers (useLocalStorageKey) require a synthetic StorageEvent - 
  // the browser only fires the native event in *other* tabs. Centralising the
  // dispatch here means every writer satisfies the invariant without remembering
  // it explicitly. Mirrors the saveSession pattern in lib/review/persistence.ts.
  try {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: STORAGE_KEY,
        storageArea: window.localStorage,
        newValue: window.localStorage.getItem(STORAGE_KEY),
      }),
    );
  } catch {
    // Older browsers / non-standard envs without a StorageEvent constructor.
    // The native cross-tab event still fires; same-tab callers can fall back
    // to polling if they need to.
  }
}

// ─── Persisted pending-grade queue (#893, #1054) ──────────────────────────────
//
// `usePerGradeSync` writes the in-memory `pendingQueueRef` here on every
// debounce cycle so that the exact failed-card set survives a tab force-kill.
// The key is cleared after a fully-successful drain and is never written during
// a superuser session (null client/userId → clear instead of persist).
//
// The queue is mirrored to IndexedDB (#1054) so the service worker can read it
// during a Background Sync event. Service workers cannot access localStorage,
// so `savePendingQueue` writes to both stores and `clearPendingQueue` clears
// both. The IDB write is fire-and-forget (async, best-effort).

/**
 * Loads the persisted pending-grade queue from localStorage.
 * Returns an empty array when the key is absent, malformed, or not an array.
 * Individual entries that are not plain objects are dropped rather than
 * rejecting the whole array - partial corruption is better than total loss.
 */
export function loadPendingQueue(): ReviewableCard[] {
  return readLocalStorage(PENDING_QUEUE_KEY, parsePendingQueue, []);
}

function parsePendingQueue(raw: string): ReviewableCard[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  // Keep only entries that look like ReviewableCard. Validate the minimum
  // fields needed to push a card via pushSingleCard: `id` (dedup key),
  // `cardType` and `subjectKey` (the DB primary key alongside user_id), and
  // `state` (the FSRS payload). Entries missing any of these are dropped
  // rather than rejecting the whole array - partial corruption is better
  // than total loss. A full schema validation is intentionally omitted;
  // the data was written by this app so the risk is malformed storage,
  // not adversarial input.
  return parsed.filter(
    (item): item is ReviewableCard =>
      typeof item === "object" &&
      item !== null &&
      "id" in item &&
      "cardType" in item &&
      typeof (item as Record<string, unknown>).cardType === "string" &&
      "subjectKey" in item &&
      typeof (item as Record<string, unknown>).subjectKey === "string" &&
      "state" in item &&
      typeof (item as Record<string, unknown>).state === "object" &&
      (item as Record<string, unknown>).state !== null,
  );
}

/**
 * Persists the pending-grade queue to localStorage AND mirrors it to
 * IndexedDB. The IDB mirror is the source the service worker reads on
 * Background Sync (#1054) - service workers cannot access localStorage, so the
 * IDB copy is required for the offline-grade-replay path. Both writes are
 * best-effort; errors are swallowed so a quota-full condition never interrupts
 * the review session.
 */
export function savePendingQueue(queue: ReviewableCard[]): void {
  if (typeof window === "undefined") return;
  writeLocalStorage(PENDING_QUEUE_KEY, queue);
  // Mirror to IDB so the service worker can read the queue on Background Sync.
  // The IDB copy is stored as CloudRow[] (snake_case, with appTypeToDbType
  // applied) because the SW cannot import app modules and must be able to POST
  // the rows to /api/sync directly without any further transformation (#1072 B1).
  // Fire-and-forget: IDB writes are async; we don't await here to avoid
  // blocking the synchronous enqueue path.
  void idbSet(PENDING_QUEUE_KEY, JSON.stringify(toCloudRows(queue)));
}

/**
 * Removes the persisted pending-grade queue from both localStorage and
 * IndexedDB. Call this after a fully-successful push so stale data does not
 * accumulate. Both deletions are best-effort.
 */
export function clearPendingQueue(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(PENDING_QUEUE_KEY);
  } catch {
    // Best effort.
  }
  // Also clear the IDB mirror so the service worker does not re-replay already-
  // pushed grades on the next Background Sync event.
  void idbDelete(PENDING_QUEUE_KEY);
}
