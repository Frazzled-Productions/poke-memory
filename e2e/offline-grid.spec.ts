/**
 * Offline Pokédex grid smoke test (#1773)
 *
 * Verifies that the Pokédex grid renders non-broken sprite images when the
 * device is offline and the service worker has cached the assets.
 *
 * Approach:
 *   1. Visit /pokedex online so the service worker registers and installs.
 *   2. Wait for the SW to be in the "activated" state and controlling the page.
 *      On a fresh browser context, the SW installs and activates immediately
 *      (no waiting phase for first install). We post SKIP_WAITING defensively
 *      so any "waiting" SW (e.g. from a prior stale registration) activates.
 *      We reload once online to ensure the SW intercepts navigation + all
 *      sub-resource fetches (JS bundles, seed data, sprites) and caches them.
 *   3. Wait for the grid to fully render online: a role="list" element with at
 *      least one img inside it must be visible. This confirms the SW has served
 *      all the necessary resources and they are cached.
 *   4. Poll until the pages cache contains the /pokedex navigation URL,
 *      confirming the StaleWhileRevalidate background write has completed.
 *   5. Seed the IndexedDB offline pack with the on-screen sprites (the store the
 *      SW serves `/sprites/` from since #1803; see Step 6b).
 *   6. Switch offline and reload; the SW must serve from cache.
 *   7. Wait for the grid list with images to render offline (React must hydrate
 *      from cached JS bundles). Assert a seeded sprite has naturalWidth > 0.
 *
 * This approach is deliberately lightweight compared to triggering the full
 * ~5.5 MB precache download from the Settings offline section. The SW caches
 * all navigations and assets it handles on the first online visit via
 * StaleWhileRevalidate (#1803), so the grid is already cached after the warm-up
 * request. The AC's "after a precache" wording is satisfied because the SW
 * caches content on the first response - the precache happens implicitly during
 * the online warm-up pass, not as a separate explicit download step.
 *
 * Restrictions:
 * - Chromium only. The service worker path under test (#1773) is scoped to
 *   chromium. WebKit/Safari SW behaviour differs and is out of scope.
 * - serviceWorkers: 'allow' (the default). Never use page.route stubs for
 *   SW-mediated fetches - the SW bypasses them (#1650 / AGENTS.md).
 * - Requires a production build (the SW only registers in production). The
 *   e2e CI job runs against a Vercel preview (production build), so the SW is
 *   active. Locally, the spec will be skipped unless PLAYWRIGHT_BASE_URL points
 *   at a preview/prod build.
 */

import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

// ---------------------------------------------------------------------------
// The offline assertion requires a live service worker, which is only
// registered in production builds. We cannot guarantee the SW is active
// against a local dev server (next dev), so this describe block restricts
// itself to chromium and documents the production-build dependency.
//
// The spec will pass in CI (Vercel preview = production build) and locally
// when PLAYWRIGHT_BASE_URL points at a preview or production deployment.
// ---------------------------------------------------------------------------

test.describe("Offline Pokédex grid (#1773)", () => {
  test.beforeEach(async ({ page }) => {
    // Dismiss the first-visit onboarding modal so it does not obscure the grid.
    await addOnboardingPreDismiss(page);
  });

  test("Pokédex grid sprite renders after SW cache warm-up and offline switch (chromium only)", async ({
    page,
  }, testInfo) => {
    // Restrict to chromium: SW offline behaviour under test is scoped to chromium.
    // mobile-safari / desktop-webkit / mobile-chrome use the same project flag but
    // the offline SW path is only validated here on chromium.
    if (testInfo.project.name !== "chromium") {
      test.skip(true, "Offline SW smoke test is chromium-only (#1773)");
      return;
    }

    // --- Step 1: visit the Pokédex grid online to register + install the SW ---
    await page.goto("/pokedex");

    // Wait for the grid heading - confirms the page mounted and the SW had a
    // chance to register.
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    // --- Step 2: ensure the SW is active (post SKIP_WAITING defensively) ---
    //
    // The SW uses skipWaiting:false. On a completely fresh context (no prior SW
    // registration), the SW installs and activates immediately - there is
    // nothing to wait for. However, if a prior test run left a "waiting" SW,
    // posting SKIP_WAITING moves it through to activated.
    await page.evaluate(() => {
      return navigator.serviceWorker?.ready.then((reg) => {
        const sw = reg.waiting ?? reg.installing ?? reg.active;
        if (sw && sw.state !== "activated") {
          sw.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });

    // --- Step 3: reload once online so the SW claims this client and caches
    //             all sub-resources (navigation, JS bundles, sprites) ---
    //
    // The SW may have activated mid-flight during the first goto(), meaning the
    // /pokedex navigation response and its sub-resources (JS bundles for the
    // route) were not intercepted. A single online reload navigates into the
    // now-active SW's scope: the SW intercepts every fetch, caches the
    // navigation via StaleWhileRevalidate, and caches JS bundles CacheFirst.
    await page.reload({ waitUntil: "domcontentloaded" });

    // --- Step 4: confirm the SW controls this page ---
    await page.waitForFunction(
      () => navigator.serviceWorker?.controller != null,
      null,
      { timeout: 30_000 },
    );

    // --- Step 5: wait for the grid to fully render online ---
    //
    // The Pokédex page transitions from LoadingSkeleton (no role="list", no
    // imgs) to the rendered grid (role="list" elements with img children) once
    // the seed + session data loads asynchronously. We wait for a list element
    // that contains at least one img - this is the definitive "grid rendered"
    // signal. The SW must have served and cached the JS bundles + sprites by
    // the time this condition is met.
    await page.waitForFunction(
      () => {
        const imgs = document.querySelectorAll('[role="list"] img');
        return imgs.length > 0;
      },
      null,
      { timeout: 30_000 },
    );

    // Confirm at least one of those images has loaded (naturalWidth > 0) while
    // online, so the SW has actually cached the sprite bytes.
    await page.waitForFunction(
      () => {
        const imgs = document.querySelectorAll('[role="list"] img');
        for (const img of Array.from(imgs).slice(0, 5)) {
          if ((img as HTMLImageElement).naturalWidth > 0) return true;
        }
        return false;
      },
      null,
      { timeout: 15_000 },
    );

    // --- Step 6: poll until the SW pages cache contains the /pokedex URL ---
    //
    // StaleWhileRevalidate writes to the cache after returning the response.
    // Polling ensures the write completed before we go offline.
    await page.waitForFunction(
      async () => {
        try {
          const keys = await caches.keys();
          for (const name of keys) {
            // The pages cache name contains "pages" per cacheStrategy.ts.
            if (!name.includes("pages")) continue;
            const cache = await caches.open(name);
            const requests = await cache.keys();
            if (requests.some((r) => r.url.includes("/pokedex"))) {
              return true;
            }
          }
          return false;
        } catch {
          return false;
        }
      },
      null,
      { timeout: 20_000 },
    );

    // --- Step 6b: seed the offline sprite pack in IndexedDB ---
    //
    // Since #1803 the SW no longer caches sprites in Cache Storage: `/sprites/`
    // is `idb-first` (lib/pwa/cacheStrategy.ts), served from the `offline-pack`
    // store and otherwise fetched from the network. That store is normally filled
    // by the Settings "Download" flow (lib/pwa/precache.ts), which pulls the whole
    // multi-thousand-file pack - too heavy for a smoke test. Write the same
    // shape (`{ blob, contentType }` keyed by the relative path) for the first
    // sprites on screen instead.
    //
    // Do NOT rely on the browser HTTP cache to satisfy the offline render. This
    // spec used to, by accident: on Playwright 1.60 the SW's network fallback
    // was answered from the HTTP cache while "offline", so it passed with an
    // empty pack. From 1.61+ (Chromium 153) offline emulation also fails those
    // cache-served fetches (img requests report status 0), so only genuinely
    // pack-served sprites render offline (#2074 / PR #2102).
    const seededSrcs = await page.evaluate(async () => {
      const imgs = Array.from(
        document.querySelectorAll<HTMLImageElement>('[role="list"] img'),
      )
        .filter((i) => i.naturalWidth > 0)
        .slice(0, 5);
      const paths = imgs.map((i) => new URL(i.currentSrc).pathname);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("poke-memory", 2);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      for (const path of paths) {
        const res = await fetch(path);
        const blob = await res.blob();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("offline-pack", "readwrite");
          tx.objectStore("offline-pack").put(
            { blob, contentType: res.headers.get("content-type") ?? "image/webp" },
            path,
          );
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
      db.close();
      return paths;
    });
    expect(seededSrcs.length).toBeGreaterThan(0);

    // --- Step 7: go offline ---
    await page.context().setOffline(true);

    // --- Step 8: reload the Pokédex grid without network access ---
    // The service worker must serve the page and its assets from its cache.
    // Use domcontentloaded to avoid a hard timeout waiting for network requests
    // that will never complete offline.
    await page.reload({ waitUntil: "domcontentloaded" });

    // --- Step 9: wait for the grid heading from SW cache ---
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible({ timeout: 20_000 });

    // --- Step 10: wait for the grid list with images to render offline ---
    //
    // After the offline reload, React hydrates from cached JS bundles. The
    // grid builds a session in memory (IDB is empty in a fresh context, so
    // buildSession() produces all-locked tiles). Both locked and unlocked
    // tiles render a sprite <img>. We wait for the list+img signal to confirm
    // full hydration.
    await page.waitForFunction(
      () => {
        const imgs = document.querySelectorAll('[role="list"] img');
        return imgs.length > 0;
      },
      null,
      { timeout: 30_000 },
    );

    // --- Step 11: assert the pack-served sprites decode offline ---
    //
    // The SW serves the seeded URLs from the IndexedDB pack; naturalWidth > 0
    // confirms the stored bytes were returned and decoded. Assert on those exact
    // sprites (not "any of the first N") so a silent fallback to the network or
    // the HTTP cache cannot satisfy it.
    const foundLoadedImage = await page
      .waitForFunction(
        (paths) =>
          paths.some((path) => {
            const img = Array.from(
              document.querySelectorAll<HTMLImageElement>('[role="list"] img'),
            ).find((i) => i.currentSrc.endsWith(path));
            return img !== undefined && img.naturalWidth > 0;
          }),
        seededSrcs,
        { timeout: 15_000 },
      )
      .then(() => true)
      .catch(() => false);

    expect(
      foundLoadedImage,
      "At least one grid sprite image must have naturalWidth > 0 when offline with a warm SW cache",
    ).toBe(true);

    // --- Restore network (cleanup) ---
    await page.context().setOffline(false);
  });
});
