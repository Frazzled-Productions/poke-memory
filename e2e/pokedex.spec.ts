import { test, expect } from "@playwright/test";

test.describe("Pokédex type filter — intersection", () => {
  test("single-type selection returns non-empty grid", async ({ page }) => {
    await page.goto("/pokedex");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    const fireButton = page
      .getByRole("group", { name: "Filter by type" })
      .getByRole("button", { name: "Fire" });
    await fireButton.click();

    // Grid should still have results for a single type
    await expect(page.getByText("No Pokémon match your filters.")).not.toBeVisible();
    await expect(page.getByRole("list", { name: /Pokémon/ }).first()).toBeVisible();
  });

  test("Fire + Flying returns fewer results than Fire alone", async ({ page }) => {
    await page.goto("/pokedex");

    const typeGroup = page.getByRole("group", { name: "Filter by type" });

    await typeGroup.getByRole("button", { name: "Fire" }).click();
    // Wait for the URL to reflect the new filter before counting — the filter
    // is URL-driven (router.replace), so URL settlement = grid re-rendered.
    await page.waitForURL(/type=fire/);
    const fireCount = await page.getByRole("listitem").count();
    expect(fireCount).toBeGreaterThan(0);

    await typeGroup.getByRole("button", { name: "Flying" }).click();
    await page.waitForURL(/flying/);
    const dualCount = await page.getByRole("listitem").count();

    // AND semantics: dual-type results must be a strict subset
    expect(dualCount).toBeGreaterThan(0);
    expect(dualCount).toBeLessThan(fireCount);
  });

  test("three types selected renders empty state", async ({ page }) => {
    // This relies on the seeded dataset: no Pokémon has Fire + Flying + Water
    // simultaneously. The filter logic itself is unit-tested in filter.test.ts.
    await page.goto("/pokedex");

    const typeGroup = page.getByRole("group", { name: "Filter by type" });
    await typeGroup.getByRole("button", { name: "Fire" }).click();
    await typeGroup.getByRole("button", { name: "Flying" }).click();
    await typeGroup.getByRole("button", { name: "Water" }).click();

    // No Pokémon has all three types — empty state must appear
    await expect(
      page.getByText("No Pokémon match your filters."),
    ).toBeVisible();
  });
});
