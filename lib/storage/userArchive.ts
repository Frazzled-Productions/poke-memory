/**
 * Per-user local-state archive for multi-account isolation (#1712).
 *
 * When a different user signs in on the same device, the outgoing user's full
 * local state is serialised into a single JSON blob stored under
 * `poke-memory:user-archive:<userId>`. If the same user returns later, the
 * blob is deserialised and their keys are restored so they continue where they
 * left off.
 *
 * MUST-ARCHIVE keys (per-owner):
 *   review-session:v1    (IDB-backed)
 *   grade-log:v1         (IDB-backed)
 *   streak:v1
 *   sync-status:v1       (incl. ownerUserId + cursors)
 *   pending-grade-queue:v1 (LS + IDB)
 *   settings:v1
 *   settings:last-pushed:v1
 *   daily-summary:v1
 *   has-mastered:v2              (derived - clear on restore rather than archive)
 *   mastered-count-by-locale:v1  (derived - clear on restore)
 *   due-count-by-locale:v1       (derived - clear on restore)
 *   has-history-by-locale:v1     (derived - clear on restore)
 *   poke-memory:mt-banner-dismissed:<locale>  (scanned by prefix)
 *
 * DO NOT archive (device-level):
 *   superuser, superuser:flags:v1, last-seen-version:v1,
 *   storage-persist-requested:v1, session-active, offline-downloaded-at,
 *   offline-manifest:v1, pokedex-sort:v1, client-salt:v1, card-revealed,
 *   qa-seed-active, user-archive:* (the archive keys themselves),
 *   IDB MIGRATION_FLAG_KEY.
 */

import { idbGet, idbSet, idbDelete } from "@/lib/idb/db";
import {
  KEY_REVIEW_SESSION,
  KEY_GRADE_LOG,
  KEY_STREAK,
  KEY_SYNC_STATUS,
  KEY_PENDING_GRADE_QUEUE,
  KEY_SETTINGS,
  KEY_SETTINGS_LAST_PUSHED,
  KEY_DAILY_SUMMARY,
  KEY_HAS_MASTERED,
  KEY_MASTERED_COUNT_BY_LOCALE,
  KEY_DUE_COUNT_BY_LOCALE,
  KEY_HAS_HISTORY_BY_LOCALE,
  userArchiveKey,
} from "@/lib/storage/keys";

/** localStorage keys that hold per-user state and must be snapshotted into the archive. */
const LS_ARCHIVE_KEYS = [
  KEY_REVIEW_SESSION,   // fallback only - primary is IDB, but include for completeness
  KEY_GRADE_LOG,        // fallback only
  KEY_STREAK,
  KEY_SYNC_STATUS,
  KEY_PENDING_GRADE_QUEUE,
  KEY_SETTINGS,
  KEY_SETTINGS_LAST_PUSHED,
  KEY_DAILY_SUMMARY,
  KEY_HAS_MASTERED,
  KEY_MASTERED_COUNT_BY_LOCALE,
  KEY_DUE_COUNT_BY_LOCALE,
  KEY_HAS_HISTORY_BY_LOCALE,
] as const;

/** IDB keys that hold per-user state and must be snapshotted. */
const IDB_ARCHIVE_KEYS = [
  KEY_REVIEW_SESSION,
  KEY_GRADE_LOG,
  KEY_PENDING_GRADE_QUEUE,
] as const;

const MT_BANNER_PREFIX = "poke-memory:mt-banner-dismissed";

type ArchiveBlob = {
  /** Version tag - increment if the shape changes to allow forward-compat guards. */
  v: 1;
  ls: Record<string, string>;
  idb: Record<string, string>;
};

/**
 * Snapshot the current user's full local state into a single JSON blob stored
 * under `poke-memory:user-archive:<userId>`.
 *
 * Best-effort: a localStorage quota error is caught and logged; the cloud copy
 * is intact so data is not lost.
 */
export async function archiveUserData(userId: string): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    const ls = window.localStorage;
    const lsData: Record<string, string> = {};

    // Snapshot fixed per-user LS keys.
    for (const key of LS_ARCHIVE_KEYS) {
      const val = ls.getItem(key);
      if (val !== null) lsData[key] = val;
    }

    // Snapshot dynamic MT-banner dismissal keys (scan by prefix).
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (key !== null && key.startsWith(MT_BANNER_PREFIX)) {
        const val = ls.getItem(key);
        if (val !== null) lsData[key] = val;
      }
    }

    // Snapshot IDB keys in parallel.
    const idbValues = await Promise.all(
      IDB_ARCHIVE_KEYS.map((key) => idbGet(key).then((val) => ({ key, val }))),
    );
    const idbData: Record<string, string> = {};
    for (const { key, val } of idbValues) {
      if (val !== null) idbData[key] = val;
    }

    const blob: ArchiveBlob = { v: 1, ls: lsData, idb: idbData };
    ls.setItem(userArchiveKey(userId), JSON.stringify(blob));
  } catch (e) {
    // Quota-full or Safari ITP. Cloud is intact; log and continue.
    console.warn("[userArchive] archiveUserData failed (non-fatal, cloud intact):", e);
  }
}

/**
 * Restore a previously-archived user's local state from the per-user blob.
 *
 * If no archive exists for the user, this is a no-op - the local storage will
 * be clean (just cleared by the switch guard) and `pullAndMerge` will populate
 * it from cloud.
 *
 * After restore, dispatches synthetic StorageEvents for KEY_REVIEW_SESSION and
 * KEY_GRADE_LOG so same-tab subscribers (Stats / Pasture / NavLinks) react to
 * the restored data without a full reload.
 */
export async function restoreUserData(userId: string): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    const ls = window.localStorage;
    const archiveKey = userArchiveKey(userId);
    const raw = ls.getItem(archiveKey);
    if (raw === null) return; // No archive - fresh start for this user on this device.

    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as ArchiveBlob).v !== 1
    ) {
      console.warn("[userArchive] restoreUserData: malformed archive blob, ignoring");
      return;
    }
    const blob = parsed as ArchiveBlob;

    // Restore LS keys.
    for (const [key, val] of Object.entries(blob.ls)) {
      try {
        ls.setItem(key, val);
      } catch {
        // Quota - skip this key but keep restoring others.
      }
    }

    // Restore IDB keys in parallel.
    await Promise.all(
      Object.entries(blob.idb).map(([key, val]) => idbSet(key, val)),
    );

    // Remove the archive blob itself (now consumed).
    ls.removeItem(archiveKey);

    // Notify same-tab subscribers of the restored data.
    try {
      window.dispatchEvent(new StorageEvent("storage", { key: KEY_REVIEW_SESSION }));
      window.dispatchEvent(new StorageEvent("storage", { key: KEY_GRADE_LOG }));
    } catch {
      // Older browsers / non-standard envs.
    }
  } catch (e) {
    console.warn("[userArchive] restoreUserData failed (non-fatal):", e);
  }
}

/**
 * Clears the IDB pending-grade queue for the outgoing user after archiving,
 * so the service worker does not replay grades under the wrong session cookie.
 * The LS copy is handled by the main clear step in guardAccountSwitch.
 */
export async function clearIdbPendingQueue(): Promise<void> {
  await idbDelete(KEY_PENDING_GRADE_QUEUE);
}

/**
 * Deletes the outgoing user's IDB-primary stores (review session + grade log)
 * on a confirmed user switch. Without this, the incoming user inherits the
 * outgoing user's session: loadSession reads IDB first, so callback-complete
 * treats the leftover data as the incoming user's "local" state and pushes it
 * into their cloud account on an empty-cloud first sign-in (#1850 - the #1712
 * cross-account blending class). The LS fallback copies are wiped by
 * wipeUserLocalStorage in guardAccountSwitch.
 *
 * Deliberately does NOT delete MIGRATION_FLAG_KEY: the migration flag is
 * device-level (see the header above). Keeping it set also prevents a
 * re-triggered LS-to-IDB migration from racing restoreUserData and
 * overwriting a restored IDB value with a stale LS fallback.
 *
 * Dispatches a synthetic StorageEvent keyed to KEY_GRADE_LOG unconditionally
 * (#1978 review fix), independent of whatever `restoreUserData` does next.
 * Without this, a switch to an incoming user with NO local archive and a
 * cloud grade log the same length as the (now-empty) local one never fires
 * `saveGradeLog` inside the following `pullAndMerge`, so nothing invalidates
 * `useSpeciesMasteryDate`'s module-level cache - the outgoing user's derived
 * mastery dates would keep rendering under the incoming user's session.
 */
export async function clearIdbUserData(): Promise<void> {
  await Promise.all([
    idbDelete(KEY_REVIEW_SESSION),
    idbDelete(KEY_GRADE_LOG),
  ]);

  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new StorageEvent("storage", { key: KEY_GRADE_LOG }));
    } catch {
      // Older browsers / non-standard envs without a StorageEvent constructor.
    }
  }
}
