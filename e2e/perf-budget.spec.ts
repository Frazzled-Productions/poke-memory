/**
 * Fresh-visitor performance budget (#1268)
 *
 * Measures time-to-interactive on a clean session (no localStorage, no IndexedDB
 * pre-seed) on the practice page — the heaviest initial load because it parses
 * and hydrates the seed JSON before rendering the first card.
 *
 * The metric: navigation `loadEventEnd - startTime` (ms). This includes HTML
 * parse, all blocking resources, and the `load` event — a reliable proxy for
 * "the page has finished its initial work". We then additionally wait until the
 * above-fold interactive element (Reveal button or end-state heading) is visible,
 * which exercises the React hydration + IDB seed path.
 *
 * Budget values — ratchet these DOWN as perf improves, never up:
 */
const BUDGETS = {
  /** Chromium (V8, fast JSON parse). */
  chromium: 5_000,
  /** WebKit (mobile-safari project, slower parse + smaller render pipeline). */
  "mobile-safari": 8_000,
  /** desktop-webkit — same engine as mobile-safari, same budget. */
  "desktop-webkit": 8_000,
  /** mobile-chrome — same engine as chromium, same budget. */
  "mobile-chrome": 5_000,
} as const;

const DEFAULT_BUDGET_MS = 8_000;

import { test, expect } from "@playwright/test";

test.describe("Fresh-visitor performance budget (#1268)", () => {
  /**
   * Both storage states start empty — no localStorage keys, no IDB entries.
   * The `storageState` override enforces this regardless of any global fixture.
   */
  test.use({ storageState: { cookies: [], origins: [] } });

  test("practice page loads within budget on a fresh visit", async ({
    page,
  }, testInfo) => {
    // Gated on PERF_BUDGET=1 so the spec is invisible to the normal e2e.yml /
    // ci.yml runs. A dedicated perf-budget.yml workflow runs it explicitly
    // with the env var set. Keeping it out of the required `e2e` matrix means
    // a flaky budget breach cannot block merges while the baseline is still
    // stabilising — promotion to required is a separate decision (see
    // WORKFLOW.md "Perf budget gate" and #1268).
    test.skip(
      process.env.PERF_BUDGET !== "1",
      "PERF_BUDGET=1 required to run perf budget tests",
    );

    // Pre-dismiss the onboarding modal via localStorage so it does not block
    // the interactive element we are waiting for. addInitScript runs before
    // page.goto, so it is set before the app bootstraps.
    await page.addInitScript(() => {
      const settings = JSON.parse(
        localStorage.getItem("poke-memory:settings:v1") ?? "{}",
      );
      localStorage.setItem(
        "poke-memory:settings:v1",
        JSON.stringify({ ...settings, firstVisitOnboardingDismissed: true }),
      );
    });

    // Start the navigation timer from just before goto so we capture the
    // full round-trip including network. The `navigation` PerformanceTiming
    // entry's `loadEventEnd - startTime` measures the same wall-clock span
    // inside the renderer — use that as the canonical figure.
    const gotoStart = Date.now();

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Wait for the above-fold interactive element. This is the key
    // time-to-interactive signal: the seed JSON has been parsed, IDB seeded,
    // and React has rendered a usable card or an end-state.
    const reveal = page.getByRole("button", { name: "Reveal" });
    const endState = page.getByRole("heading", {
      name: /All caught up|Daily review limit reached|New cards locked|Next card in|No card types enabled/,
    });
    await expect(reveal.or(endState)).toBeVisible({
      timeout: DEFAULT_BUDGET_MS + 2_000, // grace above budget so we can log the overrun
    });

    const wallMs = Date.now() - gotoStart;

    // Gather the browser-internal load timing (more accurate than wall-clock).
    const navTiming = await page.evaluate(() => {
      const entries = performance.getEntriesByType(
        "navigation",
      ) as PerformanceNavigationTiming[];
      if (entries.length === 0) return null;
      const nav = entries[0];
      return {
        loadEventEnd: Math.round(nav.loadEventEnd),
        domContentLoaded: Math.round(
          nav.domContentLoadedEventEnd - nav.startTime,
        ),
        loadComplete: Math.round(nav.loadEventEnd - nav.startTime),
      };
    });

    const project = testInfo.project.name as keyof typeof BUDGETS;
    const budgetMs = BUDGETS[project] ?? DEFAULT_BUDGET_MS;

    // Always log the measured times so CI output is useful for baseline tracking.
    console.log(
      `[perf-budget] project=${project} wall=${wallMs}ms ` +
        `dcl=${navTiming?.domContentLoaded ?? "n/a"}ms ` +
        `load=${navTiming?.loadComplete ?? "n/a"}ms ` +
        `budget=${budgetMs}ms`,
    );

    // Assert against wall-clock time-to-interactive (more representative than
    // the browser's load event alone, because it includes the IDB seed path).
    expect(
      wallMs,
      `Fresh-visit time-to-interactive (${wallMs}ms) exceeded the ${project} budget (${budgetMs}ms). ` +
        `See e2e/perf-budget.spec.ts BUDGETS constant to update after deliberate regressions, ` +
        `or investigate the cause if this is unexpected.`,
    ).toBeLessThanOrEqual(budgetMs);
  });
});
