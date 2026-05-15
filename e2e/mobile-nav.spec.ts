import { test, expect } from "@playwright/test";

/**
 * Mobile nav — bottom tab bar E2E tests (supersedes the hamburger-drawer
 * tests from #659).
 *
 * mobile-safari project: verifies the bottom tab bar is visible and fixed,
 * tabs navigate, the active tab is highlighted with aria-current="page",
 * and the header carries no hamburger button.
 *
 * chromium project: verifies the desktop horizontal nav row is still shown
 * and no bottom tab bar leaks into the desktop layout.
 */

test.describe("Mobile nav — bottom tab bar", () => {
  test("bottom tab bar is visible on mobile", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "bottom-tab-bar check is mobile-only",
    );

    await page.goto("/");

    const tabBar = page.getByRole("navigation", {
      name: "Mobile tab navigation",
    });
    await expect(tabBar).toBeVisible();
  });

  test("bottom tab bar contains all primary destinations", async (
    { page },
    testInfo,
  ) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "bottom-tab-bar check is mobile-only",
    );

    await page.goto("/");

    const tabBar = page.getByRole("navigation", {
      name: "Mobile tab navigation",
    });

    for (const label of ["Practice", "Stats", "Pokédex", "Settings"]) {
      await expect(tabBar.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("tab bar is fixed — does not scroll with the page", async (
    { page },
    testInfo,
  ) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "bottom-tab-bar position check is mobile-only",
    );

    await page.goto("/pokedex");

    const tabBar = page.getByRole("navigation", {
      name: "Mobile tab navigation",
    });
    await expect(tabBar).toBeVisible();

    // Record position before scrolling
    const boxBefore = await tabBar.boundingBox();
    expect(boxBefore).not.toBeNull();

    // Scroll the page down
    await page.evaluate(() => window.scrollBy(0, 300));

    // Position should be unchanged (fixed positioning)
    const boxAfter = await tabBar.boundingBox();
    expect(boxAfter).not.toBeNull();

    if (boxBefore && boxAfter) {
      expect(Math.abs(boxAfter.y - boxBefore.y)).toBeLessThanOrEqual(2);
    }
  });

  test("active tab has aria-current='page'", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "active-tab check is mobile-only",
    );

    await page.goto("/stats");

    const tabBar = page.getByRole("navigation", {
      name: "Mobile tab navigation",
    });

    // Stats tab should be marked as active
    await expect(tabBar.getByRole("link", { name: "Stats" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // Other tabs should not be active
    await expect(
      tabBar.getByRole("link", { name: "Practice" }),
    ).not.toHaveAttribute("aria-current", "page");
    await expect(
      tabBar.getByRole("link", { name: "Settings" }),
    ).not.toHaveAttribute("aria-current", "page");
  });

  test("tapping a tab navigates to the destination and marks it active", async (
    { page },
    testInfo,
  ) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "tab-navigation check is mobile-only",
    );

    await page.goto("/");

    const tabBar = page.getByRole("navigation", {
      name: "Mobile tab navigation",
    });

    // Tap the Settings tab
    await tabBar.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL("/settings");

    // Settings tab should now be active
    await expect(
      tabBar.getByRole("link", { name: "Settings" }),
    ).toHaveAttribute("aria-current", "page");

    // Tap the Pokédex tab
    await tabBar.getByRole("link", { name: "Pokédex" }).click();
    await expect(page).toHaveURL("/pokedex");

    await expect(
      tabBar.getByRole("link", { name: "Pokédex" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("no hamburger button on mobile", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "hamburger-absent check is mobile-only",
    );

    await page.goto("/");

    // The hamburger should not be present now that the bottom tab bar replaces it
    await expect(
      page.getByRole("button", { name: /open navigation menu/i }),
    ).toHaveCount(0);
  });

  test("header shows only brand and auth on mobile — no link row", async (
    { page },
    testInfo,
  ) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "header-minimal check is mobile-only",
    );

    await page.goto("/");

    const header = page.getByRole("navigation", { name: "Main navigation" });

    // The inline nav links should not be visible inside the header on mobile
    // (they live in a `hidden md:flex` container)
    const statsLinkInHeader = header.getByRole("link", { name: "Stats" });
    await expect(statsLinkInHeader).toBeHidden();
  });
});

test.describe("Desktop nav — inline header row, no tab bar", () => {
  test("desktop shows the horizontal link row and no bottom tab bar", async (
    { page },
    testInfo,
  ) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "desktop layout check is chromium-only",
    );

    await page.goto("/");

    // Desktop nav links are directly in the header
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    for (const label of ["Practice", "Stats", "Pokédex", "Settings"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }

    // Bottom tab bar must not be visible on desktop
    const tabBar = page.getByRole("navigation", {
      name: "Mobile tab navigation",
    });
    await expect(tabBar).toBeHidden();
  });

  test("desktop nav links navigate correctly", async ({ page }, testInfo) => {
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
