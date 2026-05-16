import { test, expect } from "@playwright/test";

/**
 * Mobile nav E2E tests (#661).
 *
 * Two modes:
 * - Default (new user, no persisted settings) → bottom tab bar.
 * - Hamburger (user toggles the setting on the Settings page) → hamburger drawer.
 *
 * Desktop is unaffected by the setting — the inline header nav row is always
 * shown and no bottom tab bar leaks in.
 */

// ─── Bottom tab bar (default mode) ───────────────────────────────────────────

test.describe("Mobile nav — bottom tab bar (default)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "bottom-tab-bar checks are mobile-only",
    );
    // Clear localStorage so we get the new-user default (bottom tab bar).
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test("bottom tab bar is visible on mobile", async ({ page }) => {
    await page.goto("/");

    const tabBar = page.getByRole("navigation", {
      name: "Mobile tab navigation",
    });
    await expect(tabBar).toBeVisible();
  });

  test("bottom tab bar contains all primary destinations", async ({ page }) => {
    await page.goto("/");

    const tabBar = page.getByRole("navigation", {
      name: "Mobile tab navigation",
    });

    for (const label of ["Practice", "Stats", "Pokédex", "Settings"]) {
      await expect(tabBar.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("tab bar is fixed — does not scroll with the page", async ({ page }) => {
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

  test("active tab has aria-current='page'", async ({ page }) => {
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

  test("tapping a tab navigates to the destination and marks it active", async ({ page }) => {
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

  test("no hamburger button on mobile when bottom tab bar is active", async ({ page }) => {
    await page.goto("/");

    // The hamburger should not be present in bottom-tab-bar mode
    await expect(
      page.getByRole("button", { name: /open navigation menu/i }),
    ).toHaveCount(0);
  });

  test("header shows only brand and auth on mobile — no link row", async ({ page }) => {
    await page.goto("/");

    const header = page.getByRole("navigation", { name: "Main navigation" });

    // The inline nav links should not be visible inside the header on mobile
    // (they live in a `hidden md:flex` container)
    const statsLinkInHeader = header.getByRole("link", { name: "Stats" });
    await expect(statsLinkInHeader).toBeHidden();
  });
});

// ─── Hamburger mode ───────────────────────────────────────────────────────────

test.describe("Mobile nav — hamburger mode (via Settings toggle)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "hamburger-mode checks are mobile-only",
    );
    // Seed localStorage with mobileNav: 'hamburger' to simulate an existing
    // user or a user who has switched the toggle.
    await page.goto("/");
    await page.evaluate(() => {
      const key = "poke-memory:settings:v1";
      const existing = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(key, JSON.stringify({ ...existing, mobileNav: "hamburger" }));
    });
    await page.reload();
  });

  test("hamburger button is visible on mobile in hamburger mode", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("button", { name: /open navigation menu/i }),
    ).toBeVisible();
  });

  test("bottom tab bar is absent in hamburger mode", async ({ page }) => {
    await page.goto("/");

    const tabBar = page.getByRole("navigation", {
      name: "Mobile tab navigation",
    });
    await expect(tabBar).toHaveCount(0);
  });

  test("hamburger opens the nav drawer with all destinations", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /open navigation menu/i }).click();

    const drawer = page.getByRole("dialog", { name: "Navigation menu" });
    await expect(drawer).toBeVisible();

    for (const label of ["Practice", "Stats", "Pokédex", "Settings"]) {
      await expect(drawer.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("Esc closes the drawer in hamburger mode", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /open navigation menu/i }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation menu" });
    await expect(drawer).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });
});

// ─── Footer visibility & legal-page access (#734 / #735) ─────────────────────

test.describe("Mobile nav — footer hidden and legal pages via Settings → About", () => {
  test("footer is not rendered in bottom-nav mode (default)", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "footer-visibility check is mobile-only (desktop always shows footer)",
    );

    // Clear any persisted settings so we get the new-user default (bottom tab bar).
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.goto("/");
    // The <footer> element has role="contentinfo". In bottom-nav mode, the
    // Footer component returns null, so the element must not be in the DOM.
    await expect(page.getByRole("contentinfo")).toHaveCount(0);
  });

  test("Privacy page is reachable via Settings → About in bottom-nav mode", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "bottom-nav path check is mobile-only",
    );

    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    // Navigate to Settings → About via the tab bar.
    const tabBar = page.getByRole("navigation", { name: "Mobile tab navigation" });
    await tabBar.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL("/settings");

    // The About section is inside "Account & Data". Deep-link directly to it.
    await page.goto("/settings#about-heading");
    await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();
    await page.getByRole("link", { name: "Privacy" }).click();
    await expect(page).toHaveURL("/privacy");
    await expect(
      page.getByRole("heading", { level: 1, name: "Privacy Notice" }),
    ).toBeVisible();
  });

  test("Terms page is reachable via Settings → About in bottom-nav mode", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "bottom-nav path check is mobile-only",
    );

    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    // Deep-link to Settings → About and click Terms.
    await page.goto("/settings#about-heading");
    await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
    await page.getByRole("link", { name: "Terms" }).click();
    await expect(page).toHaveURL("/terms");
    await expect(
      page.getByRole("heading", { level: 1, name: "Terms of Use" }),
    ).toBeVisible();
  });

  test("Settings → About section shows Privacy and Terms links on desktop too", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "desktop About-section check is chromium-only",
    );

    await page.goto("/settings#about-heading");
    // The "Account & Data" section opens via the hash deep-link.
    await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
  });
});

// ─── Desktop — unaffected by mobileNav setting ────────────────────────────────

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

    // Bottom tab bar must not be visible on desktop regardless of mobileNav setting
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
