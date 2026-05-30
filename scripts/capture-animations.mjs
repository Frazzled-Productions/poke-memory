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
 *   practice-cardflip.gif  -- settled card front (Pikachu) -> cursor moves to
 *                             Reveal + ripple + click -> card flips (name +
 *                             grade buttons) -> cursor moves to Good + ripple
 *                             + click -> next card
 *
 * The same deterministic seed used by capture-screenshots.mjs is injected
 * here (scripts/screenshot-seed.mjs, Pikachu #25 staged as the due card),
 * so the GIF always features Pikachu as the protagonist.
 *
 * FIRST-FRAME GUARANTEE
 *
 * The capture does a dry-run navigation first (without recording) to measure
 * the wall-clock time from context creation to fully-settled card front. The
 * recorded pass then trims the WebM at that offset before transcoding, so the
 * GIF opens on the fully rendered Pikachu card front -- no spinner, no blank
 * frame, no layout shift.
 *
 * CLICK AFFORDANCE
 *
 * Playwright video captures the page canvas, not the OS cursor. A synthetic
 * cursor element is injected via page.evaluate before recording starts. Before
 * each programmatic click the cursor animates to the target button centre and
 * plays a brief tap-ripple, then the click fires. Both interactions are
 * clearly visible in the GIF.
 *
 * Transcode pipeline: Playwright records WebM -> ffmpeg -ss trim -> two-pass
 * palettegen / paletteuse -> optimised GIF. Target: <= 4 MB, fps 14, Lanczos.
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

// How long to pause on the settled card front before clicking Reveal (ms).
const PAUSE_ON_FRONT_MS = 900;
// How long to wait after the flip before clicking Good (ms).
const PAUSE_ON_FLIPPED_MS = 900;
// Extra settle buffer added on top of the measured dry-run settle time (ms).
const SETTLE_BUFFER_MS = 500;
// Duration of the cursor move CSS transition (ms).
const CURSOR_MOVE_MS = 400;
// Duration of the tap-ripple animation (ms).
const RIPPLE_DURATION_MS = 400;

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
 * Waits for the practice card front to be fully settled:
 * - A sprite img inside <main> is visible.
 * - The "???" question-mark text is present in the page.
 * - The Next.js dev-tools indicator is hidden.
 */
async function waitForCardSettled(page) {
  // Wait for any sprite image inside the main card area to be visible.
  await page.waitForSelector('main img', { state: "visible", timeout: 20_000 }).catch(() => {});

  // Wait for the "???" question mark that appears on the card front.
  await page.waitForFunction(() => {
    return (document.body.textContent ?? "").includes("???");
  }, { timeout: 15_000 }).catch(() => {
    // "???" may differ -- proceed after sprite is ready.
  });

  // Hide the Next.js dev-tools indicator so it does not appear in the GIF.
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => {
      el.style.display = "none";
    });
  });

  // Allow one more paint cycle to complete.
  await page.waitForTimeout(200);
}

/**
 * Injects a synthetic cursor element into the page so click interactions are
 * visible in the recorded video. The cursor is a small filled circle. Before
 * each click it moves smoothly to the target button centre (CSS transition),
 * plays a tap-ripple ring, then the real Playwright click fires.
 */
async function injectCursor(page) {
  await page.addStyleTag({
    content: `
      #pw-cursor {
        position: fixed;
        z-index: 999999;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: rgba(99, 102, 241, 0.88);
        border: 2.5px solid rgba(255,255,255,0.92);
        box-shadow: 0 2px 10px rgba(0,0,0,0.38);
        pointer-events: none;
        transform: translate(-50%, -50%);
        transition: left 400ms cubic-bezier(0.4,0,0.2,1),
                    top  400ms cubic-bezier(0.4,0,0.2,1);
        will-change: left, top;
      }
      @keyframes pw-ripple {
        0%   { transform: translate(-50%,-50%) scale(0.4); opacity: 0.85; }
        100% { transform: translate(-50%,-50%) scale(3.5); opacity: 0; }
      }
      .pw-ripple-ring {
        position: fixed;
        z-index: 999998;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 2.5px solid rgba(99, 102, 241, 0.8);
        pointer-events: none;
        transform: translate(-50%,-50%) scale(0.4);
        animation: pw-ripple 400ms ease-out forwards;
      }
    `,
  });

  await page.evaluate(() => {
    const cursor = document.createElement("div");
    cursor.id = "pw-cursor";
    cursor.style.left = "-100px";
    cursor.style.top  = "-100px";
    document.body.appendChild(cursor);
  });
}

/**
 * Moves the synthetic cursor to the centre of the Playwright `locator`,
 * waits for the CSS transition, plays a tap-ripple, then performs the click.
 *
 * Uses Playwright's locator.boundingBox() to resolve coordinates, so
 * Playwright-only selectors (getByRole, getByText, etc.) work correctly.
 */
async function cursorClickLocator(page, locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("cursorClickLocator: element not found or not visible");
  }

  const x = Math.round(box.x + box.width  / 2);
  const y = Math.round(box.y + box.height / 2);

  // Move the cursor to the button centre (CSS transition animates the move).
  await page.evaluate(([cx, cy]) => {
    const cursor = document.getElementById("pw-cursor");
    if (cursor) {
      cursor.style.left = cx + "px";
      cursor.style.top  = cy + "px";
    }
  }, [x, y]);

  // Wait for the 400ms CSS transition to finish.
  await page.waitForTimeout(CURSOR_MOVE_MS + 60);

  // Inject a ripple ring at the same position.
  await page.evaluate(([cx, cy]) => {
    const ring = document.createElement("div");
    ring.className = "pw-ripple-ring";
    ring.style.left = cx + "px";
    ring.style.top  = cy + "px";
    document.body.appendChild(ring);
    setTimeout(() => ring.remove(), 550);
  }, [x, y]);

  // Short pause so the ripple onset is visible before the click fires.
  await page.waitForTimeout(160);

  // Perform the real click via the locator.
  await locator.click();
}

/**
 * Runs the two-pass ffmpeg palette transcode from WebM to GIF.
 * `trimSecs` trims that many seconds from the start of the WebM so the GIF
 * opens on the first fully-settled frame rather than a page-load state.
 * Returns the output file size in bytes.
 */
async function transcodeToGif(webmPath, gifPath, fps, trimSecs) {
  const palettePath = webmPath.replace(".webm", "-palette.png");
  const trimArg = trimSecs > 0 ? `-ss ${trimSecs.toFixed(3)} ` : "";

  // Pass 1: generate an optimised palette from the (trimmed) video content.
  execSync(
    `ffmpeg -y ${trimArg}-i "${webmPath}" ` +
    `-vf "fps=${fps},scale=${VIEWPORT.width}:-1:flags=lanczos,palettegen=max_colors=128" ` +
    `"${palettePath}"`,
    { stdio: "inherit" },
  );

  // Pass 2: apply the palette with Bayer dithering to the trimmed content.
  execSync(
    `ffmpeg -y ${trimArg}-i "${webmPath}" -i "${palettePath}" ` +
    `-lavfi "fps=${fps},scale=${VIEWPORT.width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer" ` +
    `"${gifPath}"`,
    { stdio: "inherit" },
  );

  // Clean up the intermediate palette file.
  try { await unlink(palettePath); } catch { /* non-fatal */ }

  const { size } = await stat(gifPath);
  return size;
}

/**
 * Creates a Playwright browser context with the shared viewport / UA / video
 * settings. Pass `record: false` for the dry-run phase.
 */
async function newContext(browser, record) {
  return browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    ...(record
      ? {
          recordVideo: {
            dir: TMP_DIR,
            size: VIEWPORT,
          },
        }
      : {}),
  });
}

/**
 * Navigates to the practice page and injects the seed.
 * Returns the wall-clock milliseconds elapsed from the call start to when the
 * function returns (i.e. the full two-goto round-trip cost). In the dry-run
 * phase, this duration is measured and used as the ffmpeg trim offset.
 */
async function navigateAndSeed(page, seed) {
  // Initialise the origin and write the seed into IndexedDB/localStorage.
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await writeSeedToPage(page, seed);

  // Hard-reload so the app reads from the seeded storage.
  await page.goto(`${BASE_URL}/`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  }).catch((err) => {
    if (!String(err).includes("Timeout")) {
      process.stderr.write(`Navigation failed: ${err}\n`);
      process.exit(1);
    }
  });
}

async function captureCardFlip() {
  const seed = buildScreenshotSeed();

  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(TMP_DIR, { recursive: true });

  const browser = await chromium.launch();

  // ─── Phase 1: dry-run without recording ─────────────────────────────────
  // Measure the total wall-clock time from context creation to the point where
  // the card is fully settled. The WebM recording (phase 2) starts at context
  // creation, so this measured offset is exactly what to trim from the WebM
  // front -- the result is a GIF whose first frame is the settled card.

  console.log("  Phase 1: measuring page settle time (no recording)...");
  let totalSettleMs;
  {
    const t0 = Date.now();
    const ctx = await newContext(browser, false);
    const page = await ctx.newPage();
    await navigateAndSeed(page, seed);
    await waitForCardSettled(page);
    totalSettleMs = Date.now() - t0;
    await ctx.close();
  }

  // Add a safety buffer and convert to seconds for ffmpeg -ss.
  const trimSecs = Math.max(0, (totalSettleMs + SETTLE_BUFFER_MS) / 1000);
  console.log(
    `  Measured settle: ${totalSettleMs} ms. Will trim first ${trimSecs.toFixed(2)}s from WebM.`,
  );

  // ─── Phase 2: recorded pass ──────────────────────────────────────────────

  console.log("  Phase 2: recording...");
  let webmPath;
  try {
    const ctx = await newContext(browser, true);
    const page = await ctx.newPage();

    await navigateAndSeed(page, seed);

    // Wait for the card to settle (same sequence as the dry run).
    await waitForCardSettled(page);

    // Dwell on the settled card front so the viewer can read the question.
    await page.waitForTimeout(PAUSE_ON_FRONT_MS);

    // Inject the synthetic cursor AFTER the card is settled so it does not
    // appear during the load phase (which will be trimmed by ffmpeg anyway).
    await injectCursor(page);

    // Brief pause so the cursor appears on-screen before moving.
    await page.waitForTimeout(250);

    // ── Interaction 1: Reveal (flip the card) ────────────────────────────
    const revealLocator = page.getByRole("button", { name: /reveal/i }).first();
    await cursorClickLocator(page, revealLocator);

    // Wait for the flip animation and grade buttons to appear.
    await page.getByRole("button", { name: /good/i }).first().waitFor({
      state: "visible",
      timeout: 8_000,
    });
    await page.waitForTimeout(PAUSE_ON_FLIPPED_MS);

    // ── Interaction 2: Good (grade the card) ─────────────────────────────
    const goodLocator = page.getByRole("button", { name: /good/i }).first();
    await cursorClickLocator(page, goodLocator);

    // Dwell briefly on the next card so the loop feels complete.
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

  // ─── Phase 3: transcode ──────────────────────────────────────────────────

  const gifPath = join(OUT_DIR, "practice-cardflip.gif");
  console.log(
    `  Transcoding to GIF at ${FPS} fps (trimming ${trimSecs.toFixed(2)}s)...`,
  );
  const sizeBytes = await transcodeToGif(webmPath, gifPath, FPS, trimSecs);

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
