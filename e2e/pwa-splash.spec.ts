import { test, expect } from "@playwright/test";

test.describe("PWA cold-start splash", () => {
  test("inline script creates the splash div before JS runs, then React removes it", async ({
    page,
  }) => {
    // Plant a MutationObserver before any page script executes so we can
    // assert the inline <script> created #pwa-splash even though it is gone
    // by the time the page is interactive.
    await page.addInitScript(() => {
      (window as { __splashCreated?: boolean }).__splashCreated = false;
      new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of Array.from(m.addedNodes)) {
            if (node instanceof Element && node.id === "pwa-splash") {
              (window as { __splashCreated?: boolean }).__splashCreated = true;
            }
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    });

    await page.goto("/");

    // The inline script created the splash div (proves it ran before JS bundles)
    const splashCreated = await page.evaluate(
      () => (window as { __splashCreated?: boolean }).__splashCreated,
    );
    expect(splashCreated).toBe(true);

    // React removed it after hydrating
    await expect(page.locator("#pwa-splash")).not.toBeAttached();

    // The inline script also set the html background colour (proves end-to-end completion)
    const bg = await page.evaluate(
      () => document.documentElement.style.background,
    );
    expect(bg).toMatch(/^#/);
  });
});
