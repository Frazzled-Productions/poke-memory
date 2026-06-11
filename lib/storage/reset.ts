import { idbDelete, MIGRATION_FLAG_KEY } from "@/lib/idb/db";
import { KEY_REVIEW_SESSION, KEY_GRADE_LOG } from "@/lib/storage/keys";

// Local aliases so the idbDelete calls below read like named store handles
// rather than raw key strings. Both constants are sourced from the shared
// key registry (lib/storage/keys.ts) - lib/idb/db.ts does the same.
const SESSION_IDB_KEY = KEY_REVIEW_SESSION;
const GRADE_LOG_IDB_KEY = KEY_GRADE_LOG;

/**
 * Wipes localStorage + IDB stores for a guest reset. **Local-only** - does
 * not touch cloud. Signed-in callers should use
 * `resetAllProgressEverywhere` from `lib/sync/reset` instead; calling this
 * directly when authenticated leaves cloud populated and the next background
 * push from local will re-introduce stale rows (the #293 + #576
 * delete-resurrection class).
 */
export async function clearLocalProgress(): Promise<void> {
  // localStorage and IDB are independent subsystems. Wrap localStorage
  // in its own try/catch so that a thrown error (e.g. Safari ITP) does
  // not prevent the IDB deletes from running. idbDelete has its own
  // no-op guard for IDB-unavailable environments.
  try {
    if (typeof window !== "undefined") {
      Object.keys(localStorage)
        .filter(
          (k) =>
            k.startsWith("poke-memory:") &&
            !k.startsWith("poke-memory:settings:") &&
            // Preserve other users' archived state on shared devices. The archive
            // prefix (poke-memory:user-archive:<userId>) stores un-pushed local
            // progress for accounts other than the current user. clearLocalProgress
            // is a progress reset, NOT an account deletion; wiping other users'
            // archives here would silently discard their offline grades
            // (F56 / #1856). deleteAccountEverywhere removes archives explicitly.
            !k.startsWith("poke-memory:user-archive:"),
        )
        .forEach((k) => localStorage.removeItem(k));
    }
  } catch {
    // localStorage inaccessible (e.g. Safari ITP in a third-party context).
  }

  // When IDB is unavailable, idbDelete is a no-op - that's fine because the
  // persistence layers fall back to localStorage, so the sweep above already
  // cleared those keys (they start with "poke-memory:" but not "poke-memory:settings:").
  // Run all three deletes in parallel - each opens its own short transaction
  // and there is no ordering dependency between them.
  await Promise.all([
    idbDelete(SESSION_IDB_KEY),
    idbDelete(GRADE_LOG_IDB_KEY),
    idbDelete(MIGRATION_FLAG_KEY),
  ]);

  // Same-tab subscribers (Stats / Pasture / Pokédex) re-read on storage events;
  // dispatch synthetic ones keyed to both stores so they pick up the empty
  // state without a full reload. Cross-tab listeners receive a real
  // StorageEvent from localStorage.removeItem above. The grade-log dispatch
  // is the explicit delete-signal - GRADE_LOG_APPENDED_EVENT only announces
  // appends, so without this dispatch a future decoupling of the Stats grade-
  // log read from its session read would silently stop reacting to resets.
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new StorageEvent("storage", { key: SESSION_IDB_KEY }));
      window.dispatchEvent(new StorageEvent("storage", { key: GRADE_LOG_IDB_KEY }));
    } catch {
      // Older browsers / non-standard envs without a StorageEvent constructor.
    }
  }
}
