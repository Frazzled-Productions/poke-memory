import { test, expect } from "@playwright/test";
import { preDismissOnboardingModal } from "./helpers/dismissOnboarding";

const SETTINGS_HEADING_HASH = "/settings#known-quiz-heading";

test.beforeEach(async ({ page }) => {
  await preDismissOnboardingModal(page);
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
