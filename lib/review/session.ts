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

export type PerTypeLimits = {
  maxNewPerDay: number;
  maxReviewsPerDay: number;
};

export type CardTypeKey = "name" | "evolution";

export type DailyLimits = {
  name: PerTypeLimits;
  evolution: PerTypeLimits;
};

export const DEFAULT_LIMITS: DailyLimits = {
  name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
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

// Merge saved cards with the current seed, refreshing seed fields (e.g. newly
// added flavorTexts) on existing cards while preserving their SM-2 state.
// Missing seed entries are appended at initialReviewState — due immediately.
export function hydrateSession(
  saved: readonly ReviewableCard[],
  seed: readonly SeedPokemon[],
  evoSeed: readonly EvolutionCard[] = SEED_EVOLUTION_CARDS,
  now: Date = new Date(),
): ReviewableCard[] {
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

export type PerTypeCounters = {
  newIntroducedToday: number;
  reviewsDoneToday: number;
};

/**
 * Computes all queues and today's counters from the full card set + limits.
 *
 * Counters and caps are tracked per cardType — name and evolution cards each
 * have their own daily new / review budget. The returned `reviewQueue` and
 * `newQueue` are merged across types (after each type's cap is applied
 * independently) so the consumer can keep its single-cursor ordering policy.
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
  };

  const reviewCandidatesByType: Record<CardTypeKey, number[]> = { name: [], evolution: [] };
  const newCandidatesByType: Record<CardTypeKey, number[]> = { name: [], evolution: [] };

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

  for (const type of ["name", "evolution"] as const) {
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

  // Reshuffle the merged per-type slices so name and evolution interleave
  // deterministically rather than appearing in two contiguous blocks.
  const shuffledReviewQueue = stableShuffleForDay(reviewQueue, today);
  const shuffledNewQueue = stableShuffleForDay(newQueue, today);

  const newIntroducedToday =
    perType.name.newIntroducedToday + perType.evolution.newIntroducedToday;
  const reviewsDoneToday =
    perType.name.reviewsDoneToday + perType.evolution.reviewsDoneToday;

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
