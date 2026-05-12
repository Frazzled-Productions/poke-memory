import type { ReviewState, Grade } from "@/lib/srs/scheduler";
import { initialReviewState } from "@/lib/srs/scheduler";
import type { SeedPokemon, EvolutionCard } from "@/lib/pokemon/seed";
import { SEED_EVOLUTION_CARDS, REVERSE_ID_OFFSET, CRY_ID_OFFSET } from "@/lib/pokemon/seed";
import { FNV_PRIME, FNV_OFFSET, fnv1a } from "@/lib/utils/fnv1a";

export type { Grade };

export type NameReviewCard = SeedPokemon & {
  cardType: "name";
  state: ReviewState;
};

export type EvolutionReviewCard = EvolutionCard & {
  state: ReviewState;
};

// Reverse card: name shown as prompt, sprite revealed on grade.
// id = REVERSE_ID_OFFSET + pokemon.id to keep namespaces disjoint.
// Spreads all SeedPokemon fields so facts (height, type, etc.) are available
// after reveal without a secondary lookup.
export type ReverseReviewCard = Omit<SeedPokemon, "id"> & {
  cardType: "reverse";
  id: number;        // REVERSE_ID_OFFSET + pokemonId
  pokemonId: number; // original species ID (same as SeedPokemon.id)
  state: ReviewState;
};

// Cry card: audio cry plays as prompt, sprite + name revealed on tap.
// id = CRY_ID_OFFSET + pokemon.id; only generated for species with a
// non-null cryUrl. Same field shape as ReverseReviewCard so existing
// helpers that handle "non-name id-aliased cards" generalise.
export type CryReviewCard = Omit<SeedPokemon, "id"> & {
  cardType: "cry";
  id: number;        // CRY_ID_OFFSET + pokemonId
  pokemonId: number;
  state: ReviewState;
};

export type ReviewableCard =
  | NameReviewCard
  | EvolutionReviewCard
  | ReverseReviewCard
  | CryReviewCard;

// Backward-compat alias
export type ReviewCard = ReviewableCard;

export type PerTypeLimits = {
  maxNewPerDay: number;
  maxReviewsPerDay: number;
};

export type CardTypeKey = "name" | "evolution" | "reverse" | "cry";

export type DailyLimits = {
  name: PerTypeLimits;
  evolution: PerTypeLimits;
  reverse: PerTypeLimits;
  cry: PerTypeLimits;
};

export const DEFAULT_LIMITS: DailyLimits = {
  name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
  reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
};

export function buildSession(
  seed: readonly SeedPokemon[],
  evoSeed: readonly EvolutionCard[] = SEED_EVOLUTION_CARDS,
  now: Date = new Date(),
  opts: {
    reverseEnabled?: boolean;
    nameEnabled?: boolean;
    evolutionEnabled?: boolean;
    cryEnabled?: boolean;
  } = {},
): ReviewableCard[] {
  const { nameEnabled = true, evolutionEnabled = true } = opts;
  const nameCards: NameReviewCard[] = nameEnabled
    ? seed.map((pokemon) => ({
        ...pokemon,
        cardType: "name",
        state: initialReviewState(now),
      }))
    : [];
  const evoCards: EvolutionReviewCard[] = evolutionEnabled
    ? evoSeed.map((evo) => ({
        ...evo,
        state: initialReviewState(now),
      }))
    : [];
  const reverseCards: ReverseReviewCard[] = opts.reverseEnabled
    ? seed.map((p) => ({
        ...p,
        id: REVERSE_ID_OFFSET + p.id,
        pokemonId: p.id,
        cardType: "reverse" as const,
        state: initialReviewState(now),
      }))
    : [];
  // Cry cards are only generated for species with a non-null cry — there
  // is no point scheduling a card that can never have a prompt to play.
  const cryCards: CryReviewCard[] = opts.cryEnabled
    ? seed
        .filter((p) => p.cryUrl !== null)
        .map((p) => ({
          ...p,
          id: CRY_ID_OFFSET + p.id,
          pokemonId: p.id,
          cardType: "cry" as const,
          state: initialReviewState(now),
        }))
    : [];
  return [...nameCards, ...evoCards, ...reverseCards, ...cryCards];
}

// Merge saved cards with the current seed, refreshing seed fields (e.g. newly
// added flavorTexts) on existing cards while preserving their SM-2 state.
// Missing seed entries are appended at initialReviewState — due immediately.
// When reverseEnabled is false, any persisted reverse cards are filtered out;
// re-enabling reverse cards starts fresh (no saved state carried over).
export function hydrateSession(
  saved: readonly ReviewableCard[],
  seed: readonly SeedPokemon[],
  evoSeed: readonly EvolutionCard[] = SEED_EVOLUTION_CARDS,
  now: Date = new Date(),
  opts: {
    reverseEnabled?: boolean;
    nameEnabled?: boolean;
    evolutionEnabled?: boolean;
    cryEnabled?: boolean;
  } = {},
): ReviewableCard[] {
  const {
    reverseEnabled = false,
    nameEnabled = true,
    evolutionEnabled = true,
    cryEnabled = false,
  } = opts;
  const seedById = new Map(seed.map((p) => [p.id, p]));
  const evoSeedById = new Map(evoSeed.map((e) => [e.id, e]));

  // When disabled, drop saved cards of that type so re-enabling starts fresh.
  let filteredSaved = reverseEnabled
    ? saved
    : saved.filter((c) => c.cardType !== "reverse");
  if (!cryEnabled) {
    filteredSaved = filteredSaved.filter((c) => c.cardType !== "cry");
  }
  if (!nameEnabled) {
    filteredSaved = filteredSaved.filter((c) => c.cardType !== "name");
  }
  if (!evolutionEnabled) {
    filteredSaved = filteredSaved.filter((c) => c.cardType !== "evolution");
  }

  const refreshed: ReviewableCard[] = filteredSaved.map((card) => {
    if (card.cardType === "evolution") {
      const fresh = evoSeedById.get(card.id);
      if (!fresh) return card;
      return { ...fresh, state: card.state };
    } else if (card.cardType === "reverse") {
      const fresh = seedById.get(card.pokemonId);
      if (!fresh) return card;
      return {
        ...fresh,
        id: card.id,
        pokemonId: fresh.id,
        cardType: "reverse" as const,
        state: card.state,
      };
    } else if (card.cardType === "cry") {
      const fresh = seedById.get(card.pokemonId);
      if (!fresh) return card;
      return {
        ...fresh,
        id: card.id,
        pokemonId: fresh.id,
        cardType: "cry" as const,
        state: card.state,
      };
    } else {
      const fresh = seedById.get(card.id);
      if (!fresh) return card;
      return { ...fresh, cardType: "name", state: card.state };
    }
  });

  const savedIds = new Set(filteredSaved.map((c) => c.id));

  const nameAdditions: NameReviewCard[] = nameEnabled
    ? seed
        .filter((p) => !savedIds.has(p.id))
        .map((p) => ({ ...p, cardType: "name", state: initialReviewState(now) }))
    : [];

  const evoAdditions: EvolutionReviewCard[] = evolutionEnabled
    ? evoSeed
        .filter((e) => !savedIds.has(e.id))
        .map((e) => ({ ...e, state: initialReviewState(now) }))
    : [];

  const reverseAdditions: ReverseReviewCard[] = reverseEnabled
    ? seed
        .filter((p) => !savedIds.has(REVERSE_ID_OFFSET + p.id))
        .map((p) => ({
          ...p,
          id: REVERSE_ID_OFFSET + p.id,
          pokemonId: p.id,
          cardType: "reverse" as const,
          state: initialReviewState(now),
        }))
    : [];

  const cryAdditions: CryReviewCard[] = cryEnabled
    ? seed
        .filter((p) => p.cryUrl !== null && !savedIds.has(CRY_ID_OFFSET + p.id))
        .map((p) => ({
          ...p,
          id: CRY_ID_OFFSET + p.id,
          pokemonId: p.id,
          cardType: "cry" as const,
          state: initialReviewState(now),
        }))
    : [];

  const additions = [...nameAdditions, ...evoAdditions, ...reverseAdditions, ...cryAdditions];
  if (additions.length === 0) return refreshed;
  return [...refreshed, ...additions];
}

export function todayString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function stableShuffleForDay(
  ids: readonly number[],
  today: string,
): number[] {
  const daySalt = fnv1a(today);

  const keyed = ids.map((id) => {
    let hash = FNV_OFFSET;
    hash ^= id & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    hash ^= (id >>> 8) & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    hash ^= (id >>> 16) & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    hash ^= (id >>> 24) & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    hash ^= daySalt & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    hash ^= (daySalt >>> 8) & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    hash ^= (daySalt >>> 16) & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    hash ^= (daySalt >>> 24) & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    return { id, key: hash };
  });

  keyed.sort((a, b) => a.key - b.key || a.id - b.id);
  return keyed.map((item) => item.id);
}

export type PerTypeCounters = {
  newIntroducedToday: number;
  reviewsDoneToday: number;
};

/**
 * Computes all queues and today's counters from the full card set + limits.
 *
 * Counters and caps are tracked per cardType — name, evolution, and reverse
 * cards each have their own daily new / review budget. The returned
 * `reviewQueue` and `newQueue` are merged across types (after each type's cap
 * is applied independently) so the consumer can keep its single-cursor
 * ordering policy.
 *
 * - learningCardIds: IDs of all cards currently in a learning/relearning step
 *   (learningStep !== null), regardless of cardType. The UI's in-memory queue
 *   reconstructs dueAt from stepStartedAt + stepDurationMs.
 * - reviewQueue: graduated cards due today or earlier, not already reviewed
 *   today, not in a learning step; each type capped independently at
 *   limits[type].maxReviewsPerDay - reviewsDoneToday[type].
 * - newQueue: never-reviewed cards not in a learning step; each type capped
 *   independently at limits[type].maxNewPerDay - newIntroducedToday[type].
 * - perType: live per-type counters for the lockout/end-state logic.
 * - newIntroducedToday / reviewsDoneToday: blended totals for the TodayPill
 *   display (sum across types).
 *
 * Pure — no I/O.
 */
export function buildSessionQueues(
  cards: readonly ReviewableCard[],
  limits: DailyLimits,
  today: string,
): {
  learningCardIds: number[];
  reviewQueue: number[];
  newQueue: number[];
  newIntroducedToday: number;
  reviewsDoneToday: number;
  perType: Record<CardTypeKey, PerTypeCounters>;
} {
  const learningCardIds = cards
    .filter((c) => c.state.learningStep !== null)
    .map((c) => c.id);

  const perType: Record<CardTypeKey, PerTypeCounters> = {
    name: { newIntroducedToday: 0, reviewsDoneToday: 0 },
    evolution: { newIntroducedToday: 0, reviewsDoneToday: 0 },
    reverse: { newIntroducedToday: 0, reviewsDoneToday: 0 },
    cry: { newIntroducedToday: 0, reviewsDoneToday: 0 },
  };

  const reviewCandidatesByType: Record<CardTypeKey, number[]> = { name: [], evolution: [], reverse: [], cry: [] };
  const newCandidatesByType: Record<CardTypeKey, number[]> = { name: [], evolution: [], reverse: [], cry: [] };

  for (const card of cards) {
    const type = card.cardType;
    if (card.state.firstSeen === today) {
      perType[type].newIntroducedToday += 1;
    }
    if (card.state.lastReview === today && card.state.firstSeen !== today) {
      perType[type].reviewsDoneToday += 1;
    }
    if (card.state.learningStep !== null) continue;
    if (
      card.state.lastReview !== null &&
      card.state.dueDate <= today &&
      card.state.lastReview !== today
    ) {
      reviewCandidatesByType[type].push(card.id);
    } else if (card.state.lastReview === null) {
      newCandidatesByType[type].push(card.id);
    }
  }

  const reviewQueue: number[] = [];
  const newQueue: number[] = [];

  for (const type of ["name", "evolution", "reverse", "cry"] as const) {
    const reviewSlots = Math.max(
      0,
      limits[type].maxReviewsPerDay - perType[type].reviewsDoneToday,
    );
    reviewQueue.push(
      ...stableShuffleForDay(reviewCandidatesByType[type], today).slice(0, reviewSlots),
    );
    const newSlots = Math.max(
      0,
      limits[type].maxNewPerDay - perType[type].newIntroducedToday,
    );
    newQueue.push(
      ...stableShuffleForDay(newCandidatesByType[type], today).slice(0, newSlots),
    );
  }

  // Reshuffle the merged per-type slices so name, evolution, and reverse
  // interleave deterministically rather than appearing in contiguous blocks.
  const shuffledReviewQueue = stableShuffleForDay(reviewQueue, today);
  const shuffledNewQueue = stableShuffleForDay(newQueue, today);

  const newIntroducedToday =
    perType.name.newIntroducedToday +
    perType.evolution.newIntroducedToday +
    perType.reverse.newIntroducedToday +
    perType.cry.newIntroducedToday;
  const reviewsDoneToday =
    perType.name.reviewsDoneToday +
    perType.evolution.reviewsDoneToday +
    perType.reverse.reviewsDoneToday +
    perType.cry.reviewsDoneToday;

  return {
    learningCardIds,
    reviewQueue: shuffledReviewQueue,
    newQueue: shuffledNewQueue,
    newIntroducedToday,
    reviewsDoneToday,
    perType,
  };
}

// Note: the component checks its in-memory learning queue before calling this.
// This function handles review/new ordering only; learning cards are
// shown first by the component layer.
export function getNextCardId(
  reviewQueue: readonly number[],
  newQueue: readonly number[],
): number | null {
  if (reviewQueue.length > 0) return reviewQueue[0];
  if (newQueue.length > 0) return newQueue[0];
  return null;
}

/**
 * Counts cards by Anki-style queue category.
 *
 * - newCount: never-reviewed cards not in a learning step
 * - learningCount: all cards currently in a learning/relearning step (both pending and due)
 * - reviewCount: graduated cards due today or earlier, not already reviewed today
 *
 * Pure — no I/O.
 */
export function buildQueueCounters(
  cards: readonly ReviewableCard[],
  today: string,
): { newCount: number; learningCount: number; reviewCount: number } {
  let newCount = 0;
  let learningCount = 0;
  let reviewCount = 0;

  for (const card of cards) {
    const s = card.state;
    if (s.learningStep !== null) {
      learningCount += 1;
    } else if (s.lastReview === null) {
      newCount += 1;
    } else if (s.dueDate <= today && s.lastReview !== today) {
      reviewCount += 1;
    }
  }

  return { newCount, learningCount, reviewCount };
}
