import { test, expect } from "@playwright/test";
import { seedSessionIdb } from "./helpers/seedIdb";
import seedData from "../lib/pokemon/generated.json";

// ---------------------------------------------------------------------------
// Seed metadata — derived once at module load from the actual generated.json
// so these tests survive the seed re-run that adds ~150 alternate-form entries.
// ---------------------------------------------------------------------------

const EDGE_ID_BASE = 1_500_000;
const REVERSE_ID_OFFSET = 2_000_000;
const MAX_SPECIES_ID = 999_999; // alternate-form IDs (10001+) are above this

/**
 * All species IDs present in the seed data, including alternate forms.
 * Used to build name-card entries that exactly match SEED_POKEMON, so
 * hydrateSession finds them all in savedIds and adds no new cards.
 */
const SEED_POKEMON_IDS: number[] = seedData.map(
  (p) => (p as unknown as { id: number }).id,
);

/**
 * Two seen IDs for getSeenPokemon (Bulbasaur=1, Charmander=4) so the
 * Higher-or-Lower mini-game has enough entries to render its tiles.
 */
const SEEN_SPECIES_IDS = new Set([1, 4]);

/**
 * Compute the evolution edge IDs matching SEED_EVOLUTION_CARDS in
 * lib/pokemon/seed.ts. Rules (mirror seed.ts exactly):
 *   - Skip alternate-form pokemon (id > MAX_SPECIES_ID).
 *   - For each species, emit the edge only when node.evolvesFromId === pokemon.id
 *     (one edge per parent species, not one per chain member).
 *   - Use node.edgeId from the JSON (stable, assigned at seed time).
 *   - Deduplicate with a Set in case the seed has defensive duplicates.
 *   - Skip IDs outside [EDGE_ID_BASE+1, REVERSE_ID_OFFSET-1].
 */
const EVOLUTION_CARD_IDS: number[] = (() => {
  type ChainNode = { evolvesFromId: number | null; edgeId?: number };
  type SeedEntry = { id: number; evolutionChain?: ChainNode[] };

  const seen = new Set<number>();
  const ids: number[] = [];

  for (const rawPokemon of seedData) {
    const pokemon = rawPokemon as unknown as SeedEntry;
    if (pokemon.id > MAX_SPECIES_ID) continue; // skip alternate forms
    if (!pokemon.evolutionChain) continue;
    for (const node of pokemon.evolutionChain) {
      if (node.evolvesFromId !== pokemon.id) continue; // parent-only edge
      const edgeId = node.edgeId;
      if (typeof edgeId !== "number") continue;
      if (edgeId <= EDGE_ID_BASE || edgeId >= REVERSE_ID_OFFSET) continue;
      if (seen.has(edgeId)) continue;
      seen.add(edgeId);
      ids.push(edgeId);
    }
  }
  return ids;
})();

// ---------------------------------------------------------------------------
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
// Two name cards (Bulbasaur id=1 and Charmander id=4) have firstSeen set so
// that getSeenPokemon returns length >= 2 and HigherOrLowerGame renders.
//
// The persistence validator requires `name` and `spriteUrl` for non-evolution
// cards, so both are included. Evolution cards need `postEvoId` to pass
// validation (see isReviewCardShaped in lib/review/persistence.ts).
// ---------------------------------------------------------------------------

function buildCompletedSession(args: {
  pokemonIds: number[];
  evolutionCardIds: number[];
}) {
  const { pokemonIds, evolutionCardIds } = args;
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

  // Name cards — one per actual species ID in SEED_POKEMON (including
  // alternate forms with IDs like 10001+). Using the real IDs ensures
  // hydrateSession finds every card in savedIds and adds no new entries,
  // which is the necessary condition for SESSION_COMPLETE.
  for (const id of pokemonIds) {
    cards.push({
      id,
      name: "pokemon-" + id,
      spriteUrl: "/sprites/pokemon/" + id + ".png",
      cardType: "name",
      state: {
        ...reviewedState,
        firstSeen: SEEN_SPECIES_IDS.has(id) ? PAST_DATE : null,
      },
    });
  }

  // Evolution edge cards — use the deduplicated edgeIds from EVOLUTION_CARD_IDS
  // which mirrors SEED_EVOLUTION_CARDS exactly (parent-only, in-range, unique).
  for (const id of evolutionCardIds) {
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
