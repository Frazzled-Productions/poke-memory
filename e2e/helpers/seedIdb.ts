import type { Page } from "@playwright/test";

/**
 * Seeds the poke-memory IndexedDB `kv` store on the page-under-test.
 *
 * Replaces the old `page.addInitScript` pattern that wrote to localStorage.
 * The migration flag `migration_done_v1` is set to `true` so the one-time
 * migration in `IdbMigration.tsx` skips the (now-empty) localStorage and
 * does not overwrite what we seeded.
 *
 * Usage:
 *   await seedIdb(page, { "poke-memory:review-session:v1": JSON.stringify(session) });
 */
export async function seedIdb(
  page: Page,
  entries: Record<string, string>,
): Promise<void> {
  await page.addInitScript((data: { entries: Record<string, string> }) => {
    const req = indexedDB.open("poke-memory", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("kv")) {
        req.result.createObjectStore("kv");
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("kv", "readwrite");
      const store = tx.objectStore("kv");
      // Set the migration flag so IdbMigration.tsx does not overwrite.
      store.put(true, "migration_done_v1");
      for (const [key, value] of Object.entries(data.entries)) {
        store.put(value, key);
      }
    };
  }, { entries });
}

/**
 * Seeds a review session into IndexedDB.
 * Convenience wrapper around seedIdb for the common case.
 */
export async function seedSessionIdb(
  page: Page,
  session: object,
): Promise<void> {
  await seedIdb(page, {
    "poke-memory:review-session:v1": JSON.stringify(session),
  });
}
