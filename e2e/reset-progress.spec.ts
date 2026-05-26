import { test, expect, type Page } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

// ---------------------------------------------------------------------------
// Reset-progress dialog smoke tests (#766)
//
// The dialog lives inside the Advanced > Danger zone section on /settings.
// Tests run in guest mode (no cloud identity) so handleReset calls
// clearLocalProgress() then navigates to "/".
// ---------------------------------------------------------------------------

/**
 * Opens /settings, deep-links to the Advanced section via its hash anchor, and
 * waits for the "Reset all progress" button to be visible.
 */
async function openDangerZone(page: Page) {
  // The hash target "#danger-zone-heading" triggers auto-expansion of the
  // Advanced collapsible section (same behaviour asserted in smoke.spec.ts).
  await page.goto("/settings#danger-zone-heading");
  await expect(
    page.getByRole("button", { name: /^reset all progress$/i }),
  ).toBeVisible();
}

test.describe("Reset-progress dialog (#766)", () => {
  test("clicking 'Reset all progress' opens the confirmation dialog", async ({
    page,
  }) => {
    await openDangerZone(page);

    await page.getByRole("button", { name: /^reset all progress$/i }).click();

    // The dialog element renders with aria-labelledby pointing to the heading.
    const dialog = page.getByRole("dialog", { name: /reset all progress/i });
    await expect(dialog).toBeVisible();

    // The dialog must explain the consequence and ask for a typed confirmation.
    // Scoped within the dialog to avoid the delete-account dialog's similarly
    // worded description (#delete-account-dialog-desc) which is also in the DOM.
    await expect(
      dialog.getByText(/permanently erase all your review history/i),
    ).toBeVisible();

    // The confirmation input must be present.
    await expect(
      page.getByPlaceholder(/type reset to confirm/i),
    ).toBeVisible();
  });

  test("Cancel button closes the dialog without resetting", async ({
    page,
  }) => {
    await openDangerZone(page);
    await page.getByRole("button", { name: /^reset all progress$/i }).click();

    const dialog = page.getByRole("dialog", { name: /reset all progress/i });
    await expect(dialog).toBeVisible();

    await page.getByRole("button", { name: /^cancel$/i }).click();

    // The dialog must no longer be visible.
    await expect(dialog).toBeHidden();

    // The page must still be /settings — no navigation happened.
    await expect(page).toHaveURL(/\/settings/);
  });

  test("Reset button is disabled until 'RESET' is typed exactly", async ({
    page,
  }) => {
    await openDangerZone(page);
    await page.getByRole("button", { name: /^reset all progress$/i }).click();

    const confirmInput = page.getByPlaceholder(/type reset to confirm/i);
    const resetBtn = page.getByRole("button", { name: /^reset$/i });

    // Initially the Reset button must be disabled.
    await expect(resetBtn).toBeDisabled();

    // Partial input must keep it disabled.
    await confirmInput.fill("RES");
    await expect(resetBtn).toBeDisabled();

    // Lowercase must also keep it disabled.
    await confirmInput.fill("reset");
    await expect(resetBtn).toBeDisabled();

    // Exact uppercase "RESET" must enable it.
    await confirmInput.fill("RESET");
    await expect(resetBtn).toBeEnabled();
  });

  test("confirming the reset navigates back to the practice page", async ({
    page,
  }) => {
    await openDangerZone(page);
    await page.getByRole("button", { name: /^reset all progress$/i }).click();

    const confirmInput = page.getByPlaceholder(/type reset to confirm/i);
    await confirmInput.fill("RESET");

    await page.getByRole("button", { name: /^reset$/i }).click();

    // handleReset calls router.replace("/") after clearLocalProgress().
    // Wait up to 10 s to allow any async IndexedDB clear to complete.
    await expect(page).toHaveURL("/", { timeout: 10_000 });

    // The practice page must render correctly after reset.
    const reveal = page.getByRole("button", { name: "Reveal" });
    const endState = page.getByRole("heading", {
      name: /All caught up|Daily review limit reached|New cards locked|Next card in|No card types enabled/,
    });
    // 15 s: after #1234 the card set is ~2× larger (name + reverse for all
    // species), so hydration takes longer on WebKit.
    await expect(reveal.or(endState)).toBeVisible({ timeout: 15_000 });
  });
});
