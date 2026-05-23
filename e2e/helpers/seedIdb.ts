import type { Page } from "@playwright/test";

// Co-located here intentionally: there is no single E2E setup file, so placing
// this in a .d.ts would risk it being silently dropped. Keep it with the helper.
declare global {
  interface Window {
    __seedIdbReady?: Promise<void>;
    // Write-epoch counter — mirrors the declaration in lib/review/persistence.ts.
    // Bumped here (in the browser context injected by addInitScript) so the
    // catch-up check in BottomTabBar/NavLinks/NavDrawer can detect that a seed
    // write happened before their SESSION_CHANGED_EVENT listeners attached.
    __pokeMemorySessionWriteEpoch?: number;
  }
}

/**
 * Seeds the poke-memory IndexedDB `kv` store on the page-under-test.
 *
 * Replaces the old `page.addInitScript` pattern that wrote to localStorage.
 * The migration flag `migration_done_v1` is set to `true` so the one-time
 * migration in `IdbMigration.tsx` skips the (now-empty) localStorage and
 * does not overwrite what we seeded.
 *
 * `window.__seedIdbReady` is assigned synchronously at the start of the
 * init-script body and resolves only after `tx.oncomplete` fires, so callers
 * can use `awaitSeedIdb(page)` after `page.goto` to guarantee the transaction
 * has committed before the app reads IndexedDB.
 *
 * Usage:
 *   await seedIdb(page, { "poke-memory:review-session:v1": JSON.stringify(session) });
 *   await page.goto("/");
 *   await awaitSeedIdb(page);
 */
export async function seedIdb(
  page: Page,
  entries: Record<string, string>,
): Promise<void> {
  await page.addInitScript((data: { entries: Record<string, string> }) => {
    window.__seedIdbReady = new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("poke-memory");
      req.onerror = () => reject(req.error);
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
        tx.oncomplete = () => {
          // Bump the write-epoch counter before dispatching the CustomEvent.
          // Components capture this counter at useEffect mount time and check
          // in a requestAnimationFrame whether it advanced before their listener
          // attached — catching the race where tx.oncomplete fires before React
          // hydrates and registers the SESSION_CHANGED_EVENT listener.
          //
          // Mirrors the bump in lib/review/persistence.ts::dispatchStorageEvent.
          // The counter name "__pokeMemorySessionWriteEpoch" is intentionally
          // hardcoded; this function is serialised by page.addInitScript and
          // cannot import from lib/. Keep in sync with persistence.ts.
          try {
            window.__pokeMemorySessionWriteEpoch =
              (window.__pokeMemorySessionWriteEpoch ?? 0) + 1;
          } catch {
            // Non-standard envs.
          }
          // Dispatch the same CustomEvent that saveSession emits. Nav
          // components (BottomTabBar, NavDrawer, NavLinks) no longer subscribe
          // to this event directly — they track the KEY_HAS_MASTERED localStorage
          // flag instead. The event is still dispatched here for any other
          // subscriber that may be listening, and as belt-and-suspenders in case
          // WebKit does not reliably propagate synthetic StorageEvents to
          // same-tab `storage` listeners. E2E tests that need Pasture-tab
          // visibility mid-session without a reload should set KEY_HAS_MASTERED
          // in localStorage directly.
          //
          // The string "poke-memory:session-changed" is intentionally hardcoded
          // here. This function is serialised to a string by page.addInitScript
          // and injected into the browser context, so it cannot import from lib/.
          // If SESSION_CHANGED_EVENT in lib/review/persistence.ts is ever
          // renamed, this string must be updated manually to match.
          try {
            window.dispatchEvent(new CustomEvent("poke-memory:session-changed"));
          } catch {
            // Non-standard envs.
          }
          resolve();
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(new Error("IDB transaction aborted"));
      };
    });
  }, { entries });
}

/**
 * Awaits the IDB seed transaction committed by `seedIdb` / `seedSessionIdb`.
 *
 * Call this after `page.goto(...)` in every test (or `beforeEach`) that calls
 * `seedIdb`/`seedSessionIdb`. This eliminates the race window between the IDB
 * write and React hydration reading IndexedDB.
 *
 * Must be called after `seedIdb` has been registered via `page.addInitScript`.
 * If called before `seedIdb` (or on an unseeded page), it logs a warning and
 * resolves immediately — giving a false green on any race it was meant to catch.
 */
export async function awaitSeedIdb(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (!window.__seedIdbReady) {
      console.warn(
        "awaitSeedIdb: __seedIdbReady is not set — seedIdb must be called before page.goto",
      );
      return Promise.resolve();
    }
    return window.__seedIdbReady;
  });
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
