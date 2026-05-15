import { test, expect } from "@playwright/test";

test.describe("What's new page", () => {
  test("loads and lists at least one release", async ({ page }) => {
    await page.goto("/whats-new");
    await expect(
      page.getByRole("heading", { level: 1, name: "What's new" }),
    ).toBeVisible();

    // At least one version heading should appear (versions look like v0.9.55).
    await expect(
      page.getByRole("heading", { level: 2 }).filter({ hasText: /^v\d+\.\d+\.\d+$/ }).first(),
    ).toBeVisible();
  });

  test("visiting the page clears the nav indicator on next visit", async ({
    page,
  }, testInfo) => {
    // Simulate a first-time user with a stale last-seen marker so the
    // indicator is guaranteed to render. We use evaluate() after the first
    // goto() rather than addInitScript() — addInitScript registers a callback
    // that fires on every navigation, so it would re-seed 0.0.1 on the final
    // goto("/") and undo MarkVisited's write, causing a false failure.
    await page.goto("/");
    await page.evaluate(() => {
      window.localStorage.setItem("poke-memory:last-seen-version:v1", "0.0.1");
    });
    await page.reload();

    // On mobile the What's new indicator is inside the hamburger drawer.
    const isMobile = testInfo.project.name === "mobile-safari";
    const hamburger = page.locator('[aria-controls="mobile-nav-drawer"]');

    if (isMobile) {
      await hamburger.click();
      const drawer = page.getByRole("dialog", { name: "Navigation menu" });
      await expect(drawer).toBeVisible();
      const indicator = drawer.getByRole("link", { name: "What's new" });
      await expect(indicator).toBeVisible();
      await indicator.click();
    } else {
      const nav = page.getByRole("navigation", { name: "Main navigation" });
      const indicator = nav.getByRole("link", { name: "What's new" });
      await expect(indicator).toBeVisible();
      await indicator.click();
    }

    await expect(page).toHaveURL("/whats-new");

    await page.goto("/");
    // The page write should have updated last-seen to current; the nav
    // indicator should no longer render. (The footer link is always present
    // and not scoped here.)
    if (isMobile) {
      // Open the drawer to inspect it.
      await hamburger.click();
      const drawer = page.getByRole("dialog", { name: "Navigation menu" });
      await expect(drawer).toBeVisible();
      await expect(
        drawer.getByRole("link", { name: "What's new" }),
      ).not.toBeVisible();
    } else {
      await expect(
        page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", {
          name: "What's new",
        }),
      ).not.toBeVisible();
    }
  });
});
