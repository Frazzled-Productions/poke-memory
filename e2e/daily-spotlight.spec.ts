// e2e/daily-spotlight.spec.ts
// Smoke tests for the "Pokémon of the day" spotlight on the SESSION_COMPLETE
// / all-done end-of-session screen (#1949).

import { test, expect } from "@playwright/test";
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";
import {
  SEED_POKEMON_IDS,
  EVOLUTION_CARD_IDS,
  buildCompletedSession,
} from "./helpers/completedSession";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

const LOCALE_COOKIE = "poke-memory:locale";
const HIDDEN_ALT_EN = "A Pokémon sprite, name hidden";
const HIDDEN_ALT_JA = "ポケモンのスプライト、名前は非表示";

test.describe("Daily spotlight (#1949)", () => {
  test.beforeEach(async ({ page }) => {
    await addOnboardingPreDismiss(page);
  });

  test("renders on the all-caught-up state and reveals the name on click", async ({
    page,
  }) => {
    await seedSessionIdb(
      page,
      buildCompletedSession({
        pokemonIds: SEED_POKEMON_IDS,
        evolutionCardIds: EVOLUTION_CARD_IDS,
      }),
    );
    await page.goto("/");
    await awaitSeedIdb(page);

    // Confirm the session-complete end-state is reached first.
    await expect(page.getByText("All caught up!")).toBeVisible({
      timeout: 10_000,
    });

    // Heading renders.
    await expect(page.getByText("Pokémon of the day")).toBeVisible();

    // Sprite renders with the hidden alt text before reveal.
    const hiddenSprite = page.getByAltText(HIDDEN_ALT_EN);
    await expect(hiddenSprite).toBeVisible();

    // Reveal prompt + button are present before the reveal.
    await expect(page.getByText("Flip for its name")).toBeVisible();
    const revealButton = page.getByRole("button", { name: "Reveal the name" });
    await expect(revealButton).toBeVisible();

    // Click reveals the name; the button and prompt disappear.
    await revealButton.click();
    await expect(revealButton).not.toBeVisible();
    await expect(page.getByText("Flip for its name")).not.toBeVisible();
    await expect(hiddenSprite).not.toBeVisible();

    // The sprite's accessible name switches from the hidden alt text to the
    // revealed species name (rotates daily, so assert non-empty rather than
    // a specific name).
    const spriteAfterReveal = page.getByRole("img").first();
    await expect(spriteAfterReveal).toBeVisible();
    const altAfterReveal = await spriteAfterReveal.getAttribute("alt");
    expect(altAfterReveal).not.toBeNull();
    expect(altAfterReveal).not.toBe(HIDDEN_ALT_EN);
    expect((altAfterReveal ?? "").length).toBeGreaterThan(0);
  });

  test("renders localised copy when the app locale is Japanese", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: LOCALE_COOKIE,
        value: "ja",
        domain: "localhost",
        path: "/",
      },
    ]);

    await seedSessionIdb(
      page,
      buildCompletedSession({
        pokemonIds: SEED_POKEMON_IDS,
        evolutionCardIds: EVOLUTION_CARD_IDS,
      }),
    );
    await page.goto("/");
    await awaitSeedIdb(page);

    // Localised spotlight heading, hidden-alt text, prompt, and reveal button.
    await expect(page.getByText("今日のポケモン")).toBeVisible({
      timeout: 10_000,
    });
    const hiddenSprite = page.getByAltText(HIDDEN_ALT_JA);
    await expect(hiddenSprite).toBeVisible();
    await expect(page.getByText("めくって名前を見る")).toBeVisible();
    const revealButton = page.getByRole("button", { name: "名前を表示" });
    await expect(revealButton).toBeVisible();

    await revealButton.click();
    await expect(revealButton).not.toBeVisible();
    await expect(hiddenSprite).not.toBeVisible();
  });
});
