/**
 * Fresh-visitor performance budget (#1268)
 *
 * Measures time-to-interactive on a clean session (no localStorage, no IndexedDB
 * pre-seed) on the practice page - the heaviest initial load because it parses
 * and hydrates the seed JSON before rendering the first card.
 *
 * The metric: navigation `loadEventEnd - startTime` (ms). This includes HTML
 * parse, all blocking resources, and the `load` event - a reliable proxy for
 * "the page has finished its initial work". We then additionally wait until the
 * above-fold interactive element (Reveal button or end-state heading) is visible,
 * which exercises the React hydration + IDB seed path.
 *
 * Budget values - ratchet these DOWN as perf improves, never up:
 */
const BUDGETS = {
  /** Chromium (V8, fast JSON parse). */
  chromium: 5_000,
  /** WebKit (mobile-safari project, slower parse + smaller render pipeline). */
  "mobile-safari": 8_000,
  /** desktop-webkit - same engine as mobile-safari, same budget. */
  "desktop-webkit": 8_000,
  /** mobile-chrome - same engine as chromium, same budget. */
  "mobile-chrome": 5_000,
} as const;

const DEFAULT_BUDGET_MS = 8_000;

import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";
import { practiceReadyLocator } from "./helpers/practiceCard";

test.describe("Fresh-visitor performance budget (#1268)", () => {
  /**
   * Both storage states start empty - no localStorage keys, no IDB entries.
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
    // stabilising - promotion to required is a separate decision (see
    // WORKFLOW.md "Perf budget gate" and #1268).
    test.skip(
      process.env.PERF_BUDGET !== "1",
      "PERF_BUDGET=1 required to run perf budget tests",
    );

    // Pre-dismiss the onboarding modal using the shared helper (#1298).
    //
    // The previous inline addInitScript set `firstVisitOnboardingDismissed`
    // at the top level of the settings blob, but
    // FirstVisitOnboardingModal.tsx reads it from
    // `settings.onboarding?.firstVisitOnboardingDismissed` (a nested path).
    // When the flag was at the wrong level the modal opened, applied `inert`
    // to #app-root, and Playwright could not find the Reveal button - causing
    // "perf budget exceeded" to measure "time to give up", not actual load
    // time. The helper nests the flag correctly under `onboarding`.
    await addOnboardingPreDismiss(page);

    // Start the navigation timer from just before goto so we capture the
    // full round-trip including network. The `navigation` PerformanceTiming
    // entry's `loadEventEnd - startTime` measures the same wall-clock span
    // inside the renderer - use that as the canonical figure.
    const gotoStart = Date.now();

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Defensive guard: confirm the onboarding modal is absent before
    // measuring. If it is present, `inert` on #app-root will block the
    // Reveal button and the timeout will measure "time to give up" rather
    // than the actual load time (#1298).
    await expect(
      page.getByRole("dialog", { name: /welcome to pok[eé] memory/i }),
    ).toHaveCount(0, { timeout: 5_000 });

    // Wait for the above-fold interactive element. This is the key
    // time-to-interactive signal: the seed JSON has been parsed, IDB seeded,
    // and React has rendered a usable card or an end-state. The first card may
    // be a flip card, sprite-picker, or multiple-choice card depending on the
    // deterministic per-day shuffle (#1370) - all three are equally
    // "interactive", so match every variant rather than only the Reveal flip.
    await expect(practiceReadyLocator(page)).toBeVisible({
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
