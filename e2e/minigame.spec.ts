import { test, expect } from "@playwright/test";

// Pre-seed a SESSION_COMPLETE state.
//
// Strategy: ReviewSession calls hydrateSession(saved, SEED_POKEMON, ...) on
// load, which appends any SEED_POKEMON or SEED_EVOLUTION_CARDS entries missing
// from the saved session. To prevent those from queuing as new cards (which
// would show a Reveal button), we pre-seed ALL known card IDs as already
// reviewed (lastReview non-null, dueDate far in the future). This makes every
// card ineligible for both the review queue and the new queue, landing the
// component in SESSION_COMPLETE.
//
// - Name cards: IDs 1–1025 (full SEED_POKEMON range from generated.json).
// - Evolution cards: IDs 1500001–1500484 (SEED_EVOLUTION_CARDS range).
//
// Two name cards (Bulbasaur id=1 and Charmander id=4) have firstSeen set so
// that getSeenPokemon returns length >= 2 and HigherOrLowerGame renders.
//
// The persistence validator requires `name` and `spriteUrl` for non-evolution
// cards, so both are included. Evolution cards need `postEvoId` to pass
// validation (see isReviewCardShaped in lib/review/persistence.ts).
function seedCompletedSession() {
  const SEEN_IDS = new Set([1, 4]);
  const PAST_DATE = "2026-01-01";
  const FUTURE_DATE = "2099-12-31";

  const reviewedState = {
    stability: 10,
    difficulty: 5,
    elapsedDays: 10,
    scheduledDays: 21,
    reps: 3,
    lapses: 0,
    fsrsState: "review",
    dueDate: FUTURE_DATE,
    lastReview: PAST_DATE,
    firstSeen: null as string | null,
    learningStep: null,
    stepStartedAt: null,
  };

  const cards: object[] = [];

  // Name cards (1–1025)
  for (let id = 1; id <= 1025; id++) {
    cards.push({
      id,
      name: "pokemon-" + id,
      spriteUrl: "/sprites/pokemon/" + id + ".png",
      cardType: "name",
      state: {
        ...reviewedState,
        firstSeen: SEEN_IDS.has(id) ? PAST_DATE : null,
      },
    });
  }

  // Evolution edge cards (1500001–1500484)
  for (let id = 1500001; id <= 1500484; id++) {
    cards.push({
      id,
      // Minimal shape that passes isReviewCardShaped — validator checks postEvoId
      cardType: "evolution",
      preEvoId: 1,
      postEvoId: 2,
      preEvoName: "bulbasaur",
      postEvoName: "ivysaur",
      preEvoSpriteUrl: "/sprites/pokemon/1.png",
      postEvoSpriteUrl: "/sprites/pokemon/2.png",
      triggerPhrase: "at level 16",
      state: { ...reviewedState },
    });
  }

  const session = {
    cards,
    limits: {
      name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
      reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    },
  };

  localStorage.setItem(
    "poke-memory:review-session:v1",
    JSON.stringify(session),
  );
}

// Pre-seed a NEW_CARDS_LOCKED state for the `name` card type:
//   - IDs 1..10 are "introduced today" (firstSeen === today, lastReview === today,
//     dueDate far future) so name.newIntroducedToday === maxNewPerDay (10).
//   - ID 1025 is a fresh new card (lastReview === null) so hasMoreNewCardsOf(name)
//     is true → the new-cards wall fires.
//   - IDs 11..1024 are already-reviewed, not-due-today (no contribution to either
//     counter) so they don't accidentally trigger the review soft-wall.
//   - Evolution cards are seeded as the existing helper does — already reviewed,
//     not due — so no evolution-type queues populate.
//
// Default settings have reverseCardsEnabled === false and cryCardsEnabled ===
// false, so we don't need to seed those types.
function seedNewCardsLockedSession() {
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

  for (let id = 1; id <= 1024; id++) {
    const introducedToday = id <= 10;
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

  // Fresh new card — satisfies hasMoreNewCardsOf("name") so the wall fires.
  cards.push({
    id: 1025,
    name: "pokemon-1025",
    spriteUrl: "/sprites/pokemon/1025.png",
    cardType: "name",
    state: {
      ...baseState,
      dueDate: TODAY,
      lastReview: null,
      firstSeen: null,
    },
  });

  for (let id = 1500001; id <= 1500484; id++) {
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

  const session = {
    cards,
    limits: {
      name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
      reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    },
  };

  localStorage.setItem(
    "poke-memory:review-session:v1",
    JSON.stringify(session),
  );
}

test.describe("Higher-or-Lower mini-game", () => {
  test("mini-game section appears on SESSION_COMPLETE", async ({ page }) => {
    await page.addInitScript(seedCompletedSession);
    await page.goto("/");

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
    await page.addInitScript(seedCompletedSession);
    await page.goto("/");

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
    await page.addInitScript(seedNewCardsLockedSession);
    await page.goto("/");

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
