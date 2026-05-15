import { test, expect } from "@playwright/test";

/**
 * Mobile nav hamburger E2E tests.
 *
 * mobile-safari project: verifies the hamburger is visible, opens/closes,
 * links navigate, and menu closes after navigation.
 *
 * chromium project: verifies the desktop horizontal row is shown (no hamburger).
 */

test.describe("Mobile nav — hamburger drawer", () => {
  test("hamburger button is visible on mobile and opens the drawer", async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "hamburger-visible check is mobile-only",
    );

    await page.goto("/");

    // Locate the hamburger by its stable aria-controls attribute so the
    // assertion below survives the label changing from "Open…" to "Close…".
    const hamburger = page.locator('[aria-controls="mobile-nav-drawer"]');
    await expect(hamburger).toBeVisible();

    // Drawer starts closed
    const drawer = page.getByRole("dialog", { name: "Navigation menu" });
    await expect(drawer).toBeHidden();

    // Open the drawer
    await hamburger.click();

    await expect(drawer).toBeVisible();
    // After opening the label changes to "Close navigation menu"; locate by
    // aria-controls (stable) so the aria-expanded assertion always resolves.
    await expect(hamburger).toHaveAttribute("aria-expanded", "true");

    // All primary links are present inside the drawer
    for (const label of ["Practice", "Stats", "Pokédex", "Settings"]) {
      await expect(drawer.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("navigating via the drawer closes the menu and loads the page", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "hamburger-nav check is mobile-only",
    );

    await page.goto("/");

    const hamburger = page.getByRole("button", { name: "Open navigation menu" });
    await hamburger.click();

    const drawer = page.getByRole("dialog", { name: "Navigation menu" });
    await expect(drawer).toBeVisible();

    // Click the Stats link inside the drawer
    await drawer.getByRole("link", { name: "Stats" }).click();

    // Navigated to /stats
    await expect(page).toHaveURL("/stats");

    // Drawer should be closed after navigation
    await expect(drawer).toBeHidden();
  });

  test("Esc key closes the drawer", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "Esc-close check is mobile-only",
    );

    await page.goto("/");

    const hamburger = page.getByRole("button", { name: "Open navigation menu" });
    await hamburger.click();

    const drawer = page.getByRole("dialog", { name: "Navigation menu" });
    await expect(drawer).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(drawer).toBeHidden();
  });

  test("close button inside the drawer closes it", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "drawer-close-btn check is mobile-only",
    );

    await page.goto("/");

    const hamburger = page.getByRole("button", { name: "Open navigation menu" });
    await hamburger.click();

    const drawer = page.getByRole("dialog", { name: "Navigation menu" });
    await expect(drawer).toBeVisible();

    await drawer.getByRole("button", { name: "Close navigation menu" }).click();

    await expect(drawer).toBeHidden();
  });
});

test.describe("Desktop nav — no hamburger", () => {
  test("desktop shows the horizontal link row and no hamburger", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "desktop layout check is chromium-only",
    );

    await page.goto("/");

    // Hamburger button should not be visible on desktop
    const hamburger = page.getByRole("button", { name: "Open navigation menu" });
    await expect(hamburger).toBeHidden();

    // Desktop nav links are directly in the header (not inside a drawer)
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    for (const label of ["Practice", "Stats", "Pokédex", "Settings"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("desktop nav links still navigate correctly", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "desktop navigation check is chromium-only",
    );

    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Main navigation" });

    for (const { label, path } of [
      { label: "Stats", path: "/stats" },
      { label: "Pokédex", path: "/pokedex" },
      { label: "Settings", path: "/settings" },
    ]) {
      await nav.getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(path);
      await expect(
        page.getByRole("heading", { level: 1, name: label }),
      ).toBeVisible();
    }
  });
});
