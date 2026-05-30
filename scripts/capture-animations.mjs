/**
 * Capture README animation GIFs via Playwright + ffmpeg.
 *
 * Usage:
 *   npx playwright install --with-deps chromium   # first time only
 *   npm run dev &                                  # background dev server
 *   npm run animations                             # captures the card-flip GIF
 *
 * Outputs GIFs into docs/screenshots/, captured at the same iPhone 17 Pro
 * viewport (402x874 CSS px @ 3x DPR) as the static screenshots, so the
 * README layout lines up uniformly:
 *
 *   practice-cardflip.gif  -- card front (Pikachu) -> Reveal -> flipped
 *                             (name + grade buttons) -> Good -> next card
 *
 * The same deterministic seed used by capture-screenshots.mjs is injected
 * here (scripts/screenshot-seed.mjs, Pikachu #25 staged as the due card),
 * so the GIF always features Pikachu as the protagonist.
 *
 * Transcode pipeline: Playwright records WebM -> ffmpeg two-pass palettegen /
 * paletteuse -> optimised GIF. Target: <= 4 MB, fps 14, Lanczos scaling.
 *
 * Requirements:
 *   - ffmpeg (Homebrew: brew install ffmpeg). macOS-only capture -- Linux font
 *     rendering differs from macOS Core Text and would produce visually
 *     inconsistent GIFs.
 *
 * British English in comments; no em dashes.
 */

import { chromium } from "@playwright/test";
import { mkdir, unlink, stat, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { buildScreenshotSeed } from "./screenshot-seed.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "screenshots",
);
const TMP_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".tmp-animation",
);

// Locked viewport -- iPhone 17 Pro CSS dimensions at 3x device-pixel ratio.
// Must match capture-screenshots.mjs exactly so GIFs and PNGs share framing.
const VIEWPORT = { width: 402, height: 874 };
const DEVICE_SCALE_FACTOR = 3;

// Animation config.
const FPS = 14;
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB budget

/**
 * Writes the screenshot seed to IndexedDB and localStorage in the page
 * context. Mirrors the implementation in capture-screenshots.mjs exactly --
 * keep the two in sync if the seed shape changes.
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

    localStorage.setItem(keys.KEY_CLIENT_SALT, "screenshot-seed");
    localStorage.setItem(keys.KEY_STREAK, JSON.stringify(streakDates));
    localStorage.setItem(keys.KEY_HAS_MASTERED, "true");

    const existingSettings = (() => {
      try { return JSON.parse(localStorage.getItem(keys.KEY_SETTINGS) ?? "{}"); }
      catch { return {}; }
    })();
    localStorage.setItem(keys.KEY_SETTINGS, JSON.stringify({
      ...existingSettings,
      maxNewPerDay: 0,
      maxNewEvolutionPerDay: 0,
      maxNewReversePerDay: 0,
      maxNewCryPerDay: 0,
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

    localStorage.removeItem(keys.KEY_SUPERUSER);
    localStorage.removeItem(keys.KEY_SUPERUSER_FLAGS);

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
    pikachuStepStartedAt: Date.now() - 120_000,
  });
}

/**
 * Runs the two-pass ffmpeg palette transcode from WebM to GIF.
 * Returns the output file size in bytes.
 */
async function transcodeToGif(webmPath, gifPath, fps) {
  const palettePath = webmPath.replace(".webm", "-palette.png");

  // Pass 1: generate an optimised palette from the video content.
  execSync(
    `ffmpeg -y -i "${webmPath}" ` +
    `-vf "fps=${fps},scale=${VIEWPORT.width}:-1:flags=lanczos,palettegen=max_colors=128" ` +
    `"${palettePath}"`,
    { stdio: "inherit" },
  );

  // Pass 2: apply the palette with Bayer dithering.
  execSync(
    `ffmpeg -y -i "${webmPath}" -i "${palettePath}" ` +
    `-lavfi "fps=${fps},scale=${VIEWPORT.width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer" ` +
    `"${gifPath}"`,
    { stdio: "inherit" },
  );

  // Clean up the intermediate palette file.
  try { await unlink(palettePath); } catch { /* non-fatal */ }

  const { size } = await stat(gifPath);
  return size;
}

async function captureCardFlip() {
  const seed = buildScreenshotSeed();

  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(TMP_DIR, { recursive: true });

  const browser = await chromium.launch();
  let webmPath;
  try {
    // Record video at the CSS pixel dimensions; Playwright records at CSS size
    // regardless of deviceScaleFactor (the recorded content is at CSS scale).
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      recordVideo: {
        dir: TMP_DIR,
        size: VIEWPORT,
      },
    });

    const page = await ctx.newPage();

    // Initialise the origin and inject the deterministic seed.
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await writeSeedToPage(page, seed);

    // Navigate to practice and wait for the card to settle.
    await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 30_000 }).catch(async (err) => {
      if (!String(err).includes("Timeout")) {
        process.stderr.write(`Navigation failed: ${err}\n`);
        process.exit(1);
      }
    });

    // Hide the Next.js dev-tools indicator so it does not appear in the GIF.
    await page.evaluate(() => {
      document
        .querySelectorAll("nextjs-portal")
        .forEach((el) => (el.style.display = "none"));
    });

    // Wait for the card front to fully render with the Pikachu sprite.
    await page.waitForTimeout(1200);

    // Pause on the card front so the viewer can read the question.
    await page.waitForTimeout(1000);

    // Click Reveal to flip the card.
    await page.getByRole("button", { name: /reveal/i }).first().click();

    // Wait for the flip animation to complete and grade buttons to appear.
    await page.waitForTimeout(1200);

    // Pause on the flipped card so the viewer can read the answer.
    await page.waitForTimeout(800);

    // Click Good to grade the card.
    await page.getByRole("button", { name: /good/i }).first().click();

    // Wait for the transition to complete.
    await page.waitForTimeout(800);

    // Close the context to flush the video file to disk.
    await ctx.close();

    // Playwright names the WebM with a hash; find it in the tmp dir.
    const webmFiles = (await readdir(TMP_DIR)).filter((f) => f.endsWith(".webm"));
    if (webmFiles.length === 0) {
      throw new Error(`No WebM found in ${TMP_DIR}`);
    }
    webmPath = join(TMP_DIR, webmFiles[0]);
    console.log(`  Recorded: ${webmPath}`);
  } finally {
    await browser.close();
  }

  // Transcode to GIF.
  const gifPath = join(OUT_DIR, "practice-cardflip.gif");
  console.log(`  Transcoding to GIF at ${FPS} fps...`);
  const sizeBytes = await transcodeToGif(webmPath, gifPath, FPS);

  const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
  console.log(`  practice-cardflip.gif  (${sizeMB} MB)`);

  if (sizeBytes > MAX_BYTES) {
    console.warn(
      `  WARNING: GIF is ${sizeMB} MB, which exceeds the 4 MB budget.` +
      ` Consider lowering FPS or shortening the clip.`,
    );
  }

  // Clean up the WebM and tmp dir.
  try {
    await unlink(webmPath);
    execSync(`rmdir "${TMP_DIR}" 2>/dev/null || true`);
  } catch {
    // Non-fatal; temp files are safe to leave.
  }

  return sizeBytes;
}

async function main() {
  console.log("Capturing practice card-flip animation...");
  const sizeBytes = await captureCardFlip();
  const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
  console.log(`\nAnimation saved to docs/screenshots/practice-cardflip.gif (${sizeMB} MB)`);
  console.log("Review the GIF, then commit it with the PR.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
