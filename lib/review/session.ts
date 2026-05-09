import type { ReviewState, Grade } from "@/lib/srs/scheduler";
import { initialReviewState } from "@/lib/srs/scheduler";
import type { SeedPokemon, EvolutionCard } from "@/lib/pokemon/seed";
import { SEED_EVOLUTION_CARDS } from "@/lib/pokemon/seed";

export type { Grade };

export type NameReviewCard = SeedPokemon & {
  cardType: "name";
  state: ReviewState;
};

export type EvolutionReviewCard = EvolutionCard & {
  state: ReviewState;
};

export type ReviewableCard = NameReviewCard | EvolutionReviewCard;

// Backward-compat alias
export type ReviewCard = ReviewableCard;

export type DailyLimits = {
  maxNewPerDay: number;
  maxReviewsPerDay: number;
};

export const DEFAULT_LIMITS: DailyLimits = {
  maxNewPerDay: 10,
  maxReviewsPerDay: 100,
};

export function buildSession(
  seed: readonly SeedPokemon[],
  evoSeed: readonly EvolutionCard[] = SEED_EVOLUTION_CARDS,
  now: Date = new Date(),
): ReviewableCard[] {
  const nameCards: NameReviewCard[] = seed.map((pokemon) => ({
    ...pokemon,
    cardType: "name",
    state: initialReviewState(now),
  }));
  const evoCards: EvolutionReviewCard[] = evoSeed.map((evo) => ({
    ...evo,
    state: initialReviewState(now),
  }));
  return [...nameCards, ...evoCards];
}

export function hydrateSession(
  saved: readonly ReviewableCard[],
  seed: readonly SeedPokemon[],
  evoSeedOrNow?: readonly EvolutionCard[] | Date,
  now: Date = new Date(),
): ReviewableCard[] {
  let evoSeed: readonly EvolutionCard[];
  if (evoSeedOrNow instanceof Date) {
    now = evoSeedOrNow;
    evoSeed = SEED_EVOLUTION_CARDS;
  } else {
    evoSeed = evoSeedOrNow ?? SEED_EVOLUTION_CARDS;
  }

  const seedById = new Map(seed.map((p) => [p.id, p]));
  const evoSeedById = new Map(evoSeed.map((e) => [e.id, e]));

  const refreshed: ReviewableCard[] = saved.map((card) => {
    if (card.cardType === "evolution") {
      const fresh = evoSeedById.get(card.id);
      if (!fresh) return card;
      return { ...fresh, state: card.state };
    } else {
      const fresh = seedById.get(card.id);
      if (!fresh) return card;
      return { ...fresh, cardType: "name", state: card.state };
    }
  });

  const savedIds = new Set(saved.map((c) => c.id));

  const nameAdditions: NameReviewCard[] = seed
    .filter((p) => !savedIds.has(p.id))
    .map((p) => ({ ...p, cardType: "name", state: initialReviewState(now) }));

  const evoAdditions: EvolutionReviewCard[] = evoSeed
    .filter((e) => !savedIds.has(e.id))
    .map((e) => ({ ...e, state: initialReviewState(now) }));

  const additions = [...nameAdditions, ...evoAdditions];
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
  const FNV_PRIME = 16777619;
  const FNV_OFFSET = 2166136261;

  function fnv1a(s: string): number {
    let hash = FNV_OFFSET;
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
    return hash;
  }

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
} {
  const newIntroducedToday = cards.filter(
    (c) => c.state.firstSeen === today,
  ).length;

  const reviewsDoneToday = cards.filter(
    (c) => c.state.lastReview === today && c.state.firstSeen !== today,
  ).length;

  const learningCardIds = cards
    .filter((c) => c.state.learningStep !== null)
    .map((c) => c.id);

  const reviewCandidateIds = cards
    .filter(
      (c) =>
        c.state.learningStep === null &&
        c.state.lastReview !== null &&
        c.state.dueDate <= today &&
        c.state.lastReview !== today,
    )
    .map((c) => c.id);

  const reviewSlots = Math.max(0, limits.maxReviewsPerDay - reviewsDoneToday);
  const reviewQueue = stableShuffleForDay(reviewCandidateIds, today).slice(
    0,
    reviewSlots,
  );

  const newCandidateIds = cards
    .filter(
      (c) => c.state.learningStep === null && c.state.lastReview === null,
    )
    .map((c) => c.id);

  const newSlots = Math.max(0, limits.maxNewPerDay - newIntroducedToday);
  const newQueue = stableShuffleForDay(newCandidateIds, today).slice(
    0,
    newSlots,
  );

  return { learningCardIds, reviewQueue, newQueue, newIntroducedToday, reviewsDoneToday };
}

export function getNextCardId(
  reviewQueue: readonly number[],
  newQueue: readonly number[],
): number | null {
  if (reviewQueue.length > 0) return reviewQueue[0];
  if (newQueue.length > 0) return newQueue[0];
  return null;
}
