/**
 * Visual-regression snapshots for the six key surfaces (the same set the
 * README screenshots cover): Practice front, Practice flipped, Stats, Pokédex,
 * Pasture, Journey.
 *
 * Each surface is asserted at BOTH a mobile and a desktop viewport so a
 * cross-viewport layout regression is caught that the functional smoke suite
 * (which only checks behaviour) would miss.
 *
 * IMPORTANT — baseline determinism
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
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";

// A deterministic single-card review session. The Practice surface otherwise
// samples a random card on every load, which makes a pixel-exact snapshot
// impossible. Seeding one fixed name card (Bulbasaur) pins the rendered sprite
// and name. Mirrors the seed used by the "Hear name" test in e2e/smoke.spec.ts.
const FIXED_PRACTICE_SESSION = {
  cards: [
    {
      id: 1,
      name: "Bulbasaur",
      spriteUrl: "/sprites/pokemon/1.png",
      cardType: "name",
      state: {
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        fsrsState: "new",
        dueDate: "2026-01-01",
        lastReview: null,
        firstSeen: null,
        learningStep: null,
        stepStartedAt: null,
      },
    },
  ],
  limits: {
    name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    evolution: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
    reverse: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
    cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
  },
};

// Storage keys must match lib/superuser/persistence.ts. Seeding the
// pretendAllMastered flag renders every species as mastered so Pokédex,
// Pasture, Stats and Journey are deterministic without depending on a
// particular review history. Mirrors scripts/capture-screenshots.mjs.
const SUPERUSER_UNLOCKED_KEY = "poke-memory:superuser";
const SUPERUSER_FLAGS_KEY = "poke-memory:superuser:flags:v1";

// Two viewports per surface. The mobile size matches the iPhone 14 used by the
// functional mobile-safari project; the desktop size is a common laptop frame.
const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;

type SurfaceName =
  | "practice-front"
  | "practice-flipped"
  | "stats"
  | "pokedex"
  | "pasture"
  | "journey";

type Surface = {
  url: string;
  /**
   * When true, seed the fixed single-card review session into IndexedDB so the
   * Practice surface renders a deterministic card.
   */
  seedSession?: boolean;
  /** Optional post-navigation step to reach the surface's stable state. */
  ready?: (page: Page) => Promise<void>;
};

const SURFACES: Record<SurfaceName, Surface> = {
  "practice-front": {
    url: "/",
    seedSession: true,
    ready: async (page) => {
      // Wait for the seeded card to hydrate so the snapshot captures the card
      // front, not the loading skeleton.
      await page
        .getByRole("button", { name: /reveal/i })
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });
    },
  },
  "practice-flipped": {
    url: "/",
    seedSession: true,
    ready: async (page) => {
      // Wait for the seeded card to hydrate before clicking, otherwise the
      // Reveal button is not yet in the DOM and the card never flips — which
      // would make this snapshot identical to practice-front.
      const reveal = page.getByRole("button", { name: /reveal/i }).first();
      await reveal.waitFor({ state: "visible", timeout: 15_000 });
      await reveal.click();
      // The grade buttons appearing confirm the card has flipped.
      await page
        .getByRole("group", { name: /grade/i })
        .waitFor({ state: "visible", timeout: 10_000 });
    },
  },
  stats: {
    url: "/stats",
    ready: async (page) => {
      await page
        .getByRole("heading", { name: "Accuracy", exact: true })
        .waitFor({ state: "visible", timeout: 15_000 });
    },
  },
  pokedex: { url: "/pokedex" },
  pasture: {
    url: "/pasture",
    // The pasture has an idle rAF animation loop. The freeze flag (set as an
    // init script below) keeps a static frame so the snapshot is stable.
    ready: async (page) => {
      await page.waitForTimeout(600);
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
 * Seeds the pretendAllMastered superuser flag and freezes the pasture idle
 * animation BEFORE any page JS runs, so every surface renders a deterministic
 * frame.
 */
async function seedDeterministicState(page: Page): Promise<void> {
  await page.addInitScript(
    ({ unlockedKey, flagsKey }) => {
      window.localStorage.setItem(unlockedKey, "true");
      window.localStorage.setItem(
        flagsKey,
        JSON.stringify({ pretendAllMastered: true }),
      );
      // Stop the pasture idle rAF loop before it starts.
      (window as unknown as { __PASTURE_FREEZE_IDLE?: boolean }).__PASTURE_FREEZE_IDLE =
        true;
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
        if (surface.seedSession) {
          await seedSessionIdb(page, FIXED_PRACTICE_SESSION);
        }
        await page.goto(surface.url);
        if (surface.seedSession) await awaitSeedIdb(page);

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
        // full-page capture of a long surface (the Pokédex grid is ~1025
        // tiles) is slow, produces multi-megabyte baselines, and is flaky
        // because lazy-loaded sprites below the fold never settle. The
        // viewport frame is what a layout regression shows up in anyway.
        await expect(page).toHaveScreenshot(`${name}-${viewportName}.png`, {
          // Generous per-snapshot timeout: WebKit's full-frame capture of a
          // sprite-heavy surface comfortably exceeds the 5s default.
          timeout: 20_000,
        });
      });
    });
  }
}
