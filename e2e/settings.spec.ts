import { test, expect } from "@playwright/test";

test.describe("Settings page — collapsible sections (#660)", () => {
  test("settings page opens with all category headings visible and collapsed", async ({
    page,
  }) => {
    await page.goto("/settings");

    // All four top-level category buttons must be visible.
    for (const label of ["Appearance", "Practice", "Audio", "Account & Data", "Advanced"]) {
      await expect(
        page.getByRole("button", { name: new RegExp(label, "i") }),
      ).toBeVisible();
    }

    // No section content should be visible on a fresh load (all collapsed).
    // We check that the "Recall target" slider is not visible — it lives inside Practice.
    await expect(page.getByRole("slider", { name: /recall target/i })).not.toBeVisible();
  });

  test("expanding a section reveals its controls", async ({ page }) => {
    await page.goto("/settings");

    // Expand "Practice".
    await page.getByRole("button", { name: /^practice$/i }).click();

    // The recall target slider should now be visible.
    await expect(page.getByRole("slider", { name: /recall target/i })).toBeVisible();
  });

  test("collapsing a section hides its controls again", async ({ page }) => {
    await page.goto("/settings");

    const practiceBtn = page.getByRole("button", { name: /^practice$/i });

    // Expand then collapse.
    await practiceBtn.click();
    await expect(page.getByRole("slider", { name: /recall target/i })).toBeVisible();

    await practiceBtn.click();
    await expect(page.getByRole("slider", { name: /recall target/i })).not.toBeVisible();
  });

  test("/settings#onboarding-heading auto-expands Account & Data section", async ({
    page,
  }) => {
    await page.goto("/settings#onboarding-heading");

    // The "Show tips again" button lives inside Account & Data → onboarding sub-section.
    await expect(
      page.getByRole("button", { name: /show tips again/i }),
    ).toBeVisible();
  });

  test("expanding Audio section reveals cry card toggle", async ({ page }) => {
    await page.goto("/settings");

    await page.getByRole("button", { name: /^audio$/i }).click();

    // The cry cards toggle switch must be visible.
    await expect(
      page.getByRole("switch", { name: /enable cry cards/i }),
    ).toBeVisible();
  });
});

test.describe("Settings page — alternate forms toggle (#658)", () => {
  test("alternate forms toggle is present and off by default in Practice section", async ({
    page,
  }) => {
    await page.goto("/settings");

    // Expand "Practice".
    await page.getByRole("button", { name: /^practice$/i }).click();

    // The toggle must be visible.
    const toggle = page.getByRole("switch", {
      name: /include alternate forms in practice/i,
    });
    await expect(toggle).toBeVisible();

    // Default state is off (aria-checked="false").
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("toggling alternate forms on causes it to report as checked", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: /^practice$/i }).click();

    const toggle = page.getByRole("switch", {
      name: /include alternate forms in practice/i,
    });

    // Click to enable.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});
