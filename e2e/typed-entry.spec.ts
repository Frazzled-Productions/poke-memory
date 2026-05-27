/**
 * E2E smoke tests for verified typed entry mode (#1251).
 *
 * Scope: guest mode only. Tests verify the Settings toggle renders and that
 * the TypedEntryNameCard renders with its input + submit controls when the
 * setting is on, and that submitting triggers the grade flow.
 */

import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

// Helper: write settings to localStorage with verifiedTypedEntryMode on.
async function enableTypedEntry(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    try {
      const KEY = "poke-memory:settings:v1";
      const raw = localStorage.getItem(KEY);
      let existing: Record<string, unknown> = { mobileNav: "bottom" };
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (typeof parsed === "object" && parsed !== null) {
            existing = parsed as Record<string, unknown>;
          }
        } catch {
          /* malformed — keep defaults */
        }
      }
      localStorage.setItem(
        KEY,
        JSON.stringify({
          ...existing,
          verifiedTypedEntryMode: true,
          onboarding: {
            ...(typeof existing.onboarding === "object" && existing.onboarding !== null
              ? (existing.onboarding as Record<string, unknown>)
              : {}),
            firstVisitOnboardingDismissed: true,
          },
        }),
      );
    } catch {
      /* localStorage unavailable */
    }
  });
}

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

test.describe("Verified typed entry — Settings toggle (#1251)", () => {
  test("the toggle is present in the Practice - Name cards section", async ({ page }) => {
    await page.goto("/settings");

    // Expand the Practice section.
    await page.getByRole("button", { name: /^practice$/i }).click();

    // The toggle should be visible.
    const toggle = page.getByRole("switch", {
      name: /verified typed entry for name cards/i,
    });
    await expect(toggle).toBeVisible();
    // Default: off.
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("toggling the switch marks it as checked and toggling again unchecks it", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: /^practice$/i }).click();

    const toggle = page.getByRole("switch", {
      name: /verified typed entry for name cards/i,
    });

    // Turn on.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    // Turn off.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});

test.describe("Verified typed entry — Practice flow (#1251)", () => {
  test("with the setting on, a name card shows the text input instead of the Reveal button", async ({
    page,
  }) => {
    await enableTypedEntry(page);
    await page.goto("/");

    // The practice page should render without crashing.
    await expect(page.getByRole("main")).toBeVisible();

    // Wait for the session to load (the loading skeleton to disappear).
    // When typed-entry mode is on, a name card renders an input instead of
    // the Reveal button. Wait for either state to stabilise.
    // Use a generous timeout because the session build reads IDB on first load.
    await expect(
      page.getByRole("textbox", { name: /type the pokémon name/i }),
    ).toBeVisible({ timeout: 10000 });

    // The honour-system Reveal button should not be present.
    await expect(page.getByRole("button", { name: /^reveal$/i })).not.toBeVisible();

    // The Submit and I don't know buttons should be present.
    await expect(page.getByRole("button", { name: /^submit$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /i don.t know/i })).toBeVisible();
  });

  test("clicking I don't know fires a grade and moves off the input", async ({ page }) => {
    await enableTypedEntry(page);
    await page.goto("/");

    // Wait for the typed-entry input to appear.
    const input = page.getByRole("textbox", { name: /type the pokémon name/i });
    await expect(input).toBeVisible({ timeout: 10000 });

    // Click I don't know — this should fire Again (1) and show feedback.
    await page.getByRole("button", { name: /i don.t know/i }).click();

    // After submitting, the input form disappears and feedback appears.
    await expect(input).not.toBeVisible();

    // Feedback copy for a wrong answer: "Not quite."
    await expect(page.getByText(/not quite/i)).toBeVisible();
  });
});
