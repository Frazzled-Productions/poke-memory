import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

// Favourite Pokémon and hearts (#2187), guest mode: set a favourite from a
// silhouette Pokédex page, heart another, see the hearts in the grid and the
// partner on Journey.

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

test("guest sets a favourite from a silhouette page, hearts another and sees the partner on Journey", async ({ page }) => {
  // A fresh guest has learned nothing, so Bulbasaur's page is a silhouette.
  await page.goto("/pokedex/1");
  const makeFavourite = page.getByRole("button", { name: "Make #001 (locked) your favourite" });
  await expect(makeFavourite).toBeVisible({ timeout: 15_000 });
  await expect(makeFavourite).toHaveAttribute("aria-pressed", "false");

  await makeFavourite.click();
  await expect(makeFavourite).toHaveAttribute("aria-pressed", "true");
  // The favourite is always hearted.
  await expect(
    page.getByRole("button", { name: "#001 (locked) is your favourite, so it stays hearted" }),
  ).toHaveAttribute("aria-pressed", "true");

  // Unmastered, so the learn-first question is asked once; answer No.
  const question = page.getByRole("group", { name: "Learn #001 (locked)'s evolution line next?" });
  await expect(question).toBeVisible();
  await question.getByRole("button", { name: "No, thanks" }).click();
  await expect(question).toBeHidden();

  // Heart Charmander from its (silhouette) page.
  await page.goto("/pokedex/4");
  const heart = page.getByRole("button", { name: "Heart #004 (locked)" });
  await expect(heart).toBeVisible({ timeout: 15_000 });
  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");

  // Both show a heart in the grid.
  await page.goto("/pokedex");
  await expect(page.getByRole("img", { name: "Hearted" })).toHaveCount(2, { timeout: 15_000 });

  // The partner appears on the Journey trainer card, as a silhouette with its name.
  await page.goto("/journey");
  const trainerCard = page.getByRole("region", { name: "Trainer card" });
  await expect(trainerCard).toBeVisible({ timeout: 15_000 });
  await expect(trainerCard.getByText("Your partner")).toBeVisible();
  await expect(trainerCard.getByText("Bulbasaur")).toBeVisible();
});

test("with no favourite, Journey links to the Pokédex to choose one", async ({ page }) => {
  await page.goto("/journey");
  const link = page
    .getByRole("region", { name: "Trainer card" })
    .getByRole("link", { name: "Choose your favourite" });
  await expect(link).toBeVisible({ timeout: 15_000 });
  await expect(link).toHaveAttribute("href", "/pokedex");
});
