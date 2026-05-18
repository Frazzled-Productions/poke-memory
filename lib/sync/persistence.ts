import type { ReviewableCard } from "@/lib/review/session";

export const STORAGE_KEY = "poke-memory:sync-status:v1";
/**
 * localStorage key for the persisted pending-grade queue (#893).
 *
 * Stores the exact set of `ReviewableCard` objects that `usePerGradeSync` has
 * not yet successfully pushed to the cloud. Written on every debounce cycle
 * (with a trailing debounce so rapid grading does not thrash storage) and
 * cleared after a fully-successful drain so stale data does not accumulate.
 *
 * Only written when a real (non-superuser) session is active — a null
 * client/userId in `usePerGradeSync` causes the queue to be cleared rather
 * than persisted, ensuring a QA session never leaves fake state behind.
 */
export const PENDING_QUEUE_KEY = "poke-memory:pending-grade-queue:v1";

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
  /** ISO timestamp of the `user_settings.last_reset_at` this device has already reconciled. When cloud advances this past the local value, `pullAndMerge` calls `clearLocalProgress` before merging — that's how stale local stops resurrecting deleted rows (#576). Null = never seen a reset on this device. */
  lastSeenResetAt: string | null;
};

const ZERO: SyncStatus = {
  lastPushAt: null,
  lastPushFailed: false,
  lastPushAttemptAt: null,
  failedCardCount: null,
  lastPullAt: null,
  lastSettingsPullAt: null,
  lastSeenResetAt: null,
};

export function loadSyncStatus(): SyncStatus {
  if (typeof window === "undefined") return ZERO;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return ZERO;
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
    };
  } catch {
    return ZERO;
  }
}

/**
 * Record a successful push. Clears lastPushFailed and stamps lastPushAt.
 * Call this inside the success branch of any push path so the Stats page
 * "Last synced" indicator stays current after auto-sync runs.
 *
 * Semantics notes (#473):
 * - `failedCardCount` is intentionally left as-is on success. `useRetryPush`
 *   reads `lastPushFailed` and `failedCardCount` jointly, so a stale
 *   `failedCardCount` value is shadowed by `lastPushFailed: false`. Any future
 *   UI that reads `failedCardCount` directly must also gate on
 *   `lastPushFailed` to avoid showing a phantom failure count.
 * - `usePerGradeSync` stamps `lastPushAt` on *any-success*
 *   (`results.some(r => r.ok)`), not all-success. The "any progress is
 *   progress" semantic is deliberate — a partial-success debounced push still
 *   moved the cloud forward — and differs from the unload path, which flags
 *   failure whenever `failedCardCount > 0`.
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
 * Intentionally does not clear lastPushAt — the last successful sync timestamp
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

export function saveSyncStatus(status: SyncStatus): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(status));
  } catch {
    // storage full or unavailable — best effort
    return;
  }

  // Same-tab subscribers (useLocalStorageKey) require a synthetic StorageEvent —
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

// ─── Persisted pending-grade queue (#893) ─────────────────────────────────────
//
// `usePerGradeSync` writes the in-memory `pendingQueueRef` here on every
// debounce cycle so that the exact failed-card set survives a tab force-kill.
// The key is cleared after a fully-successful drain and is never written during
// a superuser session (null client/userId → clear instead of persist).

/**
 * Loads the persisted pending-grade queue from localStorage.
 * Returns an empty array when the key is absent, malformed, or not an array.
 * Individual entries that are not plain objects are dropped rather than
 * rejecting the whole array — partial corruption is better than total loss.
 */
export function loadPendingQueue(): ReviewableCard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PENDING_QUEUE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Keep only entries that look like ReviewableCard. Validate the minimum
    // fields needed to push a card via pushSingleCard: `id` (dedup key),
    // `cardType` and `subjectKey` (the DB primary key alongside user_id), and
    // `state` (the FSRS payload). Entries missing any of these are dropped
    // rather than rejecting the whole array — partial corruption is better
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
  } catch {
    return [];
  }
}

/**
 * Persists the pending-grade queue to localStorage. Best-effort — storage
 * errors are swallowed so a quota-full condition never interrupts the review.
 */
export function savePendingQueue(queue: ReviewableCard[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Storage full or unavailable — best effort.
  }
}

/**
 * Removes the persisted pending-grade queue from localStorage.
 * Call this after a fully-successful push so stale data does not accumulate.
 */
export function clearPendingQueue(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(PENDING_QUEUE_KEY);
  } catch {
    // Best effort.
  }
}
