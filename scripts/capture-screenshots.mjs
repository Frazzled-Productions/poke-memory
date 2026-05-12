/**
 * Capture README screenshots via Playwright.
 *
 * Usage:
 *   npx playwright install --with-deps chromium   # first time only
 *   BASE_URL=http://localhost:3000 node scripts/capture-screenshots.mjs
 *
 * Outputs four PNGs into docs/screenshots/:
 *   practice-front.png   – card front (sprite + "What Pokémon is this?")
 *   practice-flipped.png – card flipped (name revealed + grade buttons)
 *   pokedex-grid.png     – Pokédex grid showing all three disclosure tiers
 *   stats.png            – Stats page (grade breakdown + mastery + streak)
 *
 * The script seeds synthetic mid-progress data into localStorage so the grid
 * shows all three tiers (silhouette / greyscale / full colour) at once.
 */

import { chromium, devices } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "screenshots");

// Storage key must match lib/review/persistence.ts
const STORAGE_KEY = "poke-memory:review-session:v1";

// Mastery: repetitions >= 3 AND interval >= 21 (matches lib/stats/derive.ts)
const MASTERY_REPETITIONS = 3;
const MASTERY_INTERVAL_DAYS = 21;

function pastDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function futureDate(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

/**
 * Build a synthetic session with three tiers:
 *   - ids 1–15:  mastered    (full colour in Pokédex)
 *   - ids 16–50: learning    (greyscale in Pokédex)
 *   - ids 51–1025: unseen   (silhouette in Pokédex)
 *
 * Only the seen cards need to be in the session; unseen ids are absent.
 */
function buildSeedSession() {
  const cards = [];

  // Mastered cards (ids 1–15)
  for (let id = 1; id <= 15; id++) {
    cards.push({
      id,
      cardType: "name",
      name: `pokemon-${id}`,
      spriteUrl: `/sprites/pokemon/${id}.png`,
      types: ["normal"],
      stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
      flavorText: "",
      flavorTexts: [],
      evolutionChain: [],
      height: 10,
      weight: 100,
      baseExperience: 100,
      genus: null,
      generation: "generation-i",
      captureRate: 45,
      baseHappiness: 70,
      growthRate: "medium",
      habitat: null,
      genderRate: 4,
      isLegendary: false,
      isMythical: false,
      cryUrl: null,
      state: {
        repetitions: MASTERY_REPETITIONS + 2,
        interval: MASTERY_INTERVAL_DAYS + 9,
        easeFactor: 2.5,
        dueDate: futureDate(15),
        lastReview: pastDate(15),
        firstSeen: pastDate(60),
        learningStep: null,
        stepStartedAt: null,
      },
    });
  }

  // Learning cards (ids 16–50): reviewed but not mastered (greyscale)
  for (let id = 16; id <= 50; id++) {
    const reps = 1 + ((id - 16) % 2); // 1 or 2 reps — below mastery threshold
    cards.push({
      id,
      cardType: "name",
      name: `pokemon-${id}`,
      spriteUrl: `/sprites/pokemon/${id}.png`,
      types: ["normal"],
      stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
      flavorText: "",
      flavorTexts: [],
      evolutionChain: [],
      height: 10,
      weight: 100,
      baseExperience: 100,
      genus: null,
      generation: "generation-i",
      captureRate: 45,
      baseHappiness: 70,
      growthRate: "medium",
      habitat: null,
      genderRate: 4,
      isLegendary: false,
      isMythical: false,
      cryUrl: null,
      state: {
        repetitions: reps,
        interval: reps === 1 ? 1 : 6,
        easeFactor: 2.5,
        dueDate: futureDate(reps),
        lastReview: pastDate(1),
        firstSeen: pastDate(10),
        learningStep: null,
        stepStartedAt: null,
      },
    });
  }

  const limits = {
    name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
    reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  };

  return JSON.stringify({ cards, limits });
}

// CSS injected on every captured page: hide Next.js dev-mode UI (route
// announcer, dev-tools indicator) so it never appears in screenshots.
const HIDE_DEV_UI_CSS = `
  nextjs-portal,
  [data-nextjs-toast],
  [data-nextjs-dialog-overlay],
  #__next-build-watcher,
  #__next-route-announcer__,
  next-route-announcer { display: none !important; }
`;

async function withPage(browser, contextOptions, fn) {
  const ctx = await browser.newContext({
    ...contextOptions,
    storageState: {
      cookies: [],
      origins: [
        {
          origin: BASE_URL,
          localStorage: [{ name: STORAGE_KEY, value: buildSeedSession() }],
        },
      ],
    },
  });
  const page = await ctx.newPage();
  try {
    await fn(page);
  } finally {
    await ctx.close();
  }
}

async function hideDevUi(page) {
  await page.addStyleTag({ content: HIDE_DEV_UI_CSS }).catch(() => {});
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();

  try {
    // ── Practice screenshots (iPhone 14 viewport) ──────────────────────────
    await withPage(browser, { ...devices["iPhone 14"] }, async (page) => {
      await page.goto(BASE_URL, { waitUntil: "networkidle" });
      // Wait for sprite — confirms localStorage session was read and card rendered.
      // next/image rewrites src to /_next/image?url=%2Fsprites%2Fpokemon%2F…, so
      // match the encoded path (and decoded fallback) instead of the raw URL.
      await page.waitForSelector(
        'img[src*="sprites%2Fpokemon"], img[src*="/sprites/pokemon/"]',
        { timeout: 30_000 },
      );
      await hideDevUi(page);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT_DIR, "practice-front.png"), fullPage: false });
      console.log("  practice-front.png");

      const revealBtn = page.getByRole("button", { name: /reveal/i });
      if (await revealBtn.isVisible()) {
        await revealBtn.click();
        await page.waitForTimeout(400);
      }
      // The reveal expands the card with grade buttons below the sprite, which
      // overflow the iPhone 14 viewport. Capture the full page so the grade
      // buttons (Again / Hard / Good / Easy) are included in the screenshot.
      await page.screenshot({ path: join(OUT_DIR, "practice-flipped.png"), fullPage: true });
      console.log("  practice-flipped.png");
    });

    // ── Pokédex grid (desktop viewport, 1280×900) ──────────────────────────
    await withPage(browser, { viewport: { width: 1280, height: 900 } }, async (page) => {
      await page.goto(`${BASE_URL}/pokedex`, { waitUntil: "networkidle" });
      // Wait for at least one sprite — confirms localStorage was read and grid rendered.
      // next/image rewrites src to /_next/image?url=%2Fsprites%2Fpokemon%2F…, so
      // match the encoded path (and decoded fallback) instead of the raw URL.
      await page.waitForSelector(
        'img[src*="sprites%2Fpokemon"], img[src*="/sprites/pokemon/"]',
        { timeout: 30_000 },
      );
      await hideDevUi(page);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT_DIR, "pokedex-grid.png"), fullPage: false });
      console.log("  pokedex-grid.png");
    });

    // ── Stats page (iPhone 14 viewport) ───────────────────────────────────
    await withPage(browser, { ...devices["iPhone 14"] }, async (page) => {
      await page.goto(`${BASE_URL}/stats`, { waitUntil: "networkidle" });
      // Wait for mastery heading — confirms localStorage was read and stats computed
      await page.waitForSelector("h2#mastery-heading", { timeout: 15_000 });
      await hideDevUi(page);
      await page.waitForTimeout(400);
      // Stats content (streak + grade breakdown + mastery distribution + progress
      // bar) is taller than an iPhone 14 viewport. Capture the full page so the
      // mastery cards and "X / 1,025 introduced" row are both visible.
      await page.screenshot({ path: join(OUT_DIR, "stats.png"), fullPage: true });
      console.log("  stats.png");
    });
  } finally {
    await browser.close();
  }

  console.log(`\nScreenshots saved to ${OUT_DIR}`);
  console.log("Review the images, then commit them to the branch.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
