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
    await page.waitForURL(/type=fire/);

    // Grid should still have results for a single type
    await expect(page.getByText("No Pokémon match your filters.")).not.toBeVisible();
    await expect(page.getByRole("list", { name: /Pokémon/ }).first()).toBeVisible();
  });

  test("Fire + Flying returns fewer results than Fire alone", async ({ page }) => {
    await page.goto("/pokedex");

    const typeGroup = page.getByRole("group", { name: "Filter by type" });
    // Scope to the Pokémon grid lists to exclude any nav/other <li> elements
    const pokemonListItems = page.getByRole("list", { name: /Pokémon/ }).getByRole("listitem");

    await typeGroup.getByRole("button", { name: "Fire" }).click();
    // Wait for the URL to reflect the new filter before counting — the filter
    // is URL-driven (router.replace), so URL settlement = grid re-rendered.
    await page.waitForURL(/type=fire/);
    const fireCount = await pokemonListItems.count();
    expect(fireCount).toBeGreaterThan(0);

    await typeGroup.getByRole("button", { name: "Flying" }).click();
    await page.waitForURL(/type=.*flying/);
    const dualCount = await pokemonListItems.count();

    // AND semantics: dual-type results must be a strict subset
    expect(dualCount).toBeGreaterThan(0);
    expect(dualCount).toBeLessThan(fireCount);
  });

  test("three types selected renders empty state", async ({ page }) => {
    // This relies on the seeded dataset: no Pokémon has Fire + Flying + Water
    // simultaneously. The filter logic itself is unit-tested in filter.test.ts.
    await page.goto("/pokedex");

    const typeGroup = page.getByRole("group", { name: "Filter by type" });
    // Wait for each URL update before the next click — handleTypeToggle reads
    // filter state from the current URL, so clicking before the URL settles
    // causes the next type to overwrite rather than append.
    await typeGroup.getByRole("button", { name: "Fire" }).click();
    await page.waitForURL(/type=fire/);
    await typeGroup.getByRole("button", { name: "Flying" }).click();
    await page.waitForURL(/type=.*flying/);
    await typeGroup.getByRole("button", { name: "Water" }).click();
    await page.waitForURL(/type=.*water/);

    // No Pokémon has all three types — empty state must appear
    await expect(
      page.getByText("No Pokémon match your filters."),
    ).toBeVisible();
  });
});
