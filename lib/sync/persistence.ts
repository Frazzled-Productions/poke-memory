export const STORAGE_KEY = "poke-memory:sync-status:v1";

export type SyncStatus = {
  lastPushAt: string | null;
  lastPushFailed: boolean;
  lastPushAttemptAt: string | null;
  /** Number of cards that failed the unload safety-net push. null = full-session failure or legacy record. */
  failedCardCount: number | null;
  /** ISO timestamp of the last successful background pull from cloud. Stored from server updated_at to avoid clock-skew. */
  lastPullAt: string | null;
};

const ZERO: SyncStatus = {
  lastPushAt: null,
  lastPushFailed: false,
  lastPushAttemptAt: null,
  failedCardCount: null,
  lastPullAt: null,
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

export function saveSyncStatus(status: SyncStatus): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(status));
  } catch {
    // storage full or unavailable — best effort
    return;
  }

  // Same-tab subscribers (useSyncStatusKey) require a synthetic StorageEvent —
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
