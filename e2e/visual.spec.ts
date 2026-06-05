/**
 * Visual-regression snapshots for the deterministic README surfaces: Stats and
 * Journey.
 *
 * Each surface is asserted at BOTH a mobile and a desktop viewport so a
 * cross-viewport layout regression is caught that the functional smoke suite
 * (which only checks behaviour) would miss.
 *
 * Excluded surfaces - Practice, Pasture, Pokédex
 * ----------------------------------------------
 * The README covers six surfaces; this snapshot set deliberately covers only
 * two. Practice (front + flipped), Pasture, and Pokédex are NOT snapshotted
 * because they cannot be made pixel-stable with reasonable effort. Each was
 * measured inside the pinned Playwright Docker image and reproducibly diffed by
 * ~3% (above the `maxDiffPixelRatio: 0.02` tolerance) even immediately after
 * `--update-snapshots`:
 *
 *   - Practice front: the displayed card is drawn from a session queue. Even
 *     with a single-card session seeded into IndexedDB, `hydrateSession`
 *     (lib/review/session.ts) merges in every other seed Pokémon as a fresh
 *     new card, then `buildSessionQueues` shuffles that ~1025-card new-card
 *     queue. The card shown is therefore not the seeded one, and the queue
 *     order is not pinned per run. Pinning it would mean either seeding the
 *     full ~1025-card catalogue or adding a test-only seam into the product
 *     session builder - out of proportion for a snapshot guard.
 *   - Practice flipped: on top of the card-pick problem above, the post-reveal
 *     fact is chosen by `selectFact` (lib/pokemon/facts.ts) via raw
 *     `Math.random()`, so the flipped card shows different copy on every
 *     reveal even within one run. There is no non-invasive seam to seed it.
 *   - Pasture and Pokédex: the surface set/order/positions ARE deterministic in
 *     code (Pasture's `assignAnchors` sorts by firstSeen then id; both render
 *     under `pretendAllMastered`, which sources every species from SEED_POKEMON
 *     in fixed order). But each page renders ~1025+ lazily-decoded sprites.
 *     Under the parallel CI worker pool, sprite decode/paint does not settle to
 *     the same frame run-to-run, so a committed baseline reproducibly diffs.
 *     Run in isolation each surface is stable; under load it is not - so it
 *     cannot be a reliable gate. Gating the capture on `img.decode()` for every
 *     sprite was tried and rejected: it pushed run time past a minute and made
 *     the comparison flakier, not less, because the decode work itself competes
 *     for the contended CPU.
 *
 * Stats and Journey render a bounded amount of imagery and a layout that is
 * fully determined by the `pretendAllMastered` superuser flag, so they are
 * pixel-stable across runs and viewports (verified: 8/8 snapshots passing
 * across four consecutive parallel runs inside the Docker image). A smaller
 * deterministic snapshot set is a deliberate trade: a permanently-red or flaky
 * check would be worse than four fewer surfaces of coverage.
 *
 * IMPORTANT - baseline determinism
 * --------------------------------
 * macOS Core Text and Linux font anti-aliasing differ visibly (AGENTS.md
 * documents this, which is why the README screenshots are macOS-only). Baseline
 * PNGs under e2e/__screenshots__/ are therefore generated AND compared inside
 * the pinned mcr.microsoft.com/playwright Docker image only. Never regenerate
 * them from a developer macOS machine. See WORKFLOW.md → "Visual-regression
 * gate" and .github/workflows/visual-regression.yml.
 *
 * This spec only runs under the `visual-chromium` / `visual-webkit` projects
 * (see playwright.config.ts); the functional projects ignore it.
 */
import { test, expect, type Page } from "@playwright/test";

// Storage keys must match lib/superuser/persistence.ts. Seeding the
// pretendAllMastered flag renders every species as mastered so Stats and
// Journey are deterministic without depending on a particular review history.
// Mirrors scripts/capture-screenshots.mjs.
const SUPERUSER_UNLOCKED_KEY = "poke-memory:superuser";
const SUPERUSER_FLAGS_KEY = "poke-memory:superuser:flags:v1";

// Two viewports per surface. The mobile size matches the iPhone 14 used by the
// functional mobile-safari project; the desktop size is a common laptop frame.
const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;

type SurfaceName = "stats" | "journey";

type Surface = {
  url: string;
  /** Optional post-navigation step to reach the surface's stable state. */
  ready?: (page: Page) => Promise<void>;
};

const SURFACES: Record<SurfaceName, Surface> = {
  stats: {
    url: "/stats",
    ready: async (page) => {
      await page
        .getByRole("heading", { name: "Accuracy", exact: true })
        .waitFor({ state: "visible", timeout: 15_000 });
    },
  },
  journey: {
    url: "/journey",
    ready: async (page) => {
      await page
        .getByRole("region", { name: "Trainer card" })
        .waitFor({ state: "visible", timeout: 15_000 });
    },
  },
};

/**
 * Seeds the pretendAllMastered superuser flag BEFORE any page JS runs, so every
 * surface renders a deterministic frame.
 */
async function seedDeterministicState(page: Page): Promise<void> {
  await page.addInitScript(
    ({ unlockedKey, flagsKey }) => {
      window.localStorage.setItem(unlockedKey, "true");
      window.localStorage.setItem(
        flagsKey,
        JSON.stringify({ pretendAllMastered: true }),
      );
    },
    { unlockedKey: SUPERUSER_UNLOCKED_KEY, flagsKey: SUPERUSER_FLAGS_KEY },
  );
}

for (const [name, surface] of Object.entries(SURFACES) as [
  SurfaceName,
  Surface,
][]) {
  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    test.describe(`${name} @ ${viewportName}`, () => {
      test.use({ viewport });

      test(`renders the ${name} surface without visual regression`, async ({
        page,
      }) => {
        await seedDeterministicState(page);
        await page.goto(surface.url);

        if (surface.ready) await surface.ready(page);

        // Hide the Next.js dev-tools indicator so it never leaks into a
        // snapshot (matches scripts/capture-screenshots.mjs).
        await page.evaluate(() => {
          document
            .querySelectorAll("nextjs-portal")
            .forEach((el) => ((el as HTMLElement).style.display = "none"));
        });

        // Let any trailing layout settle before the comparison.
        await page.waitForTimeout(400);

        // Snapshot the rendered viewport, not the full scroll height. A
        // full-page capture of a long surface is slow and produces
        // multi-megabyte baselines; the viewport frame is what a layout
        // regression shows up in anyway.
        await expect(page).toHaveScreenshot(`${name}-${viewportName}.png`, {
          // Generous per-snapshot timeout: WebKit's full-frame capture
          // comfortably exceeds the 5s default.
          timeout: 20_000,
        });
      });
    });
  }
}
