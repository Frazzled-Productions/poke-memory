/**
 * Pure helpers for the FSRS per-user weight optimizer (#268).
 *
 * No React, no DOM - importable from both client and server contexts.
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
 * Group grade-log entries by (cardType, subjectKey, locale), sort each group
 * chronologically, compute deltaT in days between consecutive reviews
 * (first review deltaT = 0), and build the optimizer input items.
 *
 * Entries without a `subjectKey` are skipped - they are legacy entries from
 * before migration 013 and cannot be attributed to a specific card.
 *
 * Cards with only a single review are dropped: the native FSRS binding
 * requires at least one review with delta_t > 0 per item, and a card seen
 * only once has no such review. Passing a single-review item causes the Rust
 * WASI binary to panic at the process level (not a catchable JS exception),
 * which surfaces as an unrecoverable 500 at /api/srs/optimize.
 *
 * Returns one item per card with >= 2 reviews on distinct days.
 */
export function gradeLogToOptimizerItems(entries: GradeLogEntry[]): OptimizerInputItem[] {
  // Group by composite card key, skipping entries without subjectKey.
  const byCard = new Map<string, GradeLogEntry[]>();
  for (const entry of entries) {
    if (!entry.subjectKey) continue;
    // Include locale in the key so per-locale review histories are grouped
    // separately - mixing locales would produce nonsensical FSRS weight estimates.
    const key = `${entry.cardType}:${entry.subjectKey}:${entry.locale ?? "en"}`;
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

    // The binding requires at least one review with deltaT > 0. A card with
    // only one review has no such entry (its sole review has deltaT = 0).
    // Drop it rather than risk a process-level Rust panic.
    if (!reviews.some((r) => r.deltaT > 0)) continue;

    items.push({ reviews });
  }

  return items;
}

/**
 * Return true if a group of grade-log entries for a single card would produce
 * a fittable optimizer item (i.e. at least two entries that, when sorted
 * chronologically, yield at least one review with deltaT > 0).
 *
 * Used by `countFittableReviews` to mirror the filter in
 * `gradeLogToOptimizerItems` so the Settings-page eligibility count and the
 * server-side gate agree on what "optimisable" means.
 */
function isFittableGroup(cardEntries: GradeLogEntry[]): boolean {
  if (cardEntries.length < 2) return false;
  // Sort chronologically and check whether any consecutive pair is on a
  // distinct UTC day (i.e. would produce deltaT >= 1 after rounding).
  const sorted = [...cardEntries].sort((a, b) => a.occurredAt - b.occurredAt);
  for (let i = 1; i < sorted.length; i++) {
    const deltaT = Math.max(
      1,
      Math.round((sorted[i].occurredAt - sorted[i - 1].occurredAt) / 86_400_000),
    );
    if (deltaT > 0) return true;
  }
  return false;
}

/**
 * Count how many reviews belong to fittable cards - cards with at least two
 * reviews on distinct UTC days. This mirrors the filter applied in
 * `gradeLogToOptimizerItems`, so the eligibility count shown on the Settings
 * page and the server-side gate in `/api/srs/optimize` agree on what counts
 * as "optimisable". Single-review cards are excluded because the FSRS binding
 * requires at least one review with delta_t > 0 per item.
 */
export function countOptimizableReviews(entries: GradeLogEntry[]): number {
  // Group by composite card key (same logic as gradeLogToOptimizerItems).
  const byCard = new Map<string, GradeLogEntry[]>();
  for (const entry of entries) {
    if (!entry.subjectKey) continue;
    const key = `${entry.cardType}:${entry.subjectKey}:${entry.locale ?? "en"}`;
    const list = byCard.get(key);
    if (list === undefined) {
      byCard.set(key, [entry]);
    } else {
      list.push(entry);
    }
  }

  let count = 0;
  for (const [, cardEntries] of byCard) {
    if (isFittableGroup(cardEntries)) {
      count += cardEntries.length;
    }
  }
  return count;
}
