/**
 * E2E smoke tests for SignInSheet (#1669, #1671).
 *
 * Verifies the sheet opens from the nav Sign-in trigger and that:
 * - The social provider buttons are reachable and actionable.
 * - The username/password door renders (form + both warning notices).
 * - The mode toggle switches between sign-up and sign-in.
 * - Basic client-side validation fires for the username form.
 *
 * All tests run in guest mode (the default e2e storageState).
 * No real Supabase round-trip - the sign-up/sign-in actions need a live DB,
 * so this spec only asserts the UI renders and validation fires correctly.
 */

import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

// ---------------------------------------------------------------------------
// Helper: open the sheet (skips if AuthButton is absent due to missing env vars)
// ---------------------------------------------------------------------------

async function openSheet(page: import("@playwright/test").Page) {
  await page.goto("/");
  const signIn = page.getByRole("button", { name: "Sign in" }).first();
  if (!(await signIn.isVisible().catch(() => false))) {
    return false;
  }
  await signIn.click();
  return true;
}

test.describe("SignInSheet - from nav trigger (#1669)", () => {
  test("Sign in button opens the SignInSheet dialog", async ({ page }) => {
    const opened = await openSheet(page);
    if (!opened) { test.skip(); return; }

    const dialog = page.getByRole("dialog", { name: /keep your progress safe/i });
    await expect(dialog).toBeVisible();
  });

  test("SignInSheet contains GitHub option that is actionable", async ({ page }) => {
    const opened = await openSheet(page);
    if (!opened) { test.skip(); return; }

    const dialog = page.getByRole("dialog", { name: /keep your progress safe/i });
    await expect(dialog).toBeVisible();

    const githubBtn = dialog.getByRole("button", { name: "Continue with GitHub" });
    await expect(githubBtn).toBeVisible();
    await expect(githubBtn).toBeEnabled();
  });

  test("SignInSheet contains Google option that is actionable", async ({ page }) => {
    const opened = await openSheet(page);
    if (!opened) { test.skip(); return; }

    const dialog = page.getByRole("dialog", { name: /keep your progress safe/i });
    await expect(dialog).toBeVisible();

    const googleBtn = dialog.getByRole("button", { name: "Continue with Google" });
    await expect(googleBtn).toBeVisible();
    await expect(googleBtn).toBeEnabled();
  });

  test("SignInSheet closes when the close button is clicked", async ({ page }) => {
    const opened = await openSheet(page);
    if (!opened) { test.skip(); return; }

    const dialog = page.getByRole("dialog", { name: /keep your progress safe/i });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: /close sign-in sheet/i }).click();
    await expect(dialog).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
// Username/password door (#1671)
// ---------------------------------------------------------------------------

test.describe("SignInSheet - username/password door (#1671)", () => {
  test("username form is visible in the sign-up sheet", async ({ page }) => {
    const opened = await openSheet(page);
    if (!opened) { test.skip(); return; }

    const dialog = page.getByRole("dialog", { name: /keep your progress safe/i });
    await expect(dialog).toBeVisible();

    // Username and password inputs must be present.
    await expect(dialog.getByLabel(/username/i)).toBeVisible();
    await expect(dialog.getByLabel(/password/i)).toBeVisible();

    // Submit button for sign-up.
    await expect(dialog.getByRole("button", { name: /create account/i })).toBeVisible();
  });

  test("both safety warnings render in sign-up mode", async ({ page }) => {
    const opened = await openSheet(page);
    if (!opened) { test.skip(); return; }

    const dialog = page.getByRole("dialog", { name: /keep your progress safe/i });
    await expect(dialog).toBeVisible();

    // No-reset warning.
    await expect(dialog.getByText(/there is no password reset/i)).toBeVisible();

    // No-real-name warning.
    await expect(dialog.getByText(/do not use your real name/i)).toBeVisible();
  });

  test("mode toggle switches to sign-in and hides warnings", async ({ page }) => {
    const opened = await openSheet(page);
    if (!opened) { test.skip(); return; }

    const dialog = page.getByRole("dialog", { name: /keep your progress safe/i });
    await expect(dialog).toBeVisible();

    // The toggle button is visible in sign-up mode.
    const toggle = dialog.getByRole("button", { name: /already have an account/i });
    await expect(toggle).toBeVisible();

    // Click to switch to sign-in mode.
    await toggle.click();

    // Warnings must be gone in sign-in mode.
    await expect(dialog.getByText(/there is no password reset/i)).toBeHidden();

    // Submit button changes to "Sign in".
    await expect(dialog.getByRole("button", { name: /^sign in$/i })).toBeVisible();

    // "New here?" toggle appears.
    await expect(dialog.getByRole("button", { name: /new here/i })).toBeVisible();
  });

  test("client-side validation fires for a too-short username", async ({ page }) => {
    const opened = await openSheet(page);
    if (!opened) { test.skip(); return; }

    const dialog = page.getByRole("dialog", { name: /keep your progress safe/i });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/username/i).fill("ab");
    await dialog.getByLabel(/password/i).fill("correct-horse-battery");
    await dialog.getByRole("button", { name: /create account/i }).click();

    // An error message must appear (client-side, no network call).
    await expect(dialog.getByRole("alert")).toBeVisible();
  });

  test("client-side validation fires for a too-short password", async ({ page }) => {
    const opened = await openSheet(page);
    if (!opened) { test.skip(); return; }

    const dialog = page.getByRole("dialog", { name: /keep your progress safe/i });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/username/i).fill("trainer99");
    await dialog.getByLabel(/password/i).fill("short");
    await dialog.getByRole("button", { name: /create account/i }).click();

    await expect(dialog.getByRole("alert")).toBeVisible();
  });
});
