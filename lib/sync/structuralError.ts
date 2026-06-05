/**
 * Standalone structural-error state module for the card_reviews sync path (#1358).
 *
 * Extracted here so that cloud.ts can import directly - without creating a circular
 * dependency through persistence.ts. The import chain is:
 *
 *   persistence.ts  →  cloud.ts  (via toCloudRows)
 *   cloud.ts        →  structuralError.ts  (this module)
 *   persistence.ts  re-exports from structuralError.ts  (no new cycle)
 *
 * This module reads and writes only the `structuralSyncError` field of SyncStatus.
 * It intentionally does NOT import from persistence.ts or cloud.ts.
 *
 * The session-scoped self-heal probe guard also lives here so both
 * usePerGradeSync (drainQueue) and useOnlineReconnectSync ('online' handler)
 * can reset it from the same slot (#1358 FIX 3).
 */

import { KEY_SYNC_STATUS } from "@/lib/storage/keys";
import { readLocalStorage } from "@/lib/storage/readLocalStorage";
import { writeLocalStorage } from "@/lib/storage/writeLocalStorage";

/**
 * Session-scoped self-heal probe guard (#1358 FIX 3).
 *
 * When structuralSyncError is set, the drain queue normally short-circuits.
 * But a deploy fix may land while the user stays continuously online (the
 * 'online' event never fires, so useOnlineReconnectSync cannot clear the
 * flag). To self-heal without user action, the drain queue is allowed ONE
 * probe attempt per app-load. If the probe succeeds, pushSingleCard /
 * pushSession call clearStructuralSyncError automatically.
 *
 * Module-level so the guard survives hook re-mounts (matches SPA lifetime).
 * The 'online' event resets this guard via resetStructuralProbe() so
 * useOnlineReconnectSync can act as a natural reset point in addition to the
 * one-per-load probe in usePerGradeSync.
 */
let _structuralProbeAttempted = false;

/** Returns true if the session-scoped probe has already been attempted. */
export function hasStructuralProbeBeenAttempted(): boolean {
  return _structuralProbeAttempted;
}

/** Marks the session-scoped probe as attempted. */
export function markStructuralProbeAttempted(): void {
  _structuralProbeAttempted = true;
}

/**
 * Resets the session-scoped probe guard. Call this from useOnlineReconnectSync
 * when the 'online' event fires, so the next drainQueue after reconnection is
 * treated as a fresh probe opportunity (the deploy fix is more likely to have
 * landed now that connectivity was interrupted).
 */
export function resetStructuralProbe(): void {
  _structuralProbeAttempted = false;
}

/**
 * Reads the structural-sync-error code from the persisted SyncStatus.
 * Returns null when no structural error is recorded, or when SyncStatus cannot
 * be parsed (treats absence as no error - safe default).
 */
export function getStructuralSyncError(): string | null {
  return readLocalStorage(
    KEY_SYNC_STATUS,
    (raw) => {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== "object" || parsed === null) return null;
      const obj = parsed as Record<string, unknown>;
      return typeof obj.structuralSyncError === "string" ? obj.structuralSyncError : null;
    },
    null,
  );
}

/**
 * Merges a new field value into the SyncStatus stored in localStorage.
 * Reads → mutates the relevant field → writes back atomically (within a single
 * synchronous call). Other SyncStatus fields are preserved as-is.
 */
function patchSyncStatus(patch: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const current = readLocalStorage(
    KEY_SYNC_STATUS,
    (raw) => {
      const p: unknown = JSON.parse(raw);
      return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
    },
    {} as Record<string, unknown>,
  );
  const next = { ...current, ...patch };
  // writeLocalStorage handles the SSR guard + try/catch for the write.
  writeLocalStorage(KEY_SYNC_STATUS, next);

  // Dispatch a synthetic StorageEvent so same-tab subscribers (useLocalStorageKey)
  // receive the update - the browser only fires the native event in OTHER tabs.
  // Re-reads after the write so newValue reflects the actually-stored form (the
  // defensive re-read convention used throughout the sync layer).
  try {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: KEY_SYNC_STATUS,
        storageArea: window.localStorage,
        newValue: window.localStorage.getItem(KEY_SYNC_STATUS),
      }),
    );
  } catch {
    // Non-standard environments without a StorageEvent constructor - ignore.
  }
}

/**
 * Records a structural (non-transient) error on the card_reviews primary path.
 * Call this IMMEDIATELY when a push returns a structural SQLSTATE (42xxx,
 * 23505, 23503) - do not wait for FAILURE_THRESHOLD consecutive drains.
 *
 * Also flips `lastPushFailed` and stamps `lastPushAttemptAt` so the generic
 * failure banner does not show stale state during a structural incident.
 *
 * IMPORTANT: Only call this from the card_reviews push path. Auxiliary legs
 * (pushSettings, pushStreak, pushGradeLog, pushRegionalPrefs) must warn-and-
 * continue regardless of error code.
 */
export function markStructuralSyncError(code: string, at = new Date().toISOString()): void {
  patchSyncStatus({
    lastPushAttemptAt: at,
    lastPushFailed: true,
    structuralSyncError: code,
  });
}

/**
 * Clears the structural sync error. Call only when a card_reviews push succeeds,
 * proving the schema mismatch has been resolved.
 *
 * Callers on the card_reviews success path should call this directly.
 * Auxiliary-leg success paths must NOT call this - use `markPushSucceeded`
 * from persistence.ts for those (which deliberately leaves structuralSyncError
 * intact, see FIX 2 / #1358 review).
 */
export function clearStructuralSyncError(): void {
  if (typeof window === "undefined") return;
  // Only write if something is actually set - avoids a spurious StorageEvent.
  const current = getStructuralSyncError();
  if (current === null) return;
  patchSyncStatus({ structuralSyncError: null });
}
