import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Visual-regression specs (e2e/visual.spec.ts) are opt-in: they only run under
// the dedicated `--project` legs below, and the functional projects ignore
// them. This keeps `npm run test:e2e` (functional smoke) and the visual
// snapshot job cleanly separate. See WORKFLOW.md → "Visual-regression gate".
const VISUAL_SPEC = "**/visual.spec.ts";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI ? "github" : "html",
  // Snapshot baselines are committed under e2e/visual.spec.ts-snapshots/ and
  // are platform-tagged. CI generates and compares them inside the pinned
  // mcr.microsoft.com/playwright Docker image so Linux font rendering is
  // deterministic; never regenerate baselines from a developer macOS machine.
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      // Tolerance bounds. `threshold` is the per-pixel colour-distance cutoff
      // (0-1) that absorbs sub-pixel anti-aliasing jitter; `maxDiffPixelRatio`
      // bounds the fraction of the whole frame allowed to differ. Both are
      // deliberately small so a real layout shift still fails the comparison
      // while harmless rasterisation noise does not.
      threshold: 0.25,
      maxDiffPixelRatio: 0.02,
      // Disable CSS animations/transitions and the blinking caret so a frame is
      // byte-stable between runs.
      animations: "disabled",
      caret: "hide",
    },
  },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    // --- Functional smoke projects -----------------------------------------
    // These run the full e2e/ suite EXCEPT the visual snapshot spec.
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: VISUAL_SPEC,
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
      testIgnore: VISUAL_SPEC,
    },
    {
      name: "desktop-webkit",
      use: { ...devices["Desktop Safari"] },
      testIgnore: VISUAL_SPEC,
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
      testIgnore: VISUAL_SPEC,
    },
    // --- Visual-regression projects ----------------------------------------
    // These run ONLY the visual snapshot spec. The spec drives both a mobile
    // and a desktop viewport per surface internally via test.use(), so two
    // projects (one Chromium, one WebKit engine) give cross-engine coverage
    // without multiplying the matrix.
    {
      name: "visual-chromium",
      use: { ...devices["Desktop Chrome"] },
      testMatch: VISUAL_SPEC,
    },
    {
      name: "visual-webkit",
      use: { ...devices["Desktop Safari"] },
      testMatch: VISUAL_SPEC,
    },
  ],
});
