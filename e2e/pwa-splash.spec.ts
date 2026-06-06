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

    // Tombstone / regression-guard: #pwa-splash was removed entirely in #1727
    // and is never injected into the DOM. This assertion will always pass by
    // design (the element does not exist), but it is kept as a belt-and-
    // suspenders guard so a future accidental re-introduction of the overlay
    // is caught immediately without needing to write a new test.
    await expect(page.locator("#pwa-splash")).not.toBeAttached();
  });
});
