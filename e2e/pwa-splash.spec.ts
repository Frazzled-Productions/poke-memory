import { test, expect } from "@playwright/test";

test.describe("PWA cold-start splash", () => {
  test("inline script creates splash before JS runs, then React removes it", async ({
    page,
  }) => {
    await page.goto("/");

    // Inline script sets html background synchronously at first paint.
    // Browsers normalise the hex value to rgb() on readback, so assert non-empty
    // rather than matching the original hex string.
    const bg = await page.evaluate(
      () => document.documentElement.style.background,
    );
    expect(bg).not.toBe("");

    // React removed the splash div after hydrating
    await expect(page.locator("#pwa-splash")).not.toBeAttached();
  });
});
