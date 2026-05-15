/**
 * Capture README screenshots via Playwright.
 *
 * Usage:
 *   npx playwright install --with-deps chromium   # first time only
 *   npm run dev &                                  # background dev server
 *   npm run screenshots                            # captures all five
 *   npm run screenshots -- --page=practice         # capture one surface
 *
 * Outputs five PNGs into docs/screenshots/, all captured at the same
 * iPhone 17 Pro viewport (402×874 CSS px @ 3x DPR) so the README layout
 * lines up cleanly:
 *
 *   practice-front.png   – card front (sprite, "???", Reveal button)
 *   practice-flipped.png – card flipped (name + flavour + grade buttons)
 *   pokedex-grid.png     – Pokédex with all species rendered as mastered
 *   pasture.png          – Pasture page populated by habitat zones
 *   stats.png            – Stats hero strip (trainer card + records)
 *
 * All screenshots are taken under the superuser `pretendAllMastered` flag
 * so the rendering is deterministic without depending on a particular
 * review history. The Next.js dev-tools indicator (<nextjs-portal>) is
 * hidden inline just before capture.
 */

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "screenshots",
);

// Locked viewport — iPhone 17 Pro CSS dimensions at 3× device-pixel ratio.
// Don't change without also re-shooting all existing screenshots so the
// README grid stays uniform.
const VIEWPORT = { width: 402, height: 874 };
const DEVICE_SCALE_FACTOR = 3;

// Storage keys must match lib/superuser/persistence.ts.
const SUPERUSER_UNLOCKED_KEY = "poke-memory:superuser";
const SUPERUSER_FLAGS_KEY = "poke-memory:superuser:flags:v1";

const SHOTS = {
  "practice-front": {
    url: "/",
    file: "practice-front.png",
    action: null,
  },
  "practice-flipped": {
    url: "/",
    file: "practice-flipped.png",
    action: async (page) => {
      await page
        .getByRole("button", { name: /reveal/i })
        .first()
        .click();
      await page.waitForTimeout(800);
    },
  },
  "pokedex-grid": { url: "/pokedex", file: "pokedex-grid.png", action: null },
  pasture: {
    url: "/pasture",
    file: "pasture.png",
    action: null,
    // Set before navigation so the idle rAF loop never starts, giving a
    // deterministic static frame for the screenshot.
    initScript: () => { window.__PASTURE_FREEZE_IDLE = true; },
  },
  stats: {
    url: "/stats",
    file: "stats.png",
    // Wait for the Gym badges heading to confirm the page has hydrated past
    // the loading skeleton before taking the screenshot.
    action: async (page) => {
      await page
        .getByRole("heading", { name: "Gym badges" })
        .waitFor({ state: "visible", timeout: 15_000 });
      // Short pause so trailing layout animations settle.
      await page.waitForTimeout(400);
    },
  },
};

async function captureSurface(page, name) {
  const spec = SHOTS[name];
  if (!spec) {
    throw new Error(
      `Unknown surface: ${name}. Known: ${Object.keys(SHOTS).join(", ")}`,
    );
  }
  // Inject surface-specific init scripts BEFORE navigation so they run before
  // any page JS (e.g. the pasture idle freeze flag).
  if (spec.initScript) {
    await page.addInitScript(spec.initScript);
  }
  await page.goto(`${BASE_URL}${spec.url}`, { waitUntil: "networkidle", timeout: 30_000 }).catch(async () => {
    // Fallback: networkidle timed out (e.g. background polling keeps the network busy).
    // We already waited 30s; that is far more than needed for hydration.
  });
  await page.waitForTimeout(1200);
  if (spec.action) await spec.action(page);
  await page.waitForTimeout(600);
  // Hide the Next.js dev-tools indicator (custom <nextjs-portal> element)
  // just before capture so it doesn't appear in screenshots.
  await page.evaluate(() => {
    document
      .querySelectorAll("nextjs-portal")
      .forEach((el) => (el.style.display = "none"));
  });
  const path = join(OUT_DIR, spec.file);
  await page.screenshot({ path, fullPage: false });
  console.log(`  ${spec.file}`);
}

async function main() {
  const { values } = parseArgs({
    options: { page: { type: "string" } },
    strict: false,
  });

  const targets = values.page
    ? [values.page]
    : Object.keys(SHOTS);

  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });

    // Seed superuser flags so pretendAllMastered renders every species as
    // mastered. Must happen before any /pokedex, /pasture, /stats navigation.
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      ({ unlockedKey, flagsKey }) => {
        localStorage.setItem(unlockedKey, "true");
        localStorage.setItem(
          flagsKey,
          JSON.stringify({ pretendAllMastered: true }),
        );
      },
      { unlockedKey: SUPERUSER_UNLOCKED_KEY, flagsKey: SUPERUSER_FLAGS_KEY },
    );

    for (const name of targets) await captureSurface(page, name);
  } finally {
    await browser.close();
  }

  console.log(`\nScreenshots saved to ${OUT_DIR}`);
  console.log("Review the images, then commit them with the PR.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
