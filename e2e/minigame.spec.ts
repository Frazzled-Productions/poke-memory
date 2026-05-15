import { test, expect } from "@playwright/test";
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";
import {
  SEED_POKEMON_IDS,
  EVOLUTION_CARD_IDS,
  buildCompletedSession,
} from "./helpers/completedSession";

// ---------------------------------------------------------------------------
// Pre-seed a NEW_CARDS_LOCKED state for the `name` card type:
//   - The first 10 IDs in pokemonIds are "introduced today" (firstSeen ===
//     today, lastReview === today, dueDate far future) so
//     name.newIntroducedToday === maxNewPerDay (10).
//   - The last ID in pokemonIds is a fresh new card (lastReview === null) so
//     hasMoreNewCardsOf(name) is true → the new-cards wall fires.
//   - All other IDs are already-reviewed, not-due-today (no contribution to
//     either counter) so they don't accidentally trigger the review soft-wall.
//   - Evolution cards are seeded as reviewed, not-due — no evo queues populate.
//
// Default settings have reverseCardsEnabled === false and cryCardsEnabled ===
// false, so we don't need to seed those types.
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

  // Last species ID: fresh new card — satisfies hasMoreNewCardsOf("name") so
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

test.describe("Higher-or-Lower mini-game", () => {
  test("mini-game section appears on SESSION_COMPLETE", async ({ page }) => {
    await seedSessionIdb(page, buildCompletedSession({
      pokemonIds: SEED_POKEMON_IDS,
      evolutionCardIds: EVOLUTION_CARD_IDS,
    }));
    await page.goto("/");
    await awaitSeedIdb(page);

    // Confirm the session-complete end-state is reached
    await expect(page.getByText("All caught up!")).toBeVisible();

    // The mini-game section is rendered as <section aria-label="Higher or Lower mini-game">
    const gameRegion = page.getByRole("region", {
      name: /higher or lower mini-game/i,
    });
    await expect(gameRegion).toBeVisible();

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

    const gameRegion = page.getByRole("region", {
      name: /higher or lower mini-game/i,
    });
    await expect(gameRegion).toBeVisible();

    // Click the first tile — any outcome (correct / tie / game over) is valid
    await gameRegion.getByRole("button").first().click();

    // Result banner appears after pick; regex covers all three outcome strings
    const resultBanner = page.getByText(
      /correct!|equal — both count\.|game over/i,
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

    const gameRegion = page.getByRole("region", {
      name: /higher or lower mini-game/i,
    });
    await expect(gameRegion).toBeVisible();
    await expect(page.getByText(/which has higher/i)).toBeVisible();
    await expect(gameRegion.getByRole("button")).toHaveCount(2);
  });
});
