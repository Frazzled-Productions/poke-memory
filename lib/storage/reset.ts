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
  // Same-tab subscribers (Stats / Pasture / Pokédex) re-read on storage events;
  // dispatch a synthetic one keyed to the session so they pick up the empty
  // state without a full reload. Cross-tab listeners receive a real
  // StorageEvent from localStorage.removeItem above.
  try {
    window.dispatchEvent(new StorageEvent("storage", { key: SESSION_IDB_KEY }));
  } catch {
    // Older browsers / non-standard envs without a StorageEvent constructor.
  }
}
