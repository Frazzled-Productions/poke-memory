import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

const SETTINGS_HEADING_HASH = "/settings#known-quiz-heading";

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

test.describe("Mark Pokémon I already know — deferred scroll (#1483 / #1486)", () => {
  // The quiz panel is collapsed by default and sits below many other settings
  // rows. openKnownQuiz() calls scrollIntoView({ block: "start" }) after a
  // 200ms timer to bring the heading + intro to the top of the viewport.
  // This test asserts the heading lands near the TOP, not in the middle of
  // the list (the block:"center" regression from #1486).
  test("opening the quiz from a collapsed state scrolls the heading to near the top of the viewport", async ({
    page,
  }) => {
    // Start at the settings page root — the Practice section is collapsed so
    // the quiz heading is well below the viewport.
    await page.goto("/settings");

    // Expand the Practice section so the quiz row becomes visible.
    await page.getByRole("button", { name: /^practice$/i }).click();

    // Wait for the quiz row to appear (scroll hasn't fired yet).
    const openBtn = page.getByRole("button", { name: /open quiz/i });
    await expect(openBtn).toBeVisible();

    // Click "Open quiz". This triggers openKnownQuiz() which sets a 200ms
    // deferred scrollIntoView({ block: "start" }) on #known-quiz-heading.
    await openBtn.click();

    // Wait for the deferred scroll timer (200ms) plus a small buffer for
    // smooth-scroll animation to settle (browsers may jump immediately
    // when scroll distance is large or prefers-reduced-motion is set).
    await page.waitForTimeout(600);

    // Assert the quiz heading is near the top of the viewport. With
    // block:"start" its bounding-box top should be close to 0. A lenient
    // upper bound of 200px tolerates browser chrome (address bar on mobile)
    // and any padding the page adds above sections.
    const headingEl = page.locator("#known-quiz-heading");
    await expect(headingEl).toBeVisible();
    const box = await headingEl.boundingBox();
    expect(box).not.toBeNull();
    // Top should be positive (on-screen) and not more than 200px from the top
    // — this rules out the block:"center" regression where the heading was
    // centred and the user landed mid-list.
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThan(200);
  });
});

test.describe("Mark Pokémon I already know quiz (#1084)", () => {
  test("entry point renders in Practice section and opens the quiz", async ({
    page,
  }) => {
    // Deep-link to the known-quiz sub-section so the Practice category is
    // auto-expanded and we don't depend on the heading button order.
    await page.goto(SETTINGS_HEADING_HASH);

    // The sub-section heading is rendered as plain text — assert by visible
    // copy rather than role so we don't depend on heading-level styling.
    await expect(page.getByText(/mark pokémon i already know/i)).toBeVisible();

    // The "Open quiz" button must be visible and toggle the panel.
    const openBtn = page.getByRole("button", { name: /open quiz/i });
    await expect(openBtn).toBeVisible();
    await openBtn.click();

    // Once open, the generation switcher should render. Gen I is the default
    // — its tab carries a count of available species in the user's deck.
    await expect(
      page.getByRole("tab", { name: /Generation I \(\d+\)/i }),
    ).toBeVisible();

    // The Apply button is disabled with zero selections.
    await expect(
      page.getByRole("button", { name: /Apply \(0 selected\)/ }),
    ).toBeDisabled();
  });

  test("selecting a sprite enables Apply and applying removes it from the grid", async ({
    page,
  }) => {
    await page.goto(SETTINGS_HEADING_HASH);
    await page.getByRole("button", { name: /open quiz/i }).click();

    // The first eligible Gen I sprite is Bulbasaur on a fresh session.
    const bulbasaur = page.getByRole("checkbox", {
      name: /i already know bulbasaur/i,
    });
    await expect(bulbasaur).toBeVisible();
    await expect(bulbasaur).toHaveAttribute("aria-checked", "false");

    await bulbasaur.click();
    await expect(bulbasaur).toHaveAttribute("aria-checked", "true");

    // Apply with one selected.
    const apply = page.getByRole("button", { name: /Apply \(1 selected\)/ });
    await expect(apply).toBeEnabled();
    await apply.click();

    // After apply the graded card disappears from the eligibility list
    // (it now has lastReview set and the next-card queue will skip it).
    await expect(
      page.getByRole("checkbox", { name: /i already know bulbasaur/i }),
    ).toHaveCount(0);

    // Status banner confirms. Filter by text because the settings page also
    // has a sr-only role="status" live region for the search input — strict
    // mode would error if we matched both.
    await expect(
      page.getByRole("status").filter({ hasText: /marked 1 pokémon as known/i }),
    ).toBeVisible();
  });

  test("bulk action shows a confirm dialog before marking a generation", async ({
    page,
  }) => {
    await page.goto(SETTINGS_HEADING_HASH);
    await page.getByRole("button", { name: /open quiz/i }).click();

    // Wait for the sprite grid to render first.
    await expect(
      page.getByRole("checkbox", { name: /i already know/i }).first(),
    ).toBeVisible();

    const bulkBtn = page.getByRole("button", { name: /mark all in this generation/i });
    await bulkBtn.click();

    // Confirm dialog appears with both buttons.
    await expect(
      page.getByRole("heading", { name: /mark every pokémon in generation/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^cancel$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^mark all \d+$/i })).toBeVisible();

    // Cancelling closes the dialog without selecting anything.
    await page.getByRole("button", { name: /^cancel$/i }).click();
    await expect(
      page.getByRole("heading", { name: /mark every pokémon in generation/i }),
    ).not.toBeVisible();

    // Selection count remains zero — Apply is still disabled.
    await expect(
      page.getByRole("button", { name: /Apply \(0 selected\)/ }),
    ).toBeDisabled();
  });
});
