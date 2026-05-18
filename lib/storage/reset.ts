import { idbDelete, MIGRATION_FLAG_KEY } from "@/lib/idb/db";

// SESSION_IDB_KEY and GRADE_LOG_IDB_KEY must be kept in sync with:
//   lib/review/persistence.ts     (STORAGE_KEY)
//   lib/gradelog/persistence.ts   (STORAGE_KEY)
//   lib/idb/db.ts                 (SESSION_LS_KEY, GRADE_LOG_LS_KEY)
// They are duplicated here because importing those modules would create a
// dependency cycle: persistence layers also depend on the reset function
// indirectly via shared utilities.
// MIGRATION_FLAG_KEY is imported directly from lib/idb/db.ts — no duplication.
const SESSION_IDB_KEY = "poke-memory:review-session:v1";
const GRADE_LOG_IDB_KEY = "poke-memory:grade-log:v1";

/**
 * Wipes localStorage + IDB stores for a guest reset. **Local-only** — does
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
        .filter((k) => k.startsWith("poke-memory:") && !k.startsWith("poke-memory:settings:"))
        .forEach((k) => localStorage.removeItem(k));
    }
  } catch {
    // localStorage inaccessible (e.g. Safari ITP in a third-party context).
  }

  // When IDB is unavailable, idbDelete is a no-op — that's fine because the
  // persistence layers fall back to localStorage, so the sweep above already
  // cleared those keys (they start with "poke-memory:" but not "poke-memory:settings:").
  // Run all three deletes in parallel — each opens its own short transaction
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
  // is the explicit delete-signal — GRADE_LOG_APPENDED_EVENT only announces
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
