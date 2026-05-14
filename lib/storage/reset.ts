import { idbDelete } from "@/lib/idb/db";

// IDB keys must be kept in sync with the constants in:
//   lib/review/persistence.ts (STORAGE_KEY)
//   lib/gradelog/persistence.ts (STORAGE_KEY)
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
  await idbDelete(SESSION_IDB_KEY);
  await idbDelete(GRADE_LOG_IDB_KEY);
  // Same-tab subscribers (Stats / Pasture / Pokédex) re-read on storage events;
  // dispatch a synthetic one keyed to the session so they pick up the empty
  // state without a full reload. Cross-tab listeners receive a real
  // StorageEvent from localStorage.removeItem above.
  window.dispatchEvent(new StorageEvent("storage", { key: SESSION_IDB_KEY }));
}
