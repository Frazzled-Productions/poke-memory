import { describe, it, expect } from "vitest";
import {
  gradeLogToOptimizerItems,
  countOptimizableReviews,
  MIN_REVIEWS_FOR_OPTIMIZATION,
} from "./optimizer";
import type { GradeLogEntry } from "@/lib/gradelog/persistence";

function makeEntry(
  occurredAt: number,
  grade: GradeLogEntry["grade"],
  subjectKey?: string,
): GradeLogEntry {
  return {
    occurredAt,
    date: new Date(occurredAt).toISOString().slice(0, 10),
    grade,
    cardType: "name",
    ...(subjectKey !== undefined ? { subjectKey } : {}),
  };
}

describe("MIN_REVIEWS_FOR_OPTIMIZATION", () => {
  it("is 200", () => {
    expect(MIN_REVIEWS_FOR_OPTIMIZATION).toBe(200);
  });
});

describe("countOptimizableReviews", () => {
  it("returns 0 for empty input", () => {
    expect(countOptimizableReviews([])).toBe(0);
  });

  it("counts only entries belonging to fittable cards (ignores entries without subjectKey and single-review cards)", () => {
    // Cards "1" and "2" each have a single review - they are not fittable and
    // must not be counted. The entry without a subjectKey is also excluded.
    const entries: GradeLogEntry[] = [
      makeEntry(1000, 4, "1"),
      makeEntry(2000, 4),         // no subjectKey - not counted
      makeEntry(3000, 5, "2"),
    ];
    expect(countOptimizableReviews(entries)).toBe(0);
  });

  it("returns 0 when no entries have a subjectKey", () => {
    const entries = [makeEntry(1000, 4), makeEntry(2000, 1)];
    expect(countOptimizableReviews(entries)).toBe(0);
  });
});

describe("gradeLogToOptimizerItems", () => {
  it("returns empty array for empty input", () => {
    expect(gradeLogToOptimizerItems([])).toEqual([]);
  });

  it("drops entries without a subjectKey", () => {
    const entries: GradeLogEntry[] = [
      makeEntry(1000, 4),         // no subjectKey
      makeEntry(2000, 5),         // no subjectKey
    ];
    expect(gradeLogToOptimizerItems(entries)).toEqual([]);
  });

  it("produces one item with three reviews for a single card", () => {
    // Three reviews on different days. Timestamps are exactly 1 day apart.
    const DAY = 86_400_000;
    const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);     // 2026-01-01
    const t1 = t0 + DAY;                             // 2026-01-02
    const t2 = t1 + 2 * DAY;                         // 2026-01-04

    const entries: GradeLogEntry[] = [
      makeEntry(t0, 4, "42"),
      makeEntry(t1, 5, "42"),
      makeEntry(t2, 1, "42"),
    ];

    const items = gradeLogToOptimizerItems(entries);
    expect(items).toHaveLength(1);
    const reviews = items[0].reviews;
    expect(reviews).toHaveLength(3);

    // First review: deltaT must be 0.
    expect(reviews[0].deltaT).toBe(0);

    // Second review: 1 day later.
    expect(reviews[1].deltaT).toBe(1);

    // Third review: 2 days after the second.
    expect(reviews[2].deltaT).toBe(2);
  });

  it("maps grades 1/2/4/5 to FSRS ratings 1/2/3/4", () => {
    const DAY = 86_400_000;
    const t = Date.UTC(2026, 0, 1, 12, 0, 0);

    const entries: GradeLogEntry[] = [
      makeEntry(t,           1, "10"),
      makeEntry(t + DAY,     2, "10"),
      makeEntry(t + 2 * DAY, 4, "10"),
      makeEntry(t + 3 * DAY, 5, "10"),
    ];

    const items = gradeLogToOptimizerItems(entries);
    const ratings = items[0].reviews.map((r) => r.rating);
    expect(ratings).toEqual([1, 2, 3, 4]);
  });

  it("produces separate items for separate fittable cards, dropping single-review cards", () => {
    const DAY = 86_400_000;
    const t = Date.UTC(2026, 0, 1, 12, 0, 0);

    const entries: GradeLogEntry[] = [
      makeEntry(t, 4, "1"),
      makeEntry(t + DAY, 5, "2"),
      makeEntry(t + 2 * DAY, 1, "1"),
    ];

    const items = gradeLogToOptimizerItems(entries);
    // Card 1 has 2 reviews (fittable). Card 2 has only 1 review and is dropped.
    expect(items).toHaveLength(1);
    expect(items[0].reviews).toHaveLength(2);
  });

  it("sorts entries within a card by occurredAt regardless of input order", () => {
    const DAY = 86_400_000;
    const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);
    const t1 = t0 + DAY;

    // Provide entries in reverse chronological order.
    const entries: GradeLogEntry[] = [
      makeEntry(t1, 5, "7"),
      makeEntry(t0, 4, "7"),
    ];

    const items = gradeLogToOptimizerItems(entries);
    expect(items[0].reviews[0].deltaT).toBe(0);
    expect(items[0].reviews[1].deltaT).toBe(1);
  });

  it("computes deltaT in whole days using Math.round", () => {
    const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);
    // 1.5 days later - rounds to 2
    const t1 = t0 + 1.5 * 86_400_000;

    const entries: GradeLogEntry[] = [
      makeEntry(t0, 4, "99"),
      makeEntry(t1, 4, "99"),
    ];

    const items = gradeLogToOptimizerItems(entries);
    expect(items[0].reviews[1].deltaT).toBe(2);
  });

  it("groups same subjectKey in different locales as separate items (#1259)", () => {
    // Two entries for the same subject key but different locales - they must
    // not be merged into a single FSRS card history.
    const DAY = 86_400_000;
    const t = Date.UTC(2026, 0, 1, 12, 0, 0);
    const entries: GradeLogEntry[] = [
      makeEntry(t, 4, "1"),             // locale absent → defaults to "en"
      makeEntry(t + DAY, 5, "1"),       // locale absent → "en"
      { ...makeEntry(t, 4, "1"), locale: "ja" as const },   // "ja" group
    ];
    const items = gradeLogToOptimizerItems(entries);
    // "en" (2 reviews) and "ja" (1 review) → only "en" is fittable; "ja"
    // has a single review (deltaT = 0 only) and must be dropped (#1304).
    expect(items).toHaveLength(1);
    expect(items[0].reviews).toHaveLength(2);
  });

  // --- #1304 regression tests ---

  it("drops a card with only one review - the binding requires delta_t > 0 (#1304)", () => {
    // This is the exact scenario that caused a Rust WASI process-level panic
    // and an unrecoverable 500 at /api/srs/optimize.
    const t = Date.UTC(2026, 0, 1, 12, 0, 0);
    const entries: GradeLogEntry[] = [makeEntry(t, 4, "42")];
    const items = gradeLogToOptimizerItems(entries);
    expect(items).toHaveLength(0);
  });

  it("keeps a card with two reviews on distinct days alongside single-review cards (#1304)", () => {
    // 200+ fittable reviews plus any single-review card must not crash.
    // This verifies the filter does not drop the fittable card.
    const DAY = 86_400_000;
    const t = Date.UTC(2026, 0, 1, 12, 0, 0);
    const entries: GradeLogEntry[] = [
      makeEntry(t, 4, "good-card"),
      makeEntry(t + DAY, 5, "good-card"),
      makeEntry(t, 1, "single-review-card"),   // should be dropped
    ];
    const items = gradeLogToOptimizerItems(entries);
    expect(items).toHaveLength(1);
    expect(items[0].reviews).toHaveLength(2);
    expect(items[0].reviews[0].deltaT).toBe(0);
    expect(items[0].reviews[1].deltaT).toBe(1);
  });
});

describe("countOptimizableReviews (#1304)", () => {
  it("returns 0 for empty input", () => {
    expect(countOptimizableReviews([])).toBe(0);
  });

  it("excludes entries without a subjectKey", () => {
    const entries: GradeLogEntry[] = [
      makeEntry(1000, 4),   // no subjectKey
      makeEntry(2000, 4),   // no subjectKey
    ];
    expect(countOptimizableReviews(entries)).toBe(0);
  });

  it("excludes single-review cards - they are not fittable (#1304)", () => {
    // A single-review card must not count toward the 200-review threshold,
    // because it would be dropped by gradeLogToOptimizerItems.
    const t = Date.UTC(2026, 0, 1, 12, 0, 0);
    const entries: GradeLogEntry[] = [makeEntry(t, 4, "only-once")];
    expect(countOptimizableReviews(entries)).toBe(0);
  });

  it("counts all reviews for cards with >= 2 reviews on distinct days (#1304)", () => {
    const DAY = 86_400_000;
    const t = Date.UTC(2026, 0, 1, 12, 0, 0);
    const entries: GradeLogEntry[] = [
      makeEntry(t, 4, "card-a"),
      makeEntry(t + DAY, 5, "card-a"),
      makeEntry(t + 2 * DAY, 1, "card-a"),
      makeEntry(t, 2, "single-review"),   // not fittable - excluded
    ];
    // card-a has 3 reviews and is fittable; single-review card is not
    expect(countOptimizableReviews(entries)).toBe(3);
  });

  it("reproduces the exact failing scenario: 200+ grades with a mix of fittable and single-review cards", () => {
    // Build 10 fittable cards (each with 22 reviews on distinct days) = 220
    // fittable reviews, plus 13 single-review cards. This mirrors the affected
    // user's grade-log shape from the issue.
    const DAY = 86_400_000;
    const baseT = Date.UTC(2026, 0, 1, 12, 0, 0);

    const entries: GradeLogEntry[] = [];

    // 10 cards × 22 reviews each = 220 fittable reviews
    for (let card = 0; card < 10; card++) {
      for (let rev = 0; rev < 22; rev++) {
        entries.push(makeEntry(baseT + rev * DAY, 4, `card-${card}`));
      }
    }

    // 13 single-review cards (the root cause of #1304)
    for (let card = 0; card < 13; card++) {
      entries.push(makeEntry(baseT, 4, `new-card-${card}`));
    }

    const fittableCount = countOptimizableReviews(entries);
    expect(fittableCount).toBe(220);   // single-review cards excluded

    const items = gradeLogToOptimizerItems(entries);
    expect(items).toHaveLength(10);    // 13 single-review items dropped
    // None of the items have a reviews array where every deltaT is 0 - that
    // would cause the Rust panic.
    for (const item of items) {
      expect(item.reviews.some((r) => r.deltaT > 0)).toBe(true);
    }
  });
});
