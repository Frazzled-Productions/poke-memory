import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

test.describe("Privacy notice page", () => {
  test("loads and shows the main heading", async ({ page }) => {
    await page.goto("/privacy");
    await expect(
      page.getByRole("heading", { level: 1, name: "Privacy Notice" }),
    ).toBeVisible();
  });

  // The page footer is hidden when mobileNav === "bottom" (the default for new
  // users). Privacy is now also reachable via Settings → About, which is the
  // canonical path for bottom-nav users. This test exercises that path.
  test("Settings → About link navigates to /privacy", async ({ page }) => {
    await page.goto("/settings#about-heading");
    // The "Account & Data" section force-expands via the hash deep-link; wait
    // for the accordion button to confirm it is open before asserting the link.
    await expect(
      page.getByRole("button", { name: "Account & Data" }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();
    await page.getByRole("link", { name: "Privacy" }).click();
    await expect(page).toHaveURL("/privacy");
    await expect(
      page.getByRole("heading", { level: 1, name: "Privacy Notice" }),
    ).toBeVisible();
  });

  test("shows the plain-language summary card", async ({ page }) => {
    await page.goto("/privacy");
    await expect(
      page.getByRole("heading", {
        name: "In plain language: what does Poké Memory do with your data?",
      }),
    ).toBeVisible();
  });

  test("summary card links to Settings controls", async ({ page }) => {
    await page.goto("/privacy");
    const exportLink = page.getByRole("link", { name: /export your progress/i });
    const resetLink = page.getByRole("link", { name: /reset all progress/i });
    await expect(exportLink).toBeVisible();
    await expect(resetLink).toBeVisible();
    await expect(exportLink).toHaveAttribute(
      "href",
      "/settings#backup-heading",
    );
    await expect(resetLink).toHaveAttribute(
      "href",
      "/settings#danger-zone-heading",
    );
  });
});
