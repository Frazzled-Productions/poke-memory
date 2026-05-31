/**
 * E2E smoke tests for the StreakNavChip (#1439 / #1442).
 *
 * Verifies that:
 * - The streak chip renders in the desktop nav (chromium).
 * - The streak chip links to /stats.
 * - The Stats tab in the mobile bottom bar links to /stats (mobile-safari).
 *
 * Guest mode only. The chip shows "Start your streak" on a fresh session
 * (no review history in localStorage).
 */

import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

// ─── Desktop — streak chip in header nav ─────────────────────────────────────

test.describe("StreakNavChip — desktop nav", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "desktop nav check is chromium-only",
    );
  });

  test("streak chip is present in the desktop nav and links to /stats", async ({ page }) => {
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Main navigation" });

    // The chip is a link to /stats. On a fresh session (no streak data) it
    // shows "Start your streak" or the current streak count.
    const chip = nav.getByRole("link", { name: /streak|start your streak/i });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("href", "/stats");
  });

  test("clicking the streak chip navigates to /stats", async ({ page }) => {
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const chip = nav.getByRole("link", { name: /streak|start your streak/i });
    await chip.click();

    await expect(page).toHaveURL("/stats");
  });
});

// ─── Mobile — Stats tab links to /stats ──────────────────────────────────────

test.describe("StreakNavChip — mobile Stats tab overlay", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "mobile tab bar checks are mobile-only",
    );

    // Ensure bottom tab bar mode.
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        "poke-memory:settings:v1",
        JSON.stringify({
          onboarding: { firstVisitOnboardingDismissed: true },
          mobileNav: "bottom",
        }),
      );
    });
    await page.reload();
  });

  test("Stats tab is present in the mobile bottom bar", async ({ page }) => {
    await page.goto("/");

    const tabBar = page.getByRole("navigation", { name: "Mobile tab navigation" });
    await expect(tabBar.getByRole("link", { name: /stats/i })).toBeVisible();
  });

  test("tapping the Stats tab navigates to /stats", async ({ page }) => {
    await page.goto("/");

    const tabBar = page.getByRole("navigation", { name: "Mobile tab navigation" });
    await tabBar.getByRole("link", { name: /stats/i }).click();

    await expect(page).toHaveURL("/stats");
  });
});
