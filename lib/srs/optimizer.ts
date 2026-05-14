/**
 * Pure helpers for the FSRS per-user weight optimizer (#268).
 *
 * No React, no DOM — importable from both client and server contexts.
 * The native `@open-spaced-repetition/binding` module is intentionally NOT
 * imported here; it is imported only in the API route so the native binary
 * stays out of the client bundle.
 */

import type { GradeLogEntry } from "@/lib/gradelog/persistence";

export const MIN_REVIEWS_FOR_OPTIMIZATION = 200;
export const OPTIMIZER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * FSRS-native rating (1-4). Our internal grades are 1/2/4/5; the mapping at
 * the boundary converts: 1→1, 2→2, 4→3, 5→4.
 */
export type FsrsRating = 1 | 2 | 3 | 4;

/** A single review in the optimizer input shape. */
export type OptimizerInputReview = { rating: FsrsRating; deltaT: number };

/** All reviews for one card, in chronological order. */
export type OptimizerInputItem = { reviews: OptimizerInputReview[] };

// Map our internal grade values (1/2/4/5) to FSRS native rating (1/2/3/4).
function toFsrsRating(grade: GradeLogEntry["grade"]): FsrsRating {
  switch (grade) {
    case 1:
      return 1;
    case 2:
      return 2;
    case 4:
      return 3;
    case 5:
      return 4;
  }
}

/**
 * Group grade-log entries by (cardType, subjectKey), sort each group
 * chronologically, compute deltaT in days between consecutive reviews
 * (first review deltaT = 0), and build the optimizer input items.
 *
 * Entries without a `subjectKey` are skipped — they are legacy entries from
 * before migration 013 and cannot be attributed to a specific card.
 *
 * Returns one item per card with >= 1 review.
 */
export function gradeLogToOptimizerItems(entries: GradeLogEntry[]): OptimizerInputItem[] {
  // Group by composite card key, skipping entries without subjectKey.
  const byCard = new Map<string, GradeLogEntry[]>();
  for (const entry of entries) {
    if (!entry.subjectKey) continue;
    const key = `${entry.cardType}:${entry.subjectKey}`;
    const list = byCard.get(key);
    if (list === undefined) {
      byCard.set(key, [entry]);
    } else {
      list.push(entry);
    }
  }

  const items: OptimizerInputItem[] = [];

  for (const [, cardEntries] of byCard) {
    // Sort chronologically by occurredAt.
    cardEntries.sort((a, b) => a.occurredAt - b.occurredAt);

    const reviews: OptimizerInputReview[] = cardEntries.map((entry, idx) => {
      let deltaT: number;
      if (idx === 0) {
        // First review of a card must have deltaT = 0 per the binding spec.
        deltaT = 0;
      } else {
        // Non-first reviews must have deltaT >= 1. Same-session re-grades
        // (e.g. learning-step touches that all land within a day) would round
        // to 0 and trip the binding's "only the first review may be 0" rule.
        const prevMs = cardEntries[idx - 1].occurredAt;
        const currMs = entry.occurredAt;
        deltaT = Math.max(1, Math.round((currMs - prevMs) / 86_400_000));
      }
      return { rating: toFsrsRating(entry.grade), deltaT };
    });

    items.push({ reviews });
  }

  return items;
}

/**
 * Count how many entries have a `subjectKey` set (i.e. are eligible to be
 * fed to the optimizer). Used by the API route to gate on
 * `MIN_REVIEWS_FOR_OPTIMIZATION` before calling `computeParameters`.
 */
export function countOptimizableReviews(entries: GradeLogEntry[]): number {
  return entries.filter((e) => Boolean(e.subjectKey)).length;
}
