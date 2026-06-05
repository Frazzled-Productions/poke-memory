import type { Page, TestInfo } from "@playwright/test";

/**
 * True when the current Playwright project renders at a mobile viewport and so
 * shows the bottom tab bar instead of the desktop header nav.
 *
 * Keyed on the `mobile-` project-name prefix: both `mobile-safari` (iPhone 14)
 * and `mobile-chrome` (Pixel 7) are mobile. The desktop projects (`chromium`,
 * `desktop-webkit`) are not. Any future mobile project must keep the prefix.
 */
export function isMobileProject(testInfo: TestInfo): boolean {
  return testInfo.project.name.startsWith("mobile-");
}

/**
 * Returns the navigation container that holds primary destination links for
 * the current project.
 *
 * - Desktop (chromium, desktop-webkit): the header
 *   `<nav aria-label="Main navigation">` row.
 * - Mobile (mobile-safari, mobile-chrome - bottom tab bar default): the fixed
 *   `<nav aria-label="Mobile tab navigation">` bottom bar.
 *
 * Use this helper whenever a spec needs to click a nav link and must work
 * across both desktop and mobile projects.
 */
export function getPrimaryNavContainer(page: Page, testInfo: TestInfo) {
  if (isMobileProject(testInfo)) {
    return page.getByRole("navigation", { name: "Mobile tab navigation" });
  }
  return page.getByRole("navigation", { name: "Main navigation" });
}
