import { test, expect, type Page } from "@playwright/test";

async function seedSuperuser(
  page: Page,
  opts: { unlocked: boolean; pretendAllMastered: boolean },
): Promise<void> {
  await page.addInitScript((o) => {
    if (o.unlocked) {
      window.localStorage.setItem("poke-memory:superuser", "true");
    } else {
      window.localStorage.removeItem("poke-memory:superuser");
    }
    window.localStorage.setItem(
      "poke-memory:superuser:flags:v1",
      JSON.stringify({ pretendAllMastered: o.pretendAllMastered }),
    );
  }, opts);
}

test.describe("Stats page — badge gallery", () => {
  test("badge gallery section is visible on the stats page", async ({
    page,
  }) => {
    await page.goto("/stats");
    // Wait for the page to hydrate past the loading skeleton — the heading
    // only renders once stats are loaded.
    await expect(
      page.getByRole("heading", { level: 2, name: "Gym badges" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("locked badges show hint text", async ({ page }) => {
    await page.goto("/stats");
    await expect(
      page.getByRole("heading", { level: 2, name: "Gym badges" }),
    ).toBeVisible({ timeout: 15_000 });
    // A fresh guest session has no earned badges; at least one locked tile
    // should be present. The Boulder Badge is the first catalog entry.
    await expect(
      page.getByLabel(/Boulder Badge \(locked\):/i).first(),
    ).toBeVisible();
  });

  test("pretendAllMastered shows all badges as earned", async ({ page }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: true });
    await page.goto("/stats");
    await expect(
      page.getByRole("heading", { level: 2, name: "Gym badges" }),
    ).toBeVisible({ timeout: 15_000 });
    // Under the flag every badge tile has "— earned" in its accessible name.
    // Boulder Badge is the first catalog entry.
    await expect(
      page.getByLabel("Boulder Badge — earned"),
    ).toBeVisible();
  });
});
