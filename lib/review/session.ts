import type { ReviewState, Grade } from "@/lib/srs/scheduler";
import { initialReviewState } from "@/lib/srs/scheduler";
import type { SeedPokemon } from "@/lib/pokemon/seed";

export type { Grade };

export type ReviewCard = SeedPokemon & {
  state: ReviewState;
};

export type DailyLimits = {
  maxNewPerDay: number;
  maxReviewsPerDay: number;
};

export const DEFAULT_LIMITS: DailyLimits = {
  maxNewPerDay: 10,
  maxReviewsPerDay: 100,
};

// Build a fresh session by initialising every seed card to default SM-2 state.
export function buildSession(seed: readonly SeedPokemon[]): ReviewCard[] {
  return seed.map((pokemon) => ({
    ...pokemon,
    state: initialReviewState(),
  }));
}

// Merge any seed cards not yet in the saved session (e.g. after a seed
// regeneration that added new species). Existing cards keep their progress;
// missing seed entries are appended at initialReviewState — due immediately.
export function hydrateSession(
  saved: readonly ReviewCard[],
  seed: readonly SeedPokemon[],
  now: Date = new Date(),
): ReviewCard[] {
  const savedIds = new Set(saved.map((card) => card.id));
  const additions = seed
    .filter((pokemon) => !savedIds.has(pokemon.id))
    .map((pokemon) => ({ ...pokemon, state: initialReviewState(now) }));
  if (additions.length === 0) return [...saved];
  return [...saved, ...additions];
}

// Return the card with the earliest dueDate that is <= today (ISO date string).
// If multiple cards share the earliest dueDate, return the one with the lowest id (stable tiebreak).
// Return undefined if no cards are currently due.
// @deprecated — use buildSessionQueues + getNextCardId instead.
export function getNextDueCard(
  cards: readonly ReviewCard[],
  now: Date,
): ReviewCard | undefined {
  const today = now.toISOString().slice(0, 10);

  const due = cards.filter((card) => card.state.dueDate <= today);

  if (due.length === 0) return undefined;

  return due.reduce((earliest, card) => {
    if (card.state.dueDate < earliest.state.dueDate) return card;
    if (card.state.dueDate === earliest.state.dueDate && card.id < earliest.id) return card;
    return earliest;
  });
}

/**
 * Today as YYYY-MM-DD. Pure helper.
 */
export function todayString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Stable per-day shuffle using a deterministic FNV-1a-inspired hash of
 * (id, today). Same (ids, today) → same output; different today → different
 * ordering. Pure — no Math.random.
 */
export function stableShuffleForDay(
  ids: readonly number[],
  today: string,
): number[] {
  // Derive a numeric salt from the date string by hashing its characters.
  // FNV-1a 32-bit: offset_basis=2166136261, prime=16777619
  const FNV_PRIME = 16777619;
  const FNV_OFFSET = 2166136261;

  function fnv1a(s: string): number {
    let hash = FNV_OFFSET;
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      // Keep within 32-bit unsigned range using >>> 0
      hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
    return hash;
  }

  const daySalt = fnv1a(today);

  // Assign each id a deterministic sort key derived from (id, daySalt).
  const keyed = ids.map((id) => {
    // Mix id and daySalt with another FNV-1a round.
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

/**
 * Computes both queues and today's counters from the full card set + limits.
 *
 * - reviewQueue: IDs of cards where lastReview !== null AND dueDate <= today,
 *   EXCLUDING any card whose lastReview === today (already done today),
 *   capped at max(0, maxReviewsPerDay - reviewsDoneToday),
 *   then stableShuffleForDay'd.
 * - newQueue: IDs of cards where lastReview === null,
 *   capped at max(0, maxNewPerDay - newIntroducedToday),
 *   then stableShuffleForDay'd.
 * - newIntroducedToday: count of cards where lastReview === today AND repetitions === 1.
 * - reviewsDoneToday: count of cards where lastReview === today AND repetitions > 1.
 *
 * Pure — no I/O.
 */
export function buildSessionQueues(
  cards: readonly ReviewCard[],
  limits: DailyLimits,
  today: string,
): {
  reviewQueue: number[];
  newQueue: number[];
  newIntroducedToday: number;
  reviewsDoneToday: number;
} {
  const newIntroducedToday = cards.filter(
    (c) => c.state.lastReview === today && c.state.repetitions === 1,
  ).length;

  const reviewsDoneToday = cards.filter(
    (c) => c.state.lastReview === today && c.state.repetitions > 1,
  ).length;

  // Review candidates: has been reviewed before, due today or earlier,
  // but NOT already reviewed today.
  const reviewCandidateIds = cards
    .filter(
      (c) =>
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

  // New candidates: never reviewed.
  const newCandidateIds = cards
    .filter((c) => c.state.lastReview === null)
    .map((c) => c.id);

  const newSlots = Math.max(0, limits.maxNewPerDay - newIntroducedToday);
  const newQueue = stableShuffleForDay(newCandidateIds, today).slice(
    0,
    newSlots,
  );

  return { reviewQueue, newQueue, newIntroducedToday, reviewsDoneToday };
}

/**
 * Get next card to show. Drains reviewQueue first by index, then newQueue.
 * Returns null when both cursors have run past their queue lengths.
 * Pure.
 */
export function getNextCardId(
  reviewQueue: readonly number[],
  newQueue: readonly number[],
  reviewCursor: number,
  newCursor: number,
): number | null {
  if (reviewCursor < reviewQueue.length) {
    return reviewQueue[reviewCursor];
  }
  if (newCursor < newQueue.length) {
    return newQueue[newCursor];
  }
  return null;
}
