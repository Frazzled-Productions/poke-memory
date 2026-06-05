/**
 * Wide-viewport layout smoke tests (#1061).
 *
 * These tests verify that the large-breakpoint layouts are present and
 * render correctly on desktop. They run only on chromium (desktop viewport)
 * - the mobile-safari project uses an iPhone 14 viewport where the lg:
 * layouts are not active, so the sidebar and multi-column grid are absent
 * by design.
 */
import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";
import { practiceReadyLocator } from "./helpers/practiceCard";

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

test.describe("Practice page - session-progress sidebar (lg: layout)", () => {
  // Only meaningful at desktop width (lg: ≥ 1024px). The chromium project
  // uses Desktop Chrome (1280px), so this runs as expected.
  test("session progress sidebar is visible on desktop", async ({ page }, testInfo) => {
    // This layout is desktop-only; skip on the mobile project.
    test.skip(
      testInfo.project.name !== "chromium",
      "sidebar is desktop-only (lg: breakpoint); mobile-safari uses a narrow viewport",
    );

    await page.goto("/");

    // The sidebar landmark must be present.
    const sidebar = page.getByRole("complementary", { name: "Session progress" });
    await expect(sidebar).toBeVisible({ timeout: 10_000 });

    // It contains a "Today" heading.
    await expect(sidebar.getByRole("heading", { name: "Today" })).toBeVisible();

    // It contains a "View full stats" link pointing to /stats.
    const statsLink = sidebar.getByRole("link", { name: /View full stats/ });
    await expect(statsLink).toBeVisible();
    await expect(statsLink).toHaveAttribute("href", "/stats");
  });

  test("session progress sidebar is hidden on mobile", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "mobile-visibility check only applies on the narrow mobile-safari project",
    );

    await page.goto("/");

    // Wait for the page to hydrate. The first card may be a flip card, a
    // sprite-picker, or a multiple-choice card depending on the deterministic
    // per-day shuffle; `practiceReadyLocator` matches every variant so a
    // calendar roll cannot reintroduce the #1370 date-dependent flake.
    // 30 s: this is the narrowest path (mobile-safari only - see the
    // test.skip above), which combines the post-#1234 doubled card-set
    // hydration cost AND the #1260 next-intl Suspense boundary AND the
    // narrow-viewport-specific layout work. Other mobile-safari practice
    // tests pass at 20 s; this one consistently needs more.
    await expect(practiceReadyLocator(page)).toBeVisible({ timeout: 30_000 });

    // On mobile, the sidebar element exists in the DOM but is hidden via CSS.
    // Playwright's toBeVisible() checks CSS visibility (display:none / opacity 0).
    const sidebar = page.getByRole("complementary", { name: "Session progress" });
    await expect(sidebar).not.toBeVisible();
  });
});

test.describe("Stats page - two-column layout (lg: layout)", () => {
  test("Accuracy and Activity sections both render", async ({ page }) => {
    await page.goto("/stats");

    // Both section headings must be visible regardless of viewport.
    await expect(
      page.getByRole("heading", { level: 2, name: /^Accuracy$/ }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { level: 2, name: /^Activity$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: /^Scheduling$/ }),
    ).toBeVisible();
  });
});

test.describe("Pokédex grid - xl: column layout", () => {
  test("Pokédex grid renders with generation section headings", async ({ page }) => {
    await page.goto("/pokedex");

    // Wait for the page to finish loading.
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible({ timeout: 10_000 });

    // At least one generation section should be present. Use `.first()` because
    // the regex /Generation I/ also matches Generation II, III, IV and IX - 
    // strict mode would otherwise fail on multiple resolved elements.
    await expect(
      page.getByRole("heading", { level: 2, name: /Generation I/ }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
