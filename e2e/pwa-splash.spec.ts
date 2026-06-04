import { test, expect } from "@playwright/test";

test.describe("PWA cold-start splash", () => {
  test("inline script creates splash before JS runs, then React removes it", async ({
    page,
  }) => {
    await page.goto("/");

    // Inline script sets html background synchronously at first paint.
    // This property persists after React renders.
    const bg = await page.evaluate(
      () => document.documentElement.style.background,
    );
    expect(bg).toMatch(/^#/);

    // The bounce keyframe <style> element is injected by the same inline script
    // block that creates the splash div. It is never removed, so it surviving
    // proves the splash-creation code ran before any JS bundle loaded.
    const hasBounceKeyframe = await page.evaluate(() =>
      Array.from(document.querySelectorAll("style")).some((s) =>
        s.textContent?.includes("__pwa_b"),
      ),
    );
    expect(hasBounceKeyframe).toBe(true);

    // React removed the splash div after hydrating
    await expect(page.locator("#pwa-splash")).not.toBeAttached();
  });
});
