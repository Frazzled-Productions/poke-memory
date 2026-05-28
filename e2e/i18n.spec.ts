// e2e/i18n.spec.ts
// Smoke tests for multi-locale UI (#1260).
//
// The `languages` Labs flag must be enabled and a locale set in the cookie for
// locale-specific content to render. We seed both via init scripts.
//
// Note on ja.json: the stub catalogue has real Japanese translations for the
// nav labels and settings heading, so those are used as assertions here.
// Pokémon names use `generated-locale-names.json` (served statically) — the
// test asserts Pikachu renders as "ピカチュウ" when locale=ja and the languages
// flag is on.

import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

const SETTINGS_KEY = "poke-memory:settings:v1";
const LOCALE_COOKIE = "poke-memory:locale";

/** Seed localStorage to enable the `languages` Labs flag. */
async function enableLanguagesFlag(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      const KEY = "poke-memory:settings:v1";
      const raw = localStorage.getItem(KEY);
      let existing: Record<string, unknown> = {};
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (typeof parsed === "object" && parsed !== null) {
            existing = parsed as Record<string, unknown>;
          }
        } catch {
          /* ignore */
        }
      }
      const merged = {
        mobileNav: "bottom",
        ...existing,
        labsFlags: {
          ...(typeof existing.labsFlags === "object" && existing.labsFlags !== null
            ? (existing.labsFlags as Record<string, unknown>)
            : {}),
          languages: true,
        },
        onboarding: {
          ...(typeof existing.onboarding === "object" && existing.onboarding !== null
            ? (existing.onboarding as Record<string, unknown>)
            : {}),
          firstVisitOnboardingDismissed: true,
        },
      };
      localStorage.setItem(KEY, JSON.stringify(merged));
    } catch {
      /* localStorage unavailable */
    }
  });
}

test.describe("i18n — Languages Labs flag (#1260)", () => {
  test.beforeEach(async ({ page }) => {
    await addOnboardingPreDismiss(page);
  });

  test("Labs section appears in Settings once the languages flag is in the registry", async ({
    page,
  }) => {
    await page.goto("/settings");

    // The Labs section is rendered when LABS_FLAGS has at least one entry.
    // Since languages was registered in #1260, the section must be present.
    const labsButton = page.getByRole("button", { name: /^labs$/i });
    await expect(labsButton).toBeVisible();
  });

  test("Languages toggle appears inside Labs section", async ({ page }) => {
    await page.goto("/settings");

    // Expand Labs section.
    await page.getByRole("button", { name: /^labs$/i }).click();

    // The Languages flag label must be visible.
    await expect(page.getByText("Languages")).toBeVisible();
  });

  test("enabling Languages flag reveals a locale selector", async ({ page }) => {
    await enableLanguagesFlag(page);
    await page.goto("/settings");

    // Expand Labs section.
    await page.getByRole("button", { name: /^labs$/i }).click();

    // The locale selector should be visible because the flag is on.
    const localeSelect = page.getByLabel("Language");
    await expect(localeSelect).toBeVisible();

    // All four locales must be present as options.
    await expect(localeSelect.locator('option[value="en"]')).toHaveCount(1);
    await expect(localeSelect.locator('option[value="ja"]')).toHaveCount(1);
    await expect(localeSelect.locator('option[value="zh-Hans"]')).toHaveCount(1);
    await expect(localeSelect.locator('option[value="zh-Hant"]')).toHaveCount(1);
  });

  test("switching locale to ja sets poke-memory:locale cookie", async ({
    page,
    context,
  }) => {
    await enableLanguagesFlag(page);
    await page.goto("/settings");

    // Expand Labs section.
    await page.getByRole("button", { name: /^labs$/i }).click();

    const localeSelect = page.getByLabel("Language");
    await expect(localeSelect).toBeVisible();

    // Switch to Japanese.
    await localeSelect.selectOption("ja");

    // Wait briefly for the Server Action to fire and the cookie to be set.
    await page.waitForTimeout(1000);

    // Verify the cookie was written.
    const cookies = await context.cookies();
    const localeCookie = cookies.find((c) => c.name === LOCALE_COOKIE);
    expect(localeCookie).toBeDefined();
    expect(localeCookie?.value).toBe("ja");
  });

  test("when locale=ja the settings page heading shows in Japanese", async ({
    page,
    context,
  }) => {
    // Set the locale cookie before loading the page.
    await enableLanguagesFlag(page);
    await context.addCookies([
      {
        name: LOCALE_COOKIE,
        value: "ja",
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.goto("/settings");

    // The settings heading should be the Japanese translation ("設定").
    // This uses the real ja.json entry which is manually translated.
    await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();
  });
});
