/**
 * E2E smoke tests for SignInSheet (#1669).
 *
 * Verifies the sheet opens from the nav Sign-in trigger and that the
 * provider buttons are reachable and actionable on both chromium and
 * mobile-safari.
 *
 * All tests run in guest mode (the default e2e storageState).
 */

import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

test.describe("SignInSheet - from nav trigger (#1669)", () => {
  test("Sign in button opens the SignInSheet dialog", async ({ page }) => {
    await page.goto("/");

    const signIn = page.getByRole("button", { name: "Sign in" }).first();
    if (!(await signIn.isVisible().catch(() => false))) {
      // AuthButton renders nothing when Supabase env vars are absent.
      test.skip();
      return;
    }

    await signIn.click();

    // The sheet must be present as a dialog with the value-prop heading.
    const dialog = page.getByRole("dialog", { name: /keep your progress safe/i });
    await expect(dialog).toBeVisible();
  });

  test("SignInSheet contains GitHub option that is actionable", async ({
    page,
  }) => {
    await page.goto("/");

    const signIn = page.getByRole("button", { name: "Sign in" }).first();
    if (!(await signIn.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await signIn.click();

    const dialog = page.getByRole("dialog", { name: /keep your progress safe/i });
    await expect(dialog).toBeVisible();

    const githubBtn = dialog.getByRole("button", { name: "Continue with GitHub" });
    await expect(githubBtn).toBeVisible();
    await expect(githubBtn).toBeEnabled();
  });

  test("SignInSheet contains Google option that is actionable", async ({
    page,
  }) => {
    await page.goto("/");

    const signIn = page.getByRole("button", { name: "Sign in" }).first();
    if (!(await signIn.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await signIn.click();

    const dialog = page.getByRole("dialog", { name: /keep your progress safe/i });
    await expect(dialog).toBeVisible();

    const googleBtn = dialog.getByRole("button", { name: "Continue with Google" });
    await expect(googleBtn).toBeVisible();
    await expect(googleBtn).toBeEnabled();
  });

  test("SignInSheet shows returning-user sign-in-instead text", async ({
    page,
  }) => {
    await page.goto("/");

    const signIn = page.getByRole("button", { name: "Sign in" }).first();
    if (!(await signIn.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await signIn.click();

    const dialog = page.getByRole("dialog", { name: /keep your progress safe/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/already have an account/i)).toBeVisible();
  });

  test("SignInSheet closes when the close button is clicked", async ({
    page,
  }) => {
    await page.goto("/");

    const signIn = page.getByRole("button", { name: "Sign in" }).first();
    if (!(await signIn.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await signIn.click();

    const dialog = page.getByRole("dialog", { name: /keep your progress safe/i });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: /close sign-in sheet/i }).click();
    await expect(dialog).toBeHidden();
  });
});
