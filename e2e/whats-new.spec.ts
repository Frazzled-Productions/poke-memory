import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

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
  }) => {
    // Simulate a first-time user with a stale last-seen marker so the
    // indicator is guaranteed to render. We use evaluate() after the first
    // goto() rather than addInitScript() - addInitScript registers a callback
    // that fires on every navigation, so it would re-seed 0.0.1 on the final
    // goto("/") and undo MarkVisited's write, causing a false failure.
    await page.goto("/");
    await page.evaluate(() => {
      window.localStorage.setItem("poke-memory:last-seen-version:v1", "0.0.1");
    });
    await page.reload();

    // In bottom tab bar mode (the default for fresh users), the What's new
    // indicator is rendered directly in the header inside the main nav landmark.
    // In hamburger mode it lives inside the NavDrawer - also inside the main nav
    // container, so scoping to "Main navigation" works for both modes.
    const mainNav = page.getByRole("navigation", { name: "Main navigation" });
    const indicator = mainNav.getByRole("link", { name: "What's new" });
    await expect(indicator).toBeVisible();
    // Assert the href before clicking to ensure the link is fully rendered
    // (visibility and href resolve at the same DOM-mutation event for this
    // component). The primary flake defence is the extended waitForURL timeout
    // below, which tolerates App Router client-navigation latency (#1784).
    await expect(indicator).toHaveAttribute("href", /\/whats-new$/);
    await indicator.click();

    await page.waitForURL(/\/whats-new$/, { timeout: 15000 });
    await expect(page).toHaveURL(/\/whats-new$/);

    await page.goto("/");
    // The page write should have updated last-seen to current; the nav
    // indicator should no longer render. (The footer link is always present
    // but is not scoped to the main nav, so this assertion is unambiguous.)
    await expect(
      mainNav.getByRole("link", { name: "What's new" }),
    ).not.toBeVisible();
  });
});
