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
    const developerSection = page.getByRole("region", { name: /developer/i });
    await expect(developerSection).toBeVisible({ timeout: 10_000 });
    // QA seed panel should NOT be visible.
    await expect(page.getByTestId("qa-seed-section")).toHaveCount(0);
  });

  test("QA seed panel renders with scenario picker when qaSeedMode is on", async ({ page }) => {
    await seedSuperuserWithQaSeed(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Advanced", exact: true }).click();

    const developerSection = page.getByRole("region", { name: /developer/i });
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
    const developerSection = page.getByRole("region", { name: /developer/i });
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

    // Navigate to the Pasture — it should be populated (not the empty-state).
    await page.goto("/pasture");

    // The Pasture heading must be visible (not the empty-state copy).
    await expect(
      page.getByRole("heading", { level: 1, name: /Pasture/i }),
    ).toBeVisible({ timeout: 15_000 });

    // The empty-state copy must NOT be present.
    await expect(page.getByText(/Your pasture is empty/i)).toHaveCount(0);
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

    const developerSection = page.getByRole("region", { name: /developer/i });
    await expect(developerSection).toBeVisible({ timeout: 10_000 });

    // The qaSeedMode toggle must be present with aria-checked=false.
    const toggle = developerSection.getByRole("switch", { name: /qa seed mode/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});
