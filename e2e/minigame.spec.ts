import { test, expect, type Page } from "@playwright/test";
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";
import {
  SEED_POKEMON_IDS,
  EVOLUTION_CARD_IDS,
  buildCompletedSession,
} from "./helpers/completedSession";
import { addOnboardingPreDismiss } from "./helpers/onboarding";
import { REVERSE_ID_OFFSET } from "./helpers/mastery";

// ---------------------------------------------------------------------------
// Pre-seed a NEW_CARDS_LOCKED state for the `name` card type:
//   - The first 10 IDs in pokemonIds are "introduced today" (firstSeen ===
//     today, lastReview === today, dueDate far future) so
//     name.newIntroducedToday === maxNewPerDay (10).
//   - The last ID in pokemonIds is a fresh new card (lastReview === null) so
//     hasMoreNewCardsOf(name) is true -> the new-cards wall fires.
//   - All other IDs are already-reviewed, not-due-today (no contribution to
//     either counter) so they don't accidentally trigger the review soft-wall.
//   - Evolution cards are seeded as reviewed, not-due - no evo queues populate.
//   - Reverse cards for ALL species are seeded as reviewed, future-due so that
//     hydrateSession (which now always runs with reverseEnabled=true after
//     #1234) does not add them as new cards and break the locked state.
// ---------------------------------------------------------------------------

function buildNewCardsLockedSession(args: {
  pokemonIds: number[];
  evolutionCardIds: number[];
}) {
  const { pokemonIds, evolutionCardIds } = args;
  const TODAY = new Date().toISOString().slice(0, 10);
  const PAST_DATE = "2026-01-01";
  const FUTURE_DATE = "2099-12-31";

  const baseState = {
    stability: 10,
    difficulty: 5,
    elapsedDays: 10,
    scheduledDays: 21,
    reps: 3,
    lapses: 0,
    fsrsState: "review",
    dueDate: FUTURE_DATE,
    lastReview: PAST_DATE,
    firstSeen: PAST_DATE,
    learningStep: null,
    stepStartedAt: null,
  };

  const cards: object[] = [];

  // All species except the last one: already reviewed.
  // The first 10 are "introduced today" to hit the new-card daily cap.
  for (let i = 0; i < pokemonIds.length - 1; i++) {
    const id = pokemonIds[i];
    const introducedToday = i < 10;
    cards.push({
      id,
      name: "pokemon-" + id,
      spriteUrl: "/sprites/pokemon/" + id + ".png",
      cardType: "name",
      state: {
        ...baseState,
        firstSeen: introducedToday ? TODAY : PAST_DATE,
        lastReview: introducedToday ? TODAY : PAST_DATE,
      },
    });
  }

  // Last species ID: fresh new card - satisfies hasMoreNewCardsOf("name") so
  // the new-cards wall fires even though daily caps are already hit.
  const lastId = pokemonIds[pokemonIds.length - 1];
  cards.push({
    id: lastId,
    name: "pokemon-" + lastId,
    spriteUrl: "/sprites/pokemon/" + lastId + ".png",
    cardType: "name",
    state: {
      ...baseState,
      dueDate: TODAY,
      lastReview: null,
      firstSeen: null,
    },
  });

  for (const id of evolutionCardIds) {
    cards.push({
      id,
      cardType: "evolution",
      preEvoId: 1,
      postEvoId: 2,
      preEvoName: "bulbasaur",
      postEvoName: "ivysaur",
      preEvoSpriteUrl: "/sprites/pokemon/1.png",
      postEvoSpriteUrl: "/sprites/pokemon/2.png",
      triggerPhrase: "at level 16",
      state: { ...baseState },
    });
  }

  // Seed all reverse cards as already-reviewed with a far-future due date.
  // Since #1234 hydrateSession always runs with reverseEnabled=true - without
  // these entries it would add every species as a fresh new reverse card,
  // breaking the NEW_CARDS_LOCKED state by making new reverse cards available.
  for (const id of pokemonIds) {
    cards.push({
      id: REVERSE_ID_OFFSET + id,
      name: "pokemon-" + id,
      spriteUrl: "/sprites/pokemon/" + id + ".png",
      cardType: "reverse",
      pokemonId: id,
      speciesId: id,
      state: { ...baseState },
    });
  }

  return {
    cards,
    limits: {
      name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
      reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    },
  };
}

const SETTINGS_KEY = "poke-memory:settings:v1";

// ---------------------------------------------------------------------------
// Local helper: click the "Play Higher or Lower" entry button and wait for the
// game region to become visible. Every test that needs the game open calls
// this after reaching the summary screen.
// ---------------------------------------------------------------------------
async function enterGame(page: Page): Promise<void> {
  const entryButton = page.getByRole("button", { name: /play higher or lower/i });
  await expect(entryButton).toBeVisible();
  await entryButton.click();
  await expect(
    page.getByRole("region", { name: /higher or lower mini-game/i }),
  ).toBeVisible();
}

test.describe("Higher-or-Lower mini-game", () => {
  // Pre-dismiss the first-visit modal so it does not block the end-of-session screen.
  test.beforeEach(async ({ page }) => {
    await addOnboardingPreDismiss(page);
  });

  test("mini-game section appears on SESSION_COMPLETE", async ({ page }) => {
    await seedSessionIdb(page, buildCompletedSession({
      pokemonIds: SEED_POKEMON_IDS,
      evolutionCardIds: EVOLUTION_CARD_IDS,
    }));
    await page.goto("/");
    await awaitSeedIdb(page);

    // Confirm the session-complete end-state is reached
    await expect(page.getByText("All caught up!")).toBeVisible();

    // The entry button is visible on the summary before entering the game
    await expect(
      page.getByRole("button", { name: /play higher or lower/i }),
    ).toBeVisible();

    // Enter the game
    await enterGame(page);

    const gameRegion = page.getByRole("region", {
      name: /higher or lower mini-game/i,
    });

    // Prompt is present ("Which has higher <Stat>?")
    await expect(page.getByText(/which has higher/i)).toBeVisible();

    // Two Pokémon tile buttons are present
    const pokemonButtons = gameRegion.getByRole("button");
    await expect(pokemonButtons).toHaveCount(2);
  });

  test("clicking a Pokémon tile reveals a result banner", async ({ page }) => {
    await seedSessionIdb(page, buildCompletedSession({
      pokemonIds: SEED_POKEMON_IDS,
      evolutionCardIds: EVOLUTION_CARD_IDS,
    }));
    await page.goto("/");
    await awaitSeedIdb(page);

    await expect(page.getByText("All caught up!")).toBeVisible();

    // Enter the game before interacting with tiles
    await enterGame(page);

    const gameRegion = page.getByRole("region", {
      name: /higher or lower mini-game/i,
    });

    // Click the first tile - any outcome (correct / tie / game over) is valid
    await gameRegion.getByRole("button").first().click();

    // Result banner appears after pick; regex covers all three outcome strings
    const resultBanner = page.getByText(
      /correct!|equal, both count\.|game over/i,
    );
    await expect(resultBanner).toBeVisible();
  });

  test("mini-game section appears on NEW_CARDS_LOCKED", async ({ page }) => {
    await seedSessionIdb(page, buildNewCardsLockedSession({
      pokemonIds: SEED_POKEMON_IDS,
      evolutionCardIds: EVOLUTION_CARD_IDS,
    }));
    await page.goto("/");
    await awaitSeedIdb(page);

    await expect(
      page.getByText("New cards locked for today"),
    ).toBeVisible();

    // The entry button is visible on the locked summary before entering the game
    await expect(
      page.getByRole("button", { name: /play higher or lower/i }),
    ).toBeVisible();

    // Enter the game
    await enterGame(page);

    const gameRegion = page.getByRole("region", {
      name: /higher or lower mini-game/i,
    });
    await expect(page.getByText(/which has higher/i)).toBeVisible();
    await expect(gameRegion.getByRole("button")).toHaveCount(2);
  });

  test("action button is in view and clickable after making a guess (#1837)", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-safari",
      "viewport-fit check is mobile-only",
    );
    // iPhone SE CSS viewport (375x667) - the shortest supported mobile
    // viewport. We also run at the standard iPhone 17 Pro (402x874) used in
    // the original #1447 report. The layout pins the action button as
    // flex-none so it is always visible without scrolling (#1837/#1882).
    for (const { width, height } of [
      { width: 375, height: 667 }, // iPhone SE (shortest supported)
      { width: 402, height: 874 }, // iPhone 17 Pro (original report)
    ]) {
      await page.setViewportSize({ width, height });
      await seedSessionIdb(page, buildCompletedSession({
        pokemonIds: SEED_POKEMON_IDS,
        evolutionCardIds: EVOLUTION_CARD_IDS,
      }));
      await page.goto("/");
      await awaitSeedIdb(page);

      await expect(page.getByText("All caught up!")).toBeVisible();

      // Enter the game before checking in-viewport behaviour
      await enterGame(page);

      const gameRegion = page.getByRole("region", {
        name: /higher or lower mini-game/i,
      });

      // Click the first Pokémon tile - the outcome (correct, tie, or wrong) does
      // not matter; all three result states show an action button.
      await gameRegion.getByRole("button").first().click();

      // The action button ("Next pair" or "Play again") must be visible in the
      // viewport - not merely present in the DOM - so the user can reach it
      // without manual scrolling on a mobile viewport (#1837/#1882).
      const actionButton = page.getByRole("button", { name: /next pair|play again/i });
      await expect(actionButton).toBeInViewport();

      // The button must also be clickable (enabled, not obstructed). Clicking it
      // transitions back to the picking phase (sprite decode pending -> button
      // shows "Next pair" or re-renders the game).
      await expect(actionButton).toBeEnabled();
      await actionButton.click();

      // After clicking the action button the result banner should disappear.
      await expect(page.getByText(/correct!|equal, both count\.|game over/i)).not.toBeVisible({
        timeout: 5000,
      });
    }
  });

  test("returns to the summary from the game (reversible)", async ({ page }) => {
    // Acceptance criterion: the collapse is reversible - there is a way back
    // to the full summary from the game (#1882).
    await seedSessionIdb(page, buildCompletedSession({
      pokemonIds: SEED_POKEMON_IDS,
      evolutionCardIds: EVOLUTION_CARD_IDS,
    }));
    await page.goto("/");
    await awaitSeedIdb(page);

    await expect(page.getByText("All caught up!")).toBeVisible();

    // Enter the game - summary collapses to the highlights bar
    await enterGame(page);
    await expect(
      page.getByRole("region", { name: /higher or lower mini-game/i }),
    ).toBeVisible();

    // Use the back control to return to the full summary
    await page.getByRole("button", { name: /back to session summary/i }).click();

    // Full summary is restored: "All caught up!" and the entry button reappear
    await expect(page.getByText("All caught up!")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /play higher or lower/i }),
    ).toBeVisible();

    // The game region is no longer visible
    await expect(
      page.getByRole("region", { name: /higher or lower mini-game/i }),
    ).not.toBeVisible();
  });

  test("nav links remain interactive on the all-caught-up screen (#1275)", async ({ page }) => {
    // Regression test: the bottom tab bar and header nav links were
    // unresponsive on the all-caught-up screen, because the end-of-session
    // container lacked flex-1/overflow-y-auto and caused the body to scroll.
    // Exercises both the summary view and the game view, since the game uses
    // overflow-hidden (the same container model that caused the original bug).
    await seedSessionIdb(page, buildCompletedSession({
      pokemonIds: SEED_POKEMON_IDS,
      evolutionCardIds: EVOLUTION_CARD_IDS,
    }));
    await page.goto("/");
    await awaitSeedIdb(page);

    await expect(page.getByText("All caught up!")).toBeVisible();

    // --- Summary view: nav must be accessible before entering the game ---
    await expect(
      page.getByRole("button", { name: /play higher or lower/i }),
    ).toBeVisible();

    const statsLink = page.getByRole("navigation").getByRole("link", { name: "Stats" }).first();
    await statsLink.click();
    await expect(page).toHaveURL("/stats");

    // --- Game view: nav must also be accessible after entering the game ---
    // Navigate back and enter the game view to verify the overflow-hidden
    // container does not block the nav links.
    await page.goBack();
    await expect(page.getByText("All caught up!")).toBeVisible();
    await enterGame(page);

    const statsLinkInGame = page.getByRole("navigation").getByRole("link", { name: "Stats" }).first();
    await statsLinkInGame.click();
    await expect(page).toHaveURL("/stats");
  });
});
