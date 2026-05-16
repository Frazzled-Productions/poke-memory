import { test, expect } from "@playwright/test";

test.describe("Privacy notice page", () => {
  test("loads and shows the main heading", async ({ page }) => {
    await page.goto("/privacy");
    await expect(
      page.getByRole("heading", { level: 1, name: "Privacy Notice" }),
    ).toBeVisible();
  });

  test("footer link navigates to /privacy", async ({ page }) => {
    await page.goto("/");
    const footer = page.getByRole("contentinfo");
    await footer.getByRole("link", { name: "Privacy" }).click();
    await expect(page).toHaveURL("/privacy");
    await expect(
      page.getByRole("heading", { level: 1, name: "Privacy Notice" }),
    ).toBeVisible();
  });

  test("shows the plain-language summary card", async ({ page }) => {
    await page.goto("/privacy");
    await expect(
      page.getByRole("heading", {
        name: "In plain language — what does Poké Memory do with your data?",
      }),
    ).toBeVisible();
  });

  test("summary card links to Settings controls", async ({ page }) => {
    await page.goto("/privacy");
    const exportLink = page.getByRole("link", { name: /export your progress/i });
    const resetLink = page.getByRole("link", { name: /reset all progress/i });
    await expect(exportLink).toBeVisible();
    await expect(resetLink).toBeVisible();
    await expect(exportLink).toHaveAttribute(
      "href",
      "/settings#backup-heading",
    );
    await expect(resetLink).toHaveAttribute(
      "href",
      "/settings#danger-zone-heading",
    );
  });
});
