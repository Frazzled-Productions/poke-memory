/**
 * E2E tests for the QA seed mode feature (#1326).
 *
 * These tests work by injecting scenario payloads directly into IDB via the
 * same approach as other E2E tests (addInitScript / seedIdb). This lets us
 * verify the core AC:
 *
 *   fsrs-locale-mastery + switch to ja → Pasture shows 0 mastered
 *
 * The scenario payload itself (built by lib/qa-seed/scenarios.ts) is tested
 * at the unit level (lib/qa-seed/scenarios.test.ts). The E2E test focuses on
 * the integration: does the app correctly respond to the seeded state?
 *
 * The Settings Developer-area UI section (flag toggle + scenario dropdown) is
 * tested at the component level (components/settings/QaSeedSection.test.tsx).
 * End-to-end wiring of the toggle is smoke-tested here via the superuser
 * localStorage seed pattern used throughout this test suite.
 */

import { test, expect } from "@playwright/test";
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";
import { addOnboardingPreDismiss } from "./helpers/onboarding";
import { buildFsrsLocaleMasteryScenario } from "../lib/qa-seed/scenarios";

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed the superuser flags so the Developer panel is visible in Settings
 * and qaSeedMode is on. Mirrors the approach in e2e/superuser.spec.ts.
 */
async function seedQaSeedMode(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("poke-memory:superuser", "true");
    window.localStorage.setItem(
      "poke-memory:superuser:flags:v1",
      JSON.stringify({ qaSeedMode: true }),
    );
  });
}

/**
 * Seed localStorage settings with pokemonNameLocale='ja' and the languages
 * Labs flag enabled, so filterMastered uses 'ja' as the locale gate.
 */
async function seedJapanesePokemonLocale(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      const KEY = "poke-memory:settings:v1";
      const raw = localStorage.getItem(KEY);
      let existing: Record<string, unknown> = {};
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (typeof parsed === "object" && parsed !== null) {
            existing = parsed as Record<string, unknown>;
          }
        } catch {
          /* ignore */
        }
      }
      localStorage.setItem(
        KEY,
        JSON.stringify({
          ...existing,
          pokemonNameLocale: "ja",
          labsFlags: {
            ...(typeof existing.labsFlags === "object" && existing.labsFlags !== null
              ? (existing.labsFlags as Record<string, unknown>)
              : {}),
            languages: true,
          },
        }),
      );
    } catch {
      /* localStorage unavailable */
    }
  });
}

// ---------------------------------------------------------------------------
// AC: fsrs-locale-mastery scenario seeds correctly
// ---------------------------------------------------------------------------

test.describe("QA seed — fsrs-locale-mastery scenario", () => {
  test("seeded en-locale cards appear as mastered in Pasture under en locale", async ({
    page,
  }) => {
    // Seed the fsrs-locale-mastery scenario: ~30 mastered en-locale pairs.
    const payload = buildFsrsLocaleMasteryScenario();
    await seedSessionIdb(page, payload.session);

    // Ensure mobileNav is set so the Pasture tab is reachable.
    await page.addInitScript(() => {
      try {
        const KEY = "poke-memory:settings:v1";
        const raw = localStorage.getItem(KEY);
        const existing =
          raw !== null
            ? (() => {
                try {
                  return JSON.parse(raw) as Record<string, unknown>;
                } catch {
                  return {};
                }
              })()
            : {};
        localStorage.setItem(
          KEY,
          JSON.stringify({ ...existing, mobileNav: "bottom" }),
        );
      } catch {
        /* ignore */
      }
    });

    await page.goto("/pasture");
    await awaitSeedIdb(page);

    // With en locale (default), at least one mastered habitat zone should render.
    // The scenario seeds forest and grassland habitats, among others.
    // The Pasture page should NOT show the "empty" message.
    await expect(
      page.getByText(/your pasture is empty/i),
    ).not.toBeVisible({ timeout: 10_000 });

    // At least one habitat zone label should be present (e.g. "Forest zone").
    // filterMastered returns 30+ cards with locale='en', so the page is populated.
    await expect(
      page.getByRole("region", { name: /forest zone/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("switching pokemonNameLocale to ja shows 0 mastered (empty Pasture)", async ({
    page,
  }) => {
    // Seed the fsrs-locale-mastery scenario: all cards have locale='en'.
    const payload = buildFsrsLocaleMasteryScenario();
    await seedSessionIdb(page, payload.session);

    // Override pokemonNameLocale to 'ja' in settings.
    // filterMastered will find no 'ja'-locale cards → 0 mastered → empty state.
    await seedJapanesePokemonLocale(page);

    await page.goto("/pasture");
    await awaitSeedIdb(page);

    // The empty-state message must appear because all seeded cards are locale='en'
    // and filterMastered now only counts locale='ja' cards.
    await expect(
      page.getByText(/your pasture is empty/i),
    ).toBeVisible({ timeout: 10_000 });

    // No habitat zones should render — there are no mastered ja-locale cards.
    await expect(
      page.getByRole("region", { name: /forest zone/i }),
    ).not.toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// AC: QA seed flag appears in Developer section when superuser unlocked
// ---------------------------------------------------------------------------

test.describe("QA seed — Developer panel toggle", () => {
  test("qaSeedMode flag toggle is visible in the Developer section", async ({
    page,
  }) => {
    await seedQaSeedMode(page);
    await page.goto("/settings");

    // Expand the Advanced section.
    await page.getByRole("button", { name: /^advanced$/i }).click();

    // The Developer section should be visible (superuser is unlocked).
    await expect(
      page.getByText("Developer", { exact: true }),
    ).toBeVisible({ timeout: 5_000 });

    // The qaSeedMode toggle should be present.
    await expect(
      page.getByRole("switch", { name: /QA seed mode/i }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("QA seed panel is visible inside Developer section when qaSeedMode is on", async ({
    page,
  }) => {
    await seedQaSeedMode(page);
    await page.goto("/settings");

    // Expand the Advanced section.
    await page.getByRole("button", { name: /^advanced$/i }).click();

    // The QA seed panel should be visible.
    await expect(
      page.getByText("QA seed"),
    ).toBeVisible({ timeout: 5_000 });

    // The scenario dropdown should be present.
    await expect(
      page.getByRole("combobox", { name: /Scenario/i }),
    ).toBeVisible({ timeout: 5_000 });

    // Apply seed and Clear seed buttons should be present.
    await expect(
      page.getByRole("button", { name: /Apply QA seed scenario/i }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("button", { name: /Clear QA seed/i }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
