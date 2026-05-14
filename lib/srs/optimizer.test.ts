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

  it("counts only entries with a subjectKey", () => {
    const entries: GradeLogEntry[] = [
      makeEntry(1000, 4, "1"),
      makeEntry(2000, 4),         // no subjectKey — not counted
      makeEntry(3000, 5, "2"),
    ];
    expect(countOptimizableReviews(entries)).toBe(2);
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

  it("produces separate items for separate cards", () => {
    const DAY = 86_400_000;
    const t = Date.UTC(2026, 0, 1, 12, 0, 0);

    const entries: GradeLogEntry[] = [
      makeEntry(t, 4, "1"),
      makeEntry(t + DAY, 5, "2"),
      makeEntry(t + 2 * DAY, 1, "1"),
    ];

    const items = gradeLogToOptimizerItems(entries);
    expect(items).toHaveLength(2);
    // Card 1 has 2 reviews, card 2 has 1.
    const lengths = items.map((i) => i.reviews.length).sort();
    expect(lengths).toEqual([1, 2]);
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
    // 1.5 days later — rounds to 2
    const t1 = t0 + 1.5 * 86_400_000;

    const entries: GradeLogEntry[] = [
      makeEntry(t0, 4, "99"),
      makeEntry(t1, 4, "99"),
    ];

    const items = gradeLogToOptimizerItems(entries);
    expect(items[0].reviews[1].deltaT).toBe(2);
  });
});
