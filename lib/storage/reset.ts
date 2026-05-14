import { idbDelete } from "@/lib/idb/db";

// IDB keys must be kept in sync with the constants in:
//   lib/review/persistence.ts     (STORAGE_KEY)
//   lib/gradelog/persistence.ts   (STORAGE_KEY)
//   lib/idb/db.ts                 (SESSION_LS_KEY, GRADE_LOG_LS_KEY)
//   lib/review/useSessionStorageKey.ts (SESSION_STORAGE_KEY)
// They are duplicated here because importing those modules would create a
// dependency cycle: persistence layers also depend on the reset function
// indirectly via shared utilities.
const SESSION_IDB_KEY = "poke-memory:review-session:v1";
const GRADE_LOG_IDB_KEY = "poke-memory:grade-log:v1";
// IDB-internal flag set by migrateFromLocalStorage to mark the localStorage→IDB
// copy as completed. Reset clears it so a future restore-from-backup-into-
// localStorage path can re-run the migration. Defined in lib/idb/db.ts as
// MIGRATION_FLAG_KEY = "migration_done_v1".
const MIGRATION_FLAG_KEY = "migration_done_v1";

export async function clearLocalProgress(): Promise<void> {
  if (typeof window === "undefined") return;
  Object.keys(localStorage)
    .filter((k) => k.startsWith("poke-memory:") && !k.startsWith("poke-memory:settings:"))
    .forEach((k) => localStorage.removeItem(k));
  // When IDB is unavailable, idbDelete is a no-op — that's fine because the
  // persistence layers fall back to localStorage, so the sweep above already
  // cleared those keys (they start with "poke-memory:" but not "poke-memory:settings:").
  await idbDelete(SESSION_IDB_KEY);
  await idbDelete(GRADE_LOG_IDB_KEY);
  await idbDelete(MIGRATION_FLAG_KEY);
  // Same-tab subscribers (Stats / Pasture / Pokédex) re-read on storage events;
  // dispatch synthetic ones keyed to both stores so they pick up the empty
  // state without a full reload. Cross-tab listeners receive a real
  // StorageEvent from localStorage.removeItem above. The grade-log dispatch
  // is the explicit delete-signal — GRADE_LOG_APPENDED_EVENT only announces
  // appends, so without this dispatch a future decoupling of the Stats grade-
  // log read from its session read would silently stop reacting to resets.
  try {
    window.dispatchEvent(new StorageEvent("storage", { key: SESSION_IDB_KEY }));
    window.dispatchEvent(new StorageEvent("storage", { key: GRADE_LOG_IDB_KEY }));
  } catch {
    // Older browsers / non-standard envs without a StorageEvent constructor.
  }
}
