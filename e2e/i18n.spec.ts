// e2e/i18n.spec.ts
// Smoke tests for multi-locale UI (#1260).
//
// The `languages` Labs flag must be enabled and a locale set in the cookie for
// locale-specific content to render. We seed both via init scripts.

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

const MT_BANNER_KEY_JA = "poke-memory:mt-banner-dismissed:ja";

test.describe("i18n — MachineTranslationBanner (#1381)", () => {
  test.beforeEach(async ({ page }) => {
    await addOnboardingPreDismiss(page);
  });

  test("banner is absent when locale is English (default)", async ({ page }) => {
    // No locale cookie set — falls back to English. Banner must not render.
    await page.goto("/");

    // The banner's visible text is the machine-translated caution message.
    // We assert it is not visible rather than not in the DOM, since the
    // component renders null for English — either way the text is absent.
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

    // Reload — banner must stay gone (localStorage persists the flag).
    await page.reload();
    await expect(page.getByTestId("machine-translation-banner")).not.toBeVisible();
  });
});

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

  test("enabling Languages flag reveals both locale selectors", async ({ page }) => {
    await enableLanguagesFlag(page);
    await page.goto("/settings");

    // Expand Labs section.
    await page.getByRole("button", { name: /^labs$/i }).click();

    // Both selectors should be visible because the flag is on.
    const appLocaleSelect = page.locator("#labs-app-locale-select");
    const pokemonNameLocaleSelect = page.locator("#labs-pokemon-name-locale-select");
    await expect(appLocaleSelect).toBeVisible();
    await expect(pokemonNameLocaleSelect).toBeVisible();

    // Both selectors must offer all four locales.
    for (const select of [appLocaleSelect, pokemonNameLocaleSelect]) {
      await expect(select.locator('option[value="en"]')).toHaveCount(1);
      await expect(select.locator('option[value="ja"]')).toHaveCount(1);
      await expect(select.locator('option[value="zh-Hans"]')).toHaveCount(1);
      await expect(select.locator('option[value="zh-Hant"]')).toHaveCount(1);
    }
  });

  test("app language and Pokémon name language selectors are independent", async ({
    page,
    context,
  }) => {
    await enableLanguagesFlag(page);
    await page.goto("/settings");

    // Expand Labs section.
    await page.getByRole("button", { name: /^labs$/i }).click();

    const appLocaleSelect = page.locator("#labs-app-locale-select");
    const pokemonNameLocaleSelect = page.locator("#labs-pokemon-name-locale-select");
    await expect(appLocaleSelect).toBeVisible();
    await expect(pokemonNameLocaleSelect).toBeVisible();

    // Switch app language to Japanese — should write the cookie.
    await appLocaleSelect.selectOption("ja");
    await page.waitForFunction(
      () => document.cookie.includes("poke-memory:locale=ja"),
      null,
      { timeout: 5_000 },
    );

    // Switch Pokémon name language to Simplified Chinese — should write settings, NOT the cookie.
    await pokemonNameLocaleSelect.selectOption("zh-Hans");

    // Cookie should still be "ja" (only the app language select writes it).
    const cookies = await context.cookies();
    const localeCookie = cookies.find((c) => c.name === LOCALE_COOKIE);
    expect(localeCookie?.value).toBe("ja");

    // The settings selector itself shows zh-Hans (controlled by localStorage).
    await expect(pokemonNameLocaleSelect).toHaveValue("zh-Hans");

    // Verify pokemonNameLocale was written to localStorage settings.
    const settingsRaw = await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY);
    expect(settingsRaw).not.toBeNull();
    const settings = JSON.parse(settingsRaw!) as Record<string, unknown>;
    expect(settings.pokemonNameLocale).toBe("zh-Hans");
  });

  test("switching app locale to ja sets poke-memory:locale cookie", async ({
    page,
    context,
  }) => {
    await enableLanguagesFlag(page);
    await page.goto("/settings");

    // Expand Labs section.
    await page.getByRole("button", { name: /^labs$/i }).click();

    const appLocaleSelect = page.locator("#labs-app-locale-select");
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
