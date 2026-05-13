import { test, expect } from "@playwright/test";

test.describe("Onboarding (#433)", () => {
  test("welcome callout appears on a fresh visit and stays dismissed", async ({
    page,
  }) => {
    await page.goto("/");

    const welcome = page.getByRole("note", { name: /welcome to poké memory/i });
    await expect(welcome).toBeVisible();

    await welcome.getByRole("button", { name: /dismiss hint/i }).click();
    await expect(welcome).toHaveCount(0);

    await page.reload();
    await expect(
      page.getByRole("note", { name: /welcome to poké memory/i }),
    ).toHaveCount(0);
  });

  test("settings explainer + reset onboarding restores the hints", async ({
    page,
  }) => {
    // Dismiss the home welcome callout first so the reset has something to undo.
    await page.goto("/");
    const welcome = page.getByRole("note", { name: /welcome to poké memory/i });
    if (await welcome.isVisible().catch(() => false)) {
      await welcome.getByRole("button", { name: /dismiss hint/i }).click();
    }

    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: /how this works/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /show tips again/i }).click();

    await page.goto("/");
    await expect(
      page.getByRole("note", { name: /welcome to poké memory/i }),
    ).toBeVisible();
  });
});
