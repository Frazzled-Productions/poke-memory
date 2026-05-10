const STORAGE_KEY = "poke-memory:sync-status:v1";

export type SyncStatus = {
  lastPushAt: string | null;
  lastPushFailed: boolean;
  lastPushAttemptAt: string | null;
  lastPullAt: string | null;
};

const ZERO: SyncStatus = {
  lastPushAt: null,
  lastPushFailed: false,
  lastPushAttemptAt: null,
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
