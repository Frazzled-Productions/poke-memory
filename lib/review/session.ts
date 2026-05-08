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
 * Computes all queues and today's counters from the full card set + limits.
 *
 * - learningCardIds: IDs of all cards currently in a learning or relearning
 *   step (learningStep !== null). These are managed entirely by the UI
 *   component's in-memory learning queue — the component pairs each ID with a
 *   wall-clock `dueAt` timestamp. On a fresh page load, all such cards are
 *   restarted at step 0 (component sets dueAt = Date.now() + steps[0]). The
 *   scheduler-side `learningStep` value is preserved across reloads.
 *   Learning cards are excluded from both reviewQueue and newQueue.
 * - reviewQueue: IDs of graduated cards due today or earlier,
 *   EXCLUDING any card whose lastReview === today (already done today)
 *   and EXCLUDING learning-step cards,
 *   capped at max(0, maxReviewsPerDay - reviewsDoneToday),
 *   then stableShuffleForDay'd.
 * - newQueue: IDs of brand-new cards (lastReview === null AND learningStep === null),
 *   capped at max(0, maxNewPerDay - newIntroducedToday),
 *   then stableShuffleForDay'd.
 * - newIntroducedToday: count of cards where firstSeen === today.
 * - reviewsDoneToday: count of cards where lastReview === today AND firstSeen !== today.
 *
 * Note: getNextCardId serves review/new ordering only. The component layers
 * learning-queue priority on top — learning cards are always shown before
 * review or new cards.
 *
 * Pure — no I/O.
 */
export function buildSessionQueues(
  cards: readonly ReviewCard[],
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

  // A card introduced today is counted only as "new" — even if it was lapsed
  // and re-graded the same day. The `firstSeen !== today` guard deliberately
  // excludes these from `reviewsDoneToday`; same-day re-views of a brand-new
  // card are still part of "introducing" it, not a return review.
  const reviewsDoneToday = cards.filter(
    (c) => c.state.lastReview === today && c.state.firstSeen !== today,
  ).length;

  // Learning queue: all cards currently in a learning or relearning step.
  // These are handled by the component's in-memory queue, not the SRS queues.
  const learningCardIds = cards
    .filter((c) => c.state.learningStep !== null)
    .map((c) => c.id);

  // Review candidates: has been reviewed before (graduated), due today or
  // earlier, not already reviewed today, and NOT in a learning step.
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

  // New candidates: never reviewed AND not currently in a learning step.
  // (A card in a learning step has lastReview === null but learningStep !== null —
  // it belongs in learningCardIds, not the newQueue.)
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

/**
 * Get next card to show from the review and new queues.
 * Drains reviewQueue first, then newQueue.
 * Returns null when both queues are empty.
 *
 * Note: the component layers learning-queue priority on top of this — it checks
 * the in-memory learning queue before calling getNextCardId. This function
 * handles only the review/new ordering.
 *
 * Pure.
 */
export function getNextCardId(
  reviewQueue: readonly number[],
  newQueue: readonly number[],
): number | null {
  if (reviewQueue.length > 0) return reviewQueue[0];
  if (newQueue.length > 0) return newQueue[0];
  return null;
}
