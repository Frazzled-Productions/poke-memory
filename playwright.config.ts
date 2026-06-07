import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Visual-regression specs (e2e/visual.spec.ts) are opt-in. They run ONLY under
// the dedicated `visual-*` projects below (`npm run test:visual`); the
// functional projects additionally `testIgnore` the spec as defence in depth.
// `npm run test:e2e` names the functional projects explicitly so a developer
// run on macOS never compares against Linux-generated baselines. This keeps
// the functional smoke suite and the visual snapshot job cleanly separate.
// See WORKFLOW.md → "Visual-regression gate".
const VISUAL_SPEC = "**/visual.spec.ts";

// Real-auth spec runs ONLY under the dedicated `e2e-real-auth` CI job, which
// bakes the QA Supabase env into its own build. The functional projects exclude
// it so `e2e-browser` never picks it up without that env (beforeAll throws on
// missing NEXT_PUBLIC_SUPABASE_URL, turning every retry into a hard failure).
const AUTH_REAL_SPEC = "**/auth-real.spec.ts";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  // In CI we pair the `github` reporter (writes annotations only) with the
  // `html` reporter so the `playwright-report/` directory exists on disk for
  // the `actions/upload-artifact` step in visual-regression.yml / e2e.yml /
  // ci.yml. Without the html leg, the directory is never created and the
  // upload silently produces an empty artifact (#1127). `open: "never"`
  // prevents the reporter from spawning a browser on the runner.
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : "html",
  // Snapshot baselines are committed under e2e/__screenshots__/<projectName>/
  // and are platform-tagged. CI generates and compares them inside the pinned
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
      // as stable as possible between runs. The comparison is still fuzzy, not
      // byte-exact: the `threshold` / `maxDiffPixelRatio` tolerances above
      // absorb harmless rasterisation noise.
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
      testIgnore: [VISUAL_SPEC, AUTH_REAL_SPEC],
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
      testIgnore: [VISUAL_SPEC, AUTH_REAL_SPEC],
    },
    {
      name: "desktop-webkit",
      use: { ...devices["Desktop Safari"] },
      testIgnore: [VISUAL_SPEC, AUTH_REAL_SPEC],
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
      testIgnore: [VISUAL_SPEC, AUTH_REAL_SPEC],
    },
    // --- Real-auth project -------------------------------------------------
    // Runs ONLY the real-auth spec against the QA Supabase project. The
    // e2e-real-auth CI job builds with the QA env baked in and selects this
    // project; all functional projects testIgnore the spec so it never runs
    // without that env.
    {
      name: "auth-real",
      use: { ...devices["Desktop Chrome"] },
      testMatch: AUTH_REAL_SPEC,
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
