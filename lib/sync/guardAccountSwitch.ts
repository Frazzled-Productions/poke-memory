/**
 * guardAccountSwitch - multi-user data isolation chokepoint (#1712).
 *
 * Called in useSignInPull BEFORE pullAndMerge runs, once per non-null userId
 * transition.  It detects whether the incoming user is the same as (or
 * different from) whoever's data currently occupies local storage, and takes
 * the appropriate action:
 *
 *   ownerUserId === null (guest)      → pending-claim path.  Do nothing here;
 *                                       callback-complete stamps ownerUserId at
 *                                       the end of its resolution branches.
 *
 *   ownerUserId === incomingUserId    → same user, multi-device or re-sign-in.
 *                                       No-op; merge proceeds as before.
 *
 *   ownerUserId !== incomingUserId    → different user.  Archive outgoing user's
 *                                       full local state, wipe all per-user LS
 *                                       keys (incl. settings:*), restore incoming
 *                                       user's archive if present (else fresh),
 *                                       then write a fresh SyncStatus stamped with
 *                                       incomingUserId and null cursors so
 *                                       pullAndMerge starts from a clean slate.
 *
 * pullAndMerge reads SyncStatus.lastPullAt/lastSettingsPullAt at startup, so
 * this function MUST complete (and the new SyncStatus must be written) before
 * pullAndMerge is invoked.  useSignInPull enforces the ordering via `await`.
 */

import {
  loadSyncStatus,
  saveSyncStatus,
  type SyncStatus,
} from "@/lib/sync/persistence";
import {
  archiveUserData,
  restoreUserData,
  clearIdbPendingQueue,
} from "@/lib/storage/userArchive";
import {
  KEY_SETTINGS,
  KEY_SETTINGS_LAST_PUSHED,
} from "@/lib/storage/keys";

/** Zero SyncStatus cursors for a freshly-switched user. */
function freshSyncStatus(ownerUserId: string): SyncStatus {
  return {
    lastPushAt: null,
    lastPushFailed: false,
    lastPushAttemptAt: null,
    failedCardCount: null,
    lastPullAt: null,
    lastSettingsPullAt: null,
    lastSeenResetAt: null,
    structuralSyncError: null,
    ownerUserId,
  };
}

/**
 * Removes all per-user LS keys INCLUDING settings:* (which clearLocalProgress
 * deliberately spares).  Only called on a confirmed user-switch.
 */
function wipeUserLocalStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const ls = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      // Wipe all poke-memory:* EXCEPT device-level keys that must survive a
      // user switch (archive blobs stay - they are keyed per-userId and are
      // removed individually by restoreUserData when consumed).
      // We keep: superuser, superuser:flags:v1, last-seen-version:v1,
      //   storage-persist-requested:v1, session-active, offline-downloaded-at,
      //   offline-manifest:v1, pokedex-sort:v1, client-salt:v1, card-revealed,
      //   qa-seed-active, user-archive:*.
      if (
        k !== null &&
        k.startsWith("poke-memory:") &&
        !k.startsWith("poke-memory:superuser") &&
        !k.startsWith("poke-memory:last-seen-version") &&
        !k.startsWith("poke-memory:storage-persist-requested") &&
        !k.startsWith("poke-memory:session-active") &&
        !k.startsWith("poke-memory:offline-downloaded-at") &&
        !k.startsWith("poke-memory:offline-manifest") &&
        !k.startsWith("poke-memory:pokedex-sort") &&
        !k.startsWith("poke-memory:client-salt") &&
        !k.startsWith("poke-memory:card-revealed") &&
        !k.startsWith("poke-memory:qa-seed-active") &&
        !k.startsWith("poke-memory:user-archive")
      ) {
        keys.push(k);
      }
    }
    keys.forEach((k) => ls.removeItem(k));
  } catch {
    // localStorage inaccessible (e.g. Safari ITP).
  }
}

/**
 * Guard that must be called (and awaited) immediately before pullAndMerge in
 * useSignInPull.  Returns after local storage is in the correct state for
 * `incomingUserId` to merge from cloud.
 */
export async function guardAccountSwitch(incomingUserId: string): Promise<void> {
  const syncStatus = loadSyncStatus();
  const ownerUserId = syncStatus.ownerUserId;

  // Guest path: no archive/clear needed.  callback-complete stamps ownerUserId.
  if (ownerUserId === null) return;

  // Same user: no-op.
  if (ownerUserId === incomingUserId) return;

  // Different user: archive → clear → restore → fresh SyncStatus.
  try {
    await archiveUserData(ownerUserId);
  } catch (e) {
    console.warn("[guardAccountSwitch] archive failed (continuing with wipe):", e);
  }

  // Clear the IDB pending-grade queue BEFORE wiping localStorage. A Background
  // Sync event fired in the await gap between wipeUserLocalStorage (which removes
  // the LS queue) and clearIdbPendingQueue could read the IDB copy and POST A's
  // grades under B's session cookie. Clearing IDB first closes that window. (#1712)
  await clearIdbPendingQueue();

  // Wipe per-user LS keys including settings:* (clearLocalProgress spares them).
  wipeUserLocalStorage();

  // Also explicitly remove settings keys in case wipeUserLocalStorage missed
  // them due to an ITP guard.
  try {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(KEY_SETTINGS);
      window.localStorage.removeItem(KEY_SETTINGS_LAST_PUSHED);
    }
  } catch {
    // Best-effort.
  }

  // Restore incoming user's archive (no-op if no archive exists).
  await restoreUserData(incomingUserId);

  // Write a fresh SyncStatus for the incoming user. If restoreUserData wrote a
  // SyncStatus from the archive, it already contains the correct ownerUserId
  // and cursors - but we overwrite with a fresh copy to guarantee null cursors
  // (the restored cursors are correct for multi-device; the incoming user may
  // also be signing in on this device for the first time from the archive).
  //
  // Actually, if an archive exists we SHOULD use the archived cursors so that
  // pullAndMerge correctly starts from where this user left off.  Only reset
  // when no archive was present (restoreUserData is a no-op in that case and
  // ZERO_SYNC_STATUS is the correct starting point).
  //
  // Detect whether restore populated a SyncStatus by re-reading it.
  const afterRestore = loadSyncStatus();
  if (afterRestore.ownerUserId !== incomingUserId) {
    // No archive was present (or it had a different ownerUserId) - write fresh.
    saveSyncStatus(freshSyncStatus(incomingUserId));
  }
  // If ownerUserId is already incomingUserId, the archive was restored and cursors
  // are correct - no additional write needed.
}
