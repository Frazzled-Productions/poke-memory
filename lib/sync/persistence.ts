const STORAGE_KEY = "poke-memory:sync-status:v1";

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

export function saveSyncStatus(status: SyncStatus): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(status));
  } catch {
    // storage full or unavailable — best effort
  }
}
