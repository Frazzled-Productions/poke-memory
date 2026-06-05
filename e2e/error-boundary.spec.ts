import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

// ---------------------------------------------------------------------------
// Error-boundary smoke tests (#1533)
//
// app/error.tsx is the root error boundary for all Next.js App Router routes.
// PR #1513 added a guest-only "Reset local practice data" button as an escape
// hatch for persisted-state crashes (#1506).
//
// Tests navigate to /test-error - a minimal "use client" page that
// unconditionally throws - so the error boundary renders in a reproducible,
// stable state without depending on real data or timing.
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

test.describe("Error boundary (#1533)", () => {
  test("renders the error heading when a component throws", async ({
    page,
  }) => {
    await page.goto("/test-error");

    await expect(
      page.getByRole("heading", { name: /something went wrong/i }),
    ).toBeVisible();
  });

  test("renders the Try again button", async ({ page }) => {
    await page.goto("/test-error");

    await expect(
      page.getByRole("button", { name: /try again/i }),
    ).toBeVisible();
  });

  test("renders the Go to Practice link pointing to /", async ({ page }) => {
    await page.goto("/test-error");

    const link = page.getByRole("link", { name: /go to practice/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/");
  });

  test("Reset local practice data button is visible in guest mode", async ({
    page,
  }) => {
    // E2E tests run in guest mode only (AGENTS.md). The reset button is
    // shown when auth has settled and the user is not signed in.
    await page.goto("/test-error");

    await expect(
      page.getByRole("button", { name: /reset local practice data/i }),
    ).toBeVisible();
  });

  test("clicking Reset local practice data triggers a confirm dialog", async ({
    page,
  }) => {
    await page.goto("/test-error");

    // Register the handler BEFORE clicking so the dialog event is never missed.
    let capturedDialog: import("@playwright/test").Dialog | undefined;
    page.on("dialog", (dialog) => {
      capturedDialog = dialog;
      // Dismiss (cancel) so the page does not reload in this test.
      void dialog.dismiss();
    });

    await page.getByRole("button", { name: /reset local practice data/i }).click();

    // Give Playwright a tick to invoke the handler.
    await page.waitForFunction(() => true);

    expect(capturedDialog).toBeDefined();
    expect(capturedDialog!.type()).toBe("confirm");
    expect(capturedDialog!.message()).toMatch(
      /delete your local practice progress/i,
    );
  });

  test("confirming the Reset dialog reloads the page", async ({ page }) => {
    await page.goto("/test-error");

    // Accept the confirm dialog so clearLocalProgress() runs and
    // window.location.reload() fires. Because /test-error always throws, the
    // error boundary will be visible again after the reload - providing
    // end-to-end confirmation that the reset path executes without crashing.
    page.on("dialog", (dialog) => void dialog.accept());

    await page.getByRole("button", { name: /reset local practice data/i }).click();

    // Wait for the reload to complete and the error boundary to reappear.
    await expect(
      page.getByRole("heading", { name: /something went wrong/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
