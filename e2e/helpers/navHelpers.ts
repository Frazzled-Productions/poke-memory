import type { Page, TestInfo } from "@playwright/test";

/**
 * Returns the navigation container that holds primary destination links for
 * the current project.
 *
 * - Desktop (chromium): the header `<nav aria-label="Main navigation">` row.
 * - Mobile (mobile-safari, bottom tab bar default): the fixed
 *   `<nav aria-label="Mobile tab navigation">` bottom bar.
 *
 * Use this helper whenever a spec needs to click a nav link and must work
 * across both desktop and mobile projects.
 */
export function getPrimaryNavContainer(page: Page, testInfo: TestInfo) {
  if (testInfo.project.name === "mobile-safari") {
    return page.getByRole("navigation", { name: "Mobile tab navigation" });
  }
  return page.getByRole("navigation", { name: "Main navigation" });
}
