/**
 * E2E tests for QA seed mode (#1326).
 *
 * Verifies that:
 * 1. The QA seed panel appears in the Developer section when qaSeedMode is on.
 * 2. Applying the `pasture-progression` scenario populates the Pasture with
 *    real mastered species (not via pretendAllMastered).
 * 3. The "Apply seed" button triggers a confirm dialog and writes state.
 *
 * Guest-mode / local-only: no auth required.
 */

import { test, expect, type Page } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

// Seeds localStorage so the Developer panel is visible without exercising the
// chord/tap gesture. qaSeedMode=true reveals the QA seed panel.
async function seedSuperuserWithQaSeed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("poke-memory:superuser", "true");
    window.localStorage.setItem(
      "poke-memory:superuser:flags:v1",
      JSON.stringify({
        pretendAllMastered: false,
        forceNextStreakMilestone: false,
        forceCardsGraduated: false,
        qaSeedMode: true,
      }),
    );
  });
}

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

test.describe("QA seed mode", () => {
  test("QA seed panel is hidden when qaSeedMode flag is off", async ({ page }) => {
    // Seed superuser unlocked but qaSeedMode off.
    await page.addInitScript(() => {
      window.localStorage.setItem("poke-memory:superuser", "true");
      window.localStorage.setItem(
        "poke-memory:superuser:flags:v1",
        JSON.stringify({
          pretendAllMastered: false,
          forceNextStreakMilestone: false,
          forceCardsGraduated: false,
          qaSeedMode: false,
        }),
      );
    });
    await page.goto("/settings");
    // Expand Advanced section.
    await page.getByRole("button", { name: "Advanced", exact: true }).click();
    // Developer section should be visible.
    const developerSection = page.locator("#developer-heading");
    await expect(developerSection).toBeVisible({ timeout: 10_000 });
    // QA seed panel should NOT be visible.
    await expect(page.getByTestId("qa-seed-section")).toHaveCount(0);
  });

  test("QA seed panel renders with scenario picker when qaSeedMode is on", async ({ page }) => {
    await seedSuperuserWithQaSeed(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Advanced", exact: true }).click();

    const developerSection = page.locator("#developer-heading");
    await expect(developerSection).toBeVisible({ timeout: 10_000 });

    // The QA seed panel must be present.
    const seedPanel = page.getByTestId("qa-seed-section");
    await expect(seedPanel).toBeVisible();

    // The scenario dropdown must be present.
    const scenarioPicker = seedPanel.getByRole("combobox", { name: /scenario/i });
    await expect(scenarioPicker).toBeVisible();

    // "Apply seed" and "Clear seed" buttons must be present.
    await expect(seedPanel.getByRole("button", { name: /apply.*seed/i })).toBeVisible();
    await expect(seedPanel.getByRole("button", { name: /clear.*seed/i })).toBeVisible();
  });

  test("Applying pasture-progression scenario and reloading populates the Pasture", async ({ page }) => {
    await seedSuperuserWithQaSeed(page);
    await page.goto("/settings");

    // Accept the confirm dialog that appears when Apply seed is clicked.
    page.on("dialog", (dialog) => { void dialog.accept(); });

    await page.getByRole("button", { name: "Advanced", exact: true }).click();
    const developerSection = page.locator("#developer-heading");
    await expect(developerSection).toBeVisible({ timeout: 10_000 });

    const seedPanel = page.getByTestId("qa-seed-section");
    await expect(seedPanel).toBeVisible();

    // Select the pasture-progression scenario.
    await seedPanel.getByRole("combobox", { name: /scenario/i }).selectOption("pasture-progression");

    // Click "Apply seed".
    await seedPanel.getByRole("button", { name: /apply.*seed/i }).click();

    // Wait for the success status message.
    await expect(
      seedPanel.getByRole("status"),
    ).toContainText(/seed applied/i, { timeout: 10_000 });
    await expect(seedPanel.getByRole("status")).toContainText("Reload the page");

    // Reload the page (seeded state is now in IDB).
    await page.reload();

    // Navigate to the Pasture - it should be populated (not the empty-state).
    await page.goto("/pasture");

    // The Pasture heading must be visible (not the empty-state copy).
    await expect(
      page.getByRole("heading", { level: 1, name: /Pasture/i }),
    ).toBeVisible({ timeout: 15_000 });

    // The empty-state copy must NOT be present.
    await expect(page.getByText(/Your pasture is empty/i)).toHaveCount(0);
  });

  test("Applying mastery-gaps scenario and reloading shows Next arrivals content", async ({ page }) => {
    await seedSuperuserWithQaSeed(page);
    await page.goto("/settings");

    page.on("dialog", (dialog) => { void dialog.accept(); });

    await page.getByRole("button", { name: "Advanced", exact: true }).click();
    const developerSection = page.locator("#developer-heading");
    await expect(developerSection).toBeVisible({ timeout: 10_000 });

    const seedPanel = page.getByTestId("qa-seed-section");
    await expect(seedPanel).toBeVisible();

    // Select the mastery-gaps scenario.
    await seedPanel.getByRole("combobox", { name: /scenario/i }).selectOption("mastery-gaps");

    // Apply.
    await seedPanel.getByRole("button", { name: /apply.*seed/i }).click();
    await expect(seedPanel.getByRole("status")).toContainText(/seed applied/i, { timeout: 10_000 });

    // Active-seed indicator must reflect the chosen scenario immediately after apply.
    await expect(page.getByTestId("qa-seed-active-indicator")).toBeVisible();
    await expect(page.getByTestId("qa-seed-active-indicator")).toContainText("Mastery gaps");

    // Reload and navigate to the Pasture.
    await page.reload();
    await page.goto("/pasture");

    // "Next arrivals" section must be visible with actual content, not the empty state.
    const nextArrivalsSection = page.getByRole("region", { name: /next arrivals/i });
    await expect(nextArrivalsSection).toBeVisible({ timeout: 15_000 });
    await expect(
      nextArrivalsSection.getByText(/all reviewed.*already in your pasture/i),
    ).toHaveCount(0);
    // The arrivals list must exist.
    await expect(
      nextArrivalsSection.getByRole("list", { name: /upcoming pasture species/i }),
    ).toBeVisible();

    // Navigate to Journey and verify "Close to mastery" is populated - the
    // scenario description explicitly lists this as the second exercised behaviour.
    await page.goto("/journey");
    const closeToMasterySection = page.getByRole("region", { name: /close to mastery/i });
    await expect(closeToMasterySection).toBeVisible({ timeout: 15_000 });
    // Empty-state copy must NOT be present (the list must have at least one entry).
    await expect(page.getByText(/no gap to close/i)).toHaveCount(0);
  });

  test("Active-seed indicator is shown on mount and cleared after Clear seed", async ({ page }) => {
    // Pre-set the active-seed key in localStorage before mount.
    await seedSuperuserWithQaSeed(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("poke-memory:qa-seed-active", "mastery-gaps");
    });
    await page.goto("/settings");
    await page.getByRole("button", { name: "Advanced", exact: true }).click();

    const developerSection = page.locator("#developer-heading");
    await expect(developerSection).toBeVisible({ timeout: 10_000 });

    const seedPanel = page.getByTestId("qa-seed-section");
    await expect(seedPanel).toBeVisible();

    // Active indicator must show on mount (restored from localStorage).
    await expect(page.getByTestId("qa-seed-active-indicator")).toBeVisible();
    await expect(page.getByTestId("qa-seed-active-indicator")).toContainText("Mastery gaps");

    // Clear the seed.
    page.on("dialog", (dialog) => { void dialog.accept(); });
    await seedPanel.getByRole("button", { name: /clear.*seed/i }).click();
    await expect(seedPanel.getByRole("status")).toContainText(/seed cleared/i, { timeout: 10_000 });

    // Indicator must be gone after clearing.
    await expect(page.getByTestId("qa-seed-active-indicator")).toHaveCount(0);
  });

  test("QA seed mode toggle appears in the Developer panel", async ({ page }) => {
    // Start with qaSeedMode off so we can toggle it on.
    await page.addInitScript(() => {
      window.localStorage.setItem("poke-memory:superuser", "true");
      window.localStorage.setItem(
        "poke-memory:superuser:flags:v1",
        JSON.stringify({
          pretendAllMastered: false,
          forceNextStreakMilestone: false,
          forceCardsGraduated: false,
          qaSeedMode: false,
        }),
      );
    });
    await page.goto("/settings");
    await page.getByRole("button", { name: "Advanced", exact: true }).click();

    const developerSection = page.locator("#developer-heading");
    await expect(developerSection).toBeVisible({ timeout: 10_000 });

    // The qaSeedMode toggle must be present with aria-checked=false.
    const toggle = developerSection.getByRole("switch", { name: /qa seed mode/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});
