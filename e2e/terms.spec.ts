import { test, expect } from "@playwright/test";

test.describe("Terms of Use page", () => {
  test("loads and shows the main heading", async ({ page }) => {
    await page.goto("/terms");
    await expect(
      page.getByRole("heading", { level: 1, name: "Terms of Use" }),
    ).toBeVisible();
  });

  // The page footer is hidden when mobileNav === "bottom" (the default for new
  // users). Terms is now also reachable via Settings → About, which is the
  // canonical path for bottom-nav users. This test exercises that path.
  test("Settings → About link navigates to /terms", async ({ page }) => {
    await page.goto("/settings#about-heading");
    // The "Account & Data" section force-expands via the hash deep-link.
    await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
    await page.getByRole("link", { name: "Terms" }).click();
    await expect(page).toHaveURL("/terms");
    await expect(
      page.getByRole("heading", { level: 1, name: "Terms of Use" }),
    ).toBeVisible();
  });

  test("terms page links back to privacy notice", async ({ page }) => {
    await page.goto("/terms");
    await expect(
      page.getByRole("link", { name: "Privacy Notice" }),
    ).toBeVisible();
  });

  test("privacy page links to terms of use", async ({ page }) => {
    await page.goto("/privacy");
    await expect(
      page.getByRole("link", { name: "Terms of Use" }),
    ).toBeVisible();
  });
});
