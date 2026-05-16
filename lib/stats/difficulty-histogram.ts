import type { ReviewableCard } from "@/lib/review/session";

/**
 * One bucket of the FSRS difficulty histogram. FSRS difficulty runs 1-10
 * (higher = harder); buckets span one whole unit each, so there are nine
 * buckets covering [1,2), [2,3), ... [9,10]. The final bucket is closed on
 * the right so a card sitting exactly at difficulty 10 still has a home.
 */
export type DifficultyBucket = {
  /** Inclusive lower bound of the bucket (integer 1-9). */
  lower: number;
  /** Exclusive upper bound, except the last bucket which is inclusive. */
  upper: number;
  /** Short axis label, e.g. "1-2". */
  label: string;
  /** Number of introduced cards whose difficulty falls in this bucket. */
  count: number;
};

/** The nine fixed difficulty buckets, lowest first. */
const BUCKET_BOUNDS: readonly { lower: number; upper: number }[] = [
  { lower: 1, upper: 2 },
  { lower: 2, upper: 3 },
  { lower: 3, upper: 4 },
  { lower: 4, upper: 5 },
  { lower: 5, upper: 6 },
  { lower: 6, upper: 7 },
  { lower: 7, upper: 8 },
  { lower: 8, upper: 9 },
  { lower: 9, upper: 10 },
];

/**
 * A card is "introduced" once it has been graded at least once. `firstSeen`
 * is set on the first-ever grade and never cleared, so it is the canonical
 * introduced gate (matching `lib/stats/derive.ts`).
 */
function isIntroduced(card: ReviewableCard): boolean {
  return card.state.firstSeen !== null;
}

/**
 * Clamp a raw FSRS difficulty into a bucket index 0-8. FSRS difficulty is
 * meant to stay within 1-10, but we clamp defensively so an out-of-range
 * value from a future schema never lands outside the histogram.
 */
function bucketIndexFor(difficulty: number): number {
  if (!Number.isFinite(difficulty)) return 0;
  const idx = Math.floor(difficulty) - 1;
  if (idx < 0) return 0;
  if (idx > BUCKET_BOUNDS.length - 1) return BUCKET_BOUNDS.length - 1;
  return idx;
}

/**
 * Bucket introduced cards by FSRS `state.difficulty` into a fixed nine-bucket
 * histogram. Pure - no I/O.
 *
 * `forceAllMastered` mirrors the canonical superuser pattern in `derive.ts`:
 * when `true` the population is treated as empty (every bucket count is 0),
 * consistent with `computeStats` clearing the `struggling` list. A QA session
 * with `pretendAllMastered` on should not surface a real difficulty spread.
 */
export function computeDifficultyHistogram(
  cards: readonly ReviewableCard[],
  forceAllMastered = false,
): DifficultyBucket[] {
  const counts = new Array<number>(BUCKET_BOUNDS.length).fill(0);

  if (!forceAllMastered) {
    for (const card of cards) {
      if (!isIntroduced(card)) continue;
      counts[bucketIndexFor(card.state.difficulty)]++;
    }
  }

  return BUCKET_BOUNDS.map((bound, i) => ({
    lower: bound.lower,
    upper: bound.upper,
    label: `${bound.lower}-${bound.upper}`,
    count: counts[i],
  }));
}

/** Total introduced cards across every bucket. Handy for empty-state checks. */
export function totalHistogramCards(buckets: readonly DifficultyBucket[]): number {
  return buckets.reduce((sum, b) => sum + b.count, 0);
}

/**
 * Population mean difficulty across introduced cards, or `null` when there
 * are none. `forceAllMastered` short-circuits to `null` for the same reason
 * as the histogram itself.
 */
export function meanDifficulty(
  cards: readonly ReviewableCard[],
  forceAllMastered = false,
): number | null {
  if (forceAllMastered) return null;
  let total = 0;
  let count = 0;
  for (const card of cards) {
    if (!isIntroduced(card)) continue;
    total += card.state.difficulty;
    count++;
  }
  return count === 0 ? null : total / count;
}
