import { test, expect, type Page } from "@playwright/test";

// Helper: seed a clean settings key so each test starts from a known state.
// Passing intensity: null omits the key entirely (factory-fresh visit).
async function seedSettings(
  page: Page,
  intensity: "accents" | "tinted" | "full" | null,
): Promise<void> {
  await page.addInitScript((i) => {
    window.localStorage.removeItem("poke-memory:settings:v1");
    if (i !== null) {
      // Minimal settings blob — only the fields the pre-paint script and
      // FavouriteThemeProvider actually read. Other defaults are fine at zero.
      window.localStorage.setItem(
        "poke-memory:settings:v1",
        JSON.stringify({ themeIntensity: i }),
      );
    }
  }, intensity);
}

test.describe("Theme intensity — data-intensity attribute", () => {
  test("fresh visit has no data-intensity attribute on <html>", async ({
    page,
  }) => {
    // No settings in localStorage → default is 'accents' → no attribute.
    await seedSettings(page, null);
    await page.goto("/");
    const attr = await page.evaluate(() =>
      document.documentElement.getAttribute("data-intensity"),
    );
    expect(attr).toBeNull();
  });

  test("pre-seeded 'tinted' setting sets data-intensity on <html>", async ({
    page,
  }) => {
    await seedSettings(page, "tinted");
    await page.goto("/");
    // React 19 App Router strips all <html> attributes during its singleton-
    // element commit and restores them via FavouriteThemeProvider.useEffect.
    // That effect fires after the load event, so we poll rather than assert
    // synchronously. The attribute is typically present within one frame after
    // load (~16ms) because the synchronous applyIntensity() call in the effect
    // body runs before the next repaint.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            document.documentElement.getAttribute("data-intensity"),
          ),
        { timeout: 5_000 },
      )
      .toBe("tinted");
  });

  test("pre-seeded 'full' setting sets data-intensity on <html>", async ({
    page,
  }) => {
    await seedSettings(page, "full");
    await page.goto("/");
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            document.documentElement.getAttribute("data-intensity"),
          ),
        { timeout: 5_000 },
      )
      .toBe("full");
  });
});

test.describe("Theme intensity — Settings page picker", () => {
  // NOTE: We do NOT use addInitScript for localStorage.clear() in beforeEach
  // because addInitScript runs on every navigation including page.reload(),
  // which would wipe settings the user just saved before the reload can read
  // them back (e.g. "Tinted selection persists" test). Each test that needs a
  // clean slate sets it via addInitScript individually.

  test("Settings page exposes the Theme intensity radio group with three options", async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto("/settings");
    // Wait for the skeleton to disappear (settings loaded).
    await expect(page.getByLabel("Loading settings")).toBeHidden();

    // The section heading rendered by IntensityPicker.
    await expect(
      page.getByRole("heading", { name: "Theme intensity" }),
    ).toBeVisible();

    // Three radio buttons: labels come from IntensityPicker OPTIONS[].label.
    await expect(
      page.getByRole("radio", { name: "Subtle accents only" }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "Tinted backgrounds" }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "Full mascot theme" }),
    ).toBeVisible();
  });

  test("default selection is 'Subtle accents only' on a fresh visit", async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto("/settings");
    await expect(page.getByLabel("Loading settings")).toBeHidden();

    await expect(
      page.getByRole("radio", { name: "Subtle accents only" }),
    ).toBeChecked();
    await expect(
      page.getByRole("radio", { name: "Tinted backgrounds" }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("radio", { name: "Full mascot theme" }),
    ).not.toBeChecked();
  });

  test("choosing Tinted sets data-intensity='tinted' on <html>", async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto("/settings");
    await expect(page.getByLabel("Loading settings")).toBeHidden();

    await page.getByRole("radio", { name: "Tinted backgrounds" }).click();

    // FavouriteThemeProvider receives SETTINGS_SAVED_EVENT and calls
    // applyIntensity — wait for the DOM attribute to appear.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            document.documentElement.getAttribute("data-intensity"),
          ),
        { timeout: 5_000 },
      )
      .toBe("tinted");
  });

  test("Tinted selection is persisted to localStorage by the picker", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page.getByLabel("Loading settings")).toBeHidden();

    await page.getByRole("radio", { name: "Tinted backgrounds" }).click();

    // Confirm attribute is set after the radio click.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            document.documentElement.getAttribute("data-intensity"),
          ),
        { timeout: 5_000 },
      )
      .toBe("tinted");

    // Reload — FavouriteThemeProvider.useEffect restores the attribute
    // synchronously from localStorage once effects fire after React's
    // singleton-element commit. Poll until present.
    await page.reload();
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            document.documentElement.getAttribute("data-intensity"),
          ),
        { timeout: 5_000 },
      )
      .toBe("tinted");
  });

  test("switching back to Accents removes data-intensity attribute", async ({
    page,
  }) => {
    // Start with tinted pre-seeded.
    await seedSettings(page, "tinted");
    await page.goto("/settings");
    await expect(page.getByLabel("Loading settings")).toBeHidden();

    // Confirm tinted is active.
    await expect(
      page.getByRole("radio", { name: "Tinted backgrounds" }),
    ).toBeChecked();

    await page.getByRole("radio", { name: "Subtle accents only" }).click();

    await expect
      .poll(
        () =>
          page.evaluate(() =>
            document.documentElement.getAttribute("data-intensity"),
          ),
        { timeout: 5_000 },
      )
      .toBeNull();
  });
});

test.describe("Theme watermark visibility", () => {
  test("watermark is absent from DOM at default (accents) intensity", async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto("/");
    // ThemeWatermark returns null when intensity is 'accents' — element should
    // not be in the DOM at all.
    await expect(page.locator('[data-testid="theme-watermark"]')).toHaveCount(
      0,
    );
  });

  test("watermark is visible at tinted intensity", async ({ page }) => {
    await seedSettings(page, "tinted");
    await page.goto("/");
    // Allow time for FavouriteThemeProvider + ThemeWatermark to mount and
    // the MutationObserver / SETTINGS_SAVED_EVENT to fire.
    await expect(
      page.locator('[data-testid="theme-watermark"]'),
    ).toBeAttached({ timeout: 5_000 });
  });

  test("watermark is visible at full intensity", async ({ page }) => {
    await seedSettings(page, "full");
    await page.goto("/");
    await expect(
      page.locator('[data-testid="theme-watermark"]'),
    ).toBeAttached({ timeout: 5_000 });
  });

  test("watermark appears after switching intensity to tinted on the settings page", async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto("/settings");
    await expect(page.getByLabel("Loading settings")).toBeHidden();

    // Watermark must be absent initially.
    await expect(page.locator('[data-testid="theme-watermark"]')).toHaveCount(
      0,
    );

    await page.getByRole("radio", { name: "Tinted backgrounds" }).click();

    // After the radio click, saveSettings fires SETTINGS_SAVED_EVENT →
    // ThemeWatermark updates its intensity state → element mounts.
    await expect(
      page.locator('[data-testid="theme-watermark"]'),
    ).toBeAttached({ timeout: 5_000 });
  });
});
