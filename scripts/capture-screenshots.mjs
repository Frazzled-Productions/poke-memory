/**
 * Capture README screenshots via Playwright.
 *
 * Usage:
 *   npx playwright install --with-deps chromium   # first time only
 *   npm run dev &                                  # background dev server
 *   npm run screenshots                            # captures all six
 *   npm run screenshots -- --page=practice         # capture one surface
 *
 * Outputs six PNGs into docs/screenshots/, all captured at the same
 * iPhone 17 Pro viewport (402×874 CSS px @ 3x DPR) so the README layout
 * lines up cleanly:
 *
 *   practice-front.png   – card front (Pikachu sprite, "???", Reveal button)
 *   practice-flipped.png – card flipped (Pikachu name + flavour + grade buttons)
 *   pokedex-grid.png     – Pokédex with a realistic mix of mastered / in-progress / locked tiles
 *   pasture.png          – Pasture page with ~30 mastered species
 *   stats.png            – Stats dashboard with populated charts
 *   journey.png          – Journey page with ~15-day streak and badge progress
 *
 * Screenshots are taken against a deterministic "lived-in" seed injected via
 * Playwright's addInitScript (see scripts/screenshot-seed.mjs). The seed
 * writes a curated review session, grade log, and streak into the browser's
 * IndexedDB and localStorage before the page loads, so every surface renders
 * with realistic populated state without requiring a real review history.
 *
 * Pikachu (#25) is always the practice front card because it is staged as
 * an immediately-due learning-step card, which bypasses the shuffled
 * review/new queues entirely.
 *
 * The Next.js dev-tools indicator (<nextjs-portal>) is hidden inline just
 * before capture.
 */

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { buildScreenshotSeed } from "./screenshot-seed.mjs";

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
    // Wait for the Accuracy section heading to confirm the page has hydrated
    // past the loading skeleton before taking the screenshot.
    action: async (page) => {
      await page
        .getByRole("heading", { name: "Accuracy", exact: true })
        .waitFor({ state: "visible", timeout: 15_000 });
      // Short pause so trailing layout animations settle.
      await page.waitForTimeout(400);
    },
  },
  journey: {
    url: "/journey",
    file: "journey.png",
    // Wait for the trainer card region to confirm the page has hydrated past
    // the loading skeleton before taking the screenshot.
    action: async (page) => {
      await page
        .getByRole("region", { name: "Trainer card" })
        .waitFor({ state: "visible", timeout: 15_000 });
      // Short pause so trailing layout animations settle.
      await page.waitForTimeout(400);
    },
  },
};

/**
 * Writes the screenshot seed to IndexedDB and localStorage in the page
 * context. Called via page.evaluate() after the initial navigation, before
 * any surface capture.
 *
 * Uses native IndexedDB APIs (not the idb npm package) because this runs in
 * the Playwright page context, not in the app module graph.
 */
async function writeSeedToPage(page, seed) {
  await page.evaluate(async (payload) => {
    const {
      session,
      gradeLog,
      streakDates,
      keys,
      pikachuStepStartedAt,
    } = payload;

    // ── localStorage keys ────────────────────────────────────────────────

    // Fix the shuffle salt so the queue order is the same on every run.
    // Pikachu is in a learning step anyway, so it bypasses the shuffled
    // queue -- but pinning the salt prevents any drift in the review/new
    // order for other cards.
    localStorage.setItem(keys.KEY_CLIENT_SALT, "screenshot-seed");

    // Streak dates (sorted ISO strings).
    localStorage.setItem(keys.KEY_STREAK, JSON.stringify(streakDates));

    // Has-mastered shortcut so the Pasture tab is visible in the nav.
    localStorage.setItem(keys.KEY_HAS_MASTERED, "true");

    // Dismiss onboarding overlays and ensure superuser mode is OFF so the
    // screenshots show the real (non-superuser) UI. Also set maxNewPerDay
    // to 0 so hydrateSession's additions from the ~932 un-seeded species
    // never appear in the new-card queue. All review cards have future due
    // dates, so the review queue is also empty -- this guarantees Pikachu
    // (the only overdue learning card) always appears first in the practice
    // queue.
    const existingSettings = (() => {
      try { return JSON.parse(localStorage.getItem(keys.KEY_SETTINGS) ?? "{}"); }
      catch { return {}; }
    })();
    localStorage.setItem(keys.KEY_SETTINGS, JSON.stringify({
      ...existingSettings,
      // Zero new-card budgets: prevents the ~932 un-seeded species from
      // being introduced as new cards by hydrateSession.
      maxNewPerDay: 0,
      maxNewEvolutionPerDay: 0,
      maxNewReversePerDay: 0,
      maxNewCryPerDay: 0,
      // Mark the 3, 7, and 14-day milestones as seen so the streak
      // celebration overlay does not block the practice card screenshot.
      // A 15-day streak would otherwise trigger the 3-day milestone
      // (the smallest un-seen milestone <= 15) on every fresh screenshot run.
      seenStreakMilestones: [3, 7, 14],
      onboarding: {
        firstVisitOnboardingDismissed: true,
        welcomeDismissed: true,
        practiceHintDismissed: true,
        audioHintDismissed: true,
        cardTypesHintDismissed: true,
        pwaInstallDismissed: true,
      },
    }));

    // Ensure superuser mode is locked (off) so pretendAllMastered is never on.
    localStorage.removeItem(keys.KEY_SUPERUSER);
    localStorage.removeItem(keys.KEY_SUPERUSER_FLAGS);

    // ── Patch Pikachu's stepStartedAt ───────────────────────────────────

    // Replace the sentinel null with a live timestamp 120 seconds in the
    // past. The 60-second learning step will therefore be 60 seconds
    // overdue, ensuring Pikachu appears as the first card immediately.
    const patchedCards = session.cards.map((card) => {
      if (card.id === 25 && card.cardType === "name" && card.state.learningStep === 0) {
        return {
          ...card,
          state: { ...card.state, stepStartedAt: pikachuStepStartedAt },
        };
      }
      return card;
    });
    const patchedSession = { ...session, cards: patchedCards };

    // ── IndexedDB writes ────────────────────────────────────────────────

    await new Promise((resolve, reject) => {
      const openReq = indexedDB.open("poke-memory", 1);
      openReq.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains("kv")) {
          db.createObjectStore("kv");
        }
      };
      openReq.onerror = () => reject(openReq.error);
      openReq.onsuccess = () => {
        const db = openReq.result;
        const tx = db.transaction("kv", "readwrite");
        const store = tx.objectStore("kv");

        // Write the migration-done flag so the IDB-to-LS migration path
        // does not clobber the seeded IDB data with (empty) localStorage.
        store.put(true, "migration_done_v1");

        store.put(JSON.stringify(patchedSession), keys.KEY_REVIEW_SESSION);
        store.put(JSON.stringify(gradeLog), keys.KEY_GRADE_LOG);

        tx.oncomplete = () => { db.close(); resolve(undefined); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }, {
    session: seed.session,
    gradeLog: seed.gradeLog,
    streakDates: seed.streakDates,
    keys: seed.keys,
    // Compute the live timestamp in Node context (before passing to the page)
    // so the page's evaluate receives a plain number and does not call Date.now()
    // itself (which would vary by a few milliseconds between calls).
    pikachuStepStartedAt: Date.now() - 120_000,
  });
}

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
  await page.goto(`${BASE_URL}${spec.url}`, { waitUntil: "networkidle", timeout: 30_000 }).catch(async (err) => {
    // networkidle can time out when background polling keeps the network busy.
    // That is expected; ignore it. Any other navigation failure (e.g. the dev
    // server is not running) should surface immediately.
    if (!String(err).includes("Timeout")) {
      process.stderr.write(`Navigation failed for ${spec.url}: ${err}\n`);
      process.exit(1);
    }
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

  // Build the seed payload once and reuse it across all surfaces so the
  // pikachuStepStartedAt offset is consistent within a single run.
  const seed = buildScreenshotSeed();

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

    // Navigate to the root once to initialise the origin (so localStorage
    // writes take effect), then inject the full screenshot seed into
    // IndexedDB and localStorage before any surface capture.
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await writeSeedToPage(page, seed);

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
