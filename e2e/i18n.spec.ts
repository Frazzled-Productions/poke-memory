// e2e/i18n.spec.ts
// Smoke tests for multi-locale UI (#1260, updated #1726 GA).
//
// Multi-locale is now GA (no Labs flag gate). The Language section renders
// unconditionally. A locale cookie is still needed to serve localised content.

import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

const SETTINGS_KEY = "poke-memory:settings:v1";
const LOCALE_COOKIE = "poke-memory:locale";

/** Seed localStorage with multiple learning locales for Language section tests. */
async function seedLearningLocales(page: import("@playwright/test").Page): Promise<void> {
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
        learningLocales: ["en", "zh-Hans"],
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

const MT_BANNER_KEY_JA = "poke-memory:mt-banner-dismissed:ja";

test.describe("i18n - MachineTranslationBanner (#1381)", () => {
  test.beforeEach(async ({ page }) => {
    await addOnboardingPreDismiss(page);
  });

  test("banner is absent when locale is English (default)", async ({ page }) => {
    // No locale cookie set - falls back to English. Banner must not render.
    await page.goto("/");

    // The banner's visible text is the machine-translated caution message.
    // We assert it is not visible rather than not in the DOM, since the
    // component renders null for English - either way the text is absent.
    await expect(page.getByTestId("machine-translation-banner")).not.toBeVisible();
  });

  test("banner text is visible when locale=ja is set via cookie", async ({ page, context }) => {
    await context.addCookies([
      {
        name: LOCALE_COOKIE,
        value: "ja",
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.goto("/");

    // The banner renders with role="note" and the localised caution message.
    const banner = page.getByTestId("machine-translation-banner");
    await expect(banner).toBeVisible();

    // The visible paragraph contains the Japanese translation text.
    await expect(page.getByText(/自動的に作成/)).toBeVisible();
  });

  test("dismissing the banner hides it and persists dismissal across reload", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: LOCALE_COOKIE,
        value: "ja",
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.goto("/");

    // Confirm the banner is visible before dismissal.
    const banner = page.getByTestId("machine-translation-banner");
    await expect(banner).toBeVisible();

    // Click the dismiss button (its accessible label is the catalogue "dismiss" key).
    // The Japanese translation for dismiss is "閉じる".
    await page.getByRole("button", { name: "閉じる" }).click();

    // Banner should disappear immediately.
    await expect(banner).not.toBeVisible();

    // The dismissal flag must be written to localStorage.
    const flag = await page.evaluate((key) => localStorage.getItem(key), MT_BANNER_KEY_JA);
    expect(flag).toBe("1");

    // Reload - banner must stay gone (localStorage persists the flag).
    await page.reload();
    await expect(page.getByTestId("machine-translation-banner")).not.toBeVisible();
  });
});

test.describe("i18n - Language section GA (#1726)", () => {
  // Language is now GA - no Labs flag needed. The Language section renders
  // unconditionally as the fourth top-level section.

  test.beforeEach(async ({ page }) => {
    await addOnboardingPreDismiss(page);
  });

  test("Language section appears in Settings without any flag setup", async ({
    page,
  }) => {
    await page.goto("/settings");

    // The Language section renders unconditionally (no flag gate).
    const langButton = page.getByRole("button", { name: /^language$/i });
    await expect(langButton).toBeVisible();
  });

  test("Language section contains the app-language selector and enrolment list", async ({
    page,
  }) => {
    await page.goto("/settings");

    // Expand Language section.
    await page.getByRole("button", { name: /^language$/i }).click();

    // The app-language selector must offer all four locales.
    const appLocaleSelect = page.locator("#app-locale-select");
    await expect(appLocaleSelect).toBeVisible();
    await expect(appLocaleSelect.locator('option[value="en"]')).toHaveCount(1);
    await expect(appLocaleSelect.locator('option[value="ja"]')).toHaveCount(1);
    await expect(appLocaleSelect.locator('option[value="zh-Hans"]')).toHaveCount(1);
    await expect(appLocaleSelect.locator('option[value="zh-Hant"]')).toHaveCount(1);

    // The Pokémon-name language is switched from the status-bar pill.
    await expect(
      page.getByRole("button", { name: /Pokémon name language/ }),
    ).toBeVisible();
  });

  test("app language (Settings) and Pokémon name language (bar pill) are independent", async ({
    page,
    context,
  }) => {
    await seedLearningLocales(page);
    await page.goto("/settings");

    // Expand Language section.
    await page.getByRole("button", { name: /^language$/i }).click();

    // Switch the Pokémon name language to Simplified Chinese via the bar pill
    // FIRST, while the chrome is still English (the pill's accessible name is
    // localised, so interact before flipping the app language). Writes settings,
    // NOT the locale cookie.
    await page.getByRole("button", { name: /Pokémon name language/ }).click();
    await page.getByRole("radio", { name: /简体中文/ }).click();

    // Switch the app language to Japanese via the Settings selector - writes the cookie.
    const appLocaleSelect = page.locator("#app-locale-select");
    await expect(appLocaleSelect).toBeVisible();
    await appLocaleSelect.selectOption("ja");
    await page.waitForFunction(
      () => document.cookie.includes("poke-memory:locale=ja"),
      null,
      { timeout: 5_000 },
    );

    // Cookie should be "ja" (only the app language select writes it).
    const cookies = await context.cookies();
    const localeCookie = cookies.find((c) => c.name === LOCALE_COOKIE);
    expect(localeCookie?.value).toBe("ja");

    // Verify pokemonNameLocale was written to localStorage settings (independent).
    const settingsRaw = await page.evaluate(
      (key) => localStorage.getItem(key),
      SETTINGS_KEY,
    );
    expect(settingsRaw).not.toBeNull();
    const settings = JSON.parse(settingsRaw!) as Record<string, unknown>;
    expect(settings.pokemonNameLocale).toBe("zh-Hans");
  });

  test("switching app locale to ja sets poke-memory:locale cookie", async ({
    page,
    context,
  }) => {
    await page.goto("/settings");

    // Expand Language section.
    await page.getByRole("button", { name: /^language$/i }).click();

    const appLocaleSelect = page.locator("#app-locale-select");
    await expect(appLocaleSelect).toBeVisible();

    // Switch to Japanese.
    await appLocaleSelect.selectOption("ja");

    // Wait for the Server Action to commit by polling document.cookie directly.
    await page.waitForFunction(
      () => document.cookie.includes("poke-memory:locale=ja"),
      null,
      { timeout: 5_000 },
    );

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
