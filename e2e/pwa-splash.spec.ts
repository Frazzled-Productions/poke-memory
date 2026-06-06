import { test, expect } from "@playwright/test";

test.describe("PWA cold-start theme application", () => {
  test("inline script applies theme background before JS runs", async ({
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

    // The Pokéball overlay (#pwa-splash) was removed in #1727. Verify no
    // residual splash element is present after hydration.
    await expect(page.locator("#pwa-splash")).not.toBeAttached();
  });
});
