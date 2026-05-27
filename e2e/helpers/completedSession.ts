import seedData from "../../lib/pokemon/generated.json";
import { REVERSE_ID_OFFSET } from "./mastery";

// ---------------------------------------------------------------------------
// Shared SESSION_COMPLETE seed builder.
//
// ReviewSession calls hydrateSession(saved, SEED_POKEMON, ...) on load, which
// appends any SEED_POKEMON, SEED_EVOLUTION_CARDS, or reverse-card entries
// missing from the saved session. Since #1234 reverse cards are always enabled
// (reverseEnabled is hardcoded true in ReviewSession.tsx), hydrateSession adds
// a reverse card for every species not already in savedIds. To prevent those
// from queuing as new cards (which would show a Reveal button instead of the
// complete screen), every known reverse card ID must be pre-seeded alongside
// the name and evolution cards.
// ---------------------------------------------------------------------------

const EDGE_ID_BASE = 1_500_000;
// REVERSE_ID_OFFSET imported from helpers/mastery.ts
const MAX_SPECIES_ID = 999_999; // alternate-form IDs (10001+) are above this

/**
 * All species IDs present in the seed data, including alternate forms.
 * Used to build name-card entries that exactly match SEED_POKEMON, so
 * hydrateSession finds them all in savedIds and adds no new cards.
 */
export const SEED_POKEMON_IDS: number[] = seedData.map(
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
export const EVOLUTION_CARD_IDS: number[] = (() => {
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

/**
 * Pre-seed a SESSION_COMPLETE state.
 *
 * Two name cards (Bulbasaur id=1 and Charmander id=4) have firstSeen set so
 * that getSeenPokemon returns length >= 2 and HigherOrLowerGame renders.
 *
 * The persistence validator requires `name` and `spriteUrl` for non-evolution
 * cards, so both are included. Evolution cards need `postEvoId` to pass
 * validation (see isReviewCardShaped in lib/review/persistence.ts).
 */
export function buildCompletedSession(args: {
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

  // Reverse cards — one per species ID (including alternate forms). Since #1234
  // reverse cards are always enabled: hydrateSession adds a reverse card for
  // every species whose REVERSE_ID_OFFSET + id is not already in savedIds. Seed
  // them all as future-due so none enter the new or review queue, which is the
  // necessary condition for SESSION_COMPLETE.
  for (const id of pokemonIds) {
    cards.push({
      id: REVERSE_ID_OFFSET + id,
      name: "pokemon-" + id,
      spriteUrl: "/sprites/pokemon/" + id + ".png",
      cardType: "reverse",
      pokemonId: id,
      speciesId: id,
      state: {
        ...reviewedState,
        firstSeen: SEEN_SPECIES_IDS.has(id) ? PAST_DATE : null,
      },
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

/**
 * Build a "nearly completed" session suitable for tests that need a fast
 * first render (Reveal button visible quickly) while still exercising a
 * particular scope or card-type filter.
 *
 * All cards are present (so hydrateSession adds nothing and skips the
 * first save), but a specified set of species IDs have their name and
 * reverse cards reset to "new" state (lastReview: null). Those cards will
 * appear in buildSessionQueues' newQueue on the first load.
 *
 * Callers must also seed the extra cards from `extraCards` (e.g. mastered
 * evolution edges needed for preset logic) — pass them and they will be
 * merged in, overriding any existing card with the same ID.
 */
export function buildActiveSession(args: {
  pokemonIds: number[];
  evolutionCardIds: number[];
  /** Species IDs (base Pokémon IDs, not REVERSE_ID_OFFSET+N) whose name and
   *  reverse cards should be in "new" state (lastReview: null). */
  newSpeciesIds: number[];
  /** Additional cards to merge in (e.g. mastered evolution edge cards).
   *  A card in this list with an ID that matches a generated card replaces
   *  the generated one. */
  extraCards?: object[];
}) {
  const { pokemonIds, evolutionCardIds, newSpeciesIds, extraCards = [] } = args;

  // Build the base completed session.
  const base = buildCompletedSession({ pokemonIds, evolutionCardIds });

  // The "new" state has no lastReview and no firstSeen, so buildSessionQueues
  // treats it as an unseen new candidate.
  const newState = {
    stability: 0,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    fsrsState: "new",
    dueDate: null,
    lastReview: null,
    firstSeen: null,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  };

  const newSet = new Set(newSpeciesIds);

  // Override name and reverse cards for the specified new species.
  const cards = base.cards.map((c: object) => {
    const card = c as { id: number; cardType: string; pokemonId?: number };
    if (card.cardType === "name" && newSet.has(card.id)) {
      return { ...card, state: { ...newState } };
    }
    if (card.cardType === "reverse") {
      // Reverse card ID = REVERSE_ID_OFFSET + speciesId. Derive speciesId.
      const speciesId = card.pokemonId ?? (card.id - REVERSE_ID_OFFSET);
      if (newSet.has(speciesId)) {
        return { ...card, state: { ...newState } };
      }
    }
    return c;
  });

  // Merge extra cards: replace any existing card with the same ID, then
  // append extras whose IDs were not already present.
  const extraById = new Map<number, object>();
  for (const ec of extraCards) {
    const typed = ec as { id: number };
    extraById.set(typed.id, ec);
  }
  const merged = cards
    .map((c: object) => {
      const typed = c as { id: number };
      return extraById.has(typed.id) ? extraById.get(typed.id)! : c;
    })
    .concat(
      extraCards.filter((ec) => {
        const typed = ec as { id: number };
        return !cards.some((c: object) => (c as { id: number }).id === typed.id);
      }),
    );

  return { ...base, cards: merged };
}
