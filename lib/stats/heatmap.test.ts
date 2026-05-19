import { describe, it, expect } from "vitest";
import { computeReviewHeatmap, intensityBucket } from "./heatmap";
import type { GradeLog } from "@/lib/gradelog/persistence";

const TODAY = "2026-05-12"; // Tuesday

function entry(date: string): GradeLog[number] {
  return { date, grade: 4, cardType: "name", occurredAt: 0 };
}

describe("computeReviewHeatmap", () => {
  it("returns 53 columns of 7 cells", () => {
    const columns = computeReviewHeatmap([], TODAY);
    expect(columns).toHaveLength(53);
    expect(columns.every((c) => c.length === 7)).toBe(true);
  });

  it("today's cell carries the correct count and falls on its weekday", () => {
    const log = [entry(TODAY), entry(TODAY), entry(TODAY)];
    const columns = computeReviewHeatmap(log, TODAY);
    // Find the cell whose date === today
    const todayCells = columns.flat().filter((c) => c.date === TODAY);
    expect(todayCells).toHaveLength(1);
    expect(todayCells[0].count).toBe(3);
  });

  it("dates outside the 53×7 window are dropped", () => {
    const log = [entry("2024-01-01"), entry(TODAY)];
    const columns = computeReviewHeatmap(log, TODAY);
    const totalCount = columns.flat().reduce((s, c) => s + c.count, 0);
    expect(totalCount).toBe(1);
  });

  it("empty log produces all-zero cells", () => {
    const columns = computeReviewHeatmap([], TODAY);
    expect(columns.flat().every((c) => c.count === 0)).toBe(true);
  });
});

describe("intensityBucket", () => {
  it("0 → 0", () => expect(intensityBucket(0)).toBe(0));
  it("1..9 → 1", () => {
    expect(intensityBucket(1)).toBe(1);
    expect(intensityBucket(9)).toBe(1);
  });
  it("10..49 → 2", () => {
    expect(intensityBucket(10)).toBe(2);
    expect(intensityBucket(49)).toBe(2);
  });
  it("50..99 → 3", () => {
    expect(intensityBucket(50)).toBe(3);
    expect(intensityBucket(99)).toBe(3);
  });
  it("100+ → 4", () => {
    expect(intensityBucket(100)).toBe(4);
    expect(intensityBucket(1000)).toBe(4);
  });
});

describe("computeReviewHeatmap — all grades on one day (high density)", () => {
  it("accumulates 50 reviews on the same date into a single cell with count 50", () => {
    // Scenario from issue #1019: all grades on one day should accumulate
    // correctly rather than being capped or deduplicated.
    const log = Array.from({ length: 50 }, () => entry(TODAY));
    const columns = computeReviewHeatmap(log, TODAY);
    const todayCell = columns.flat().find((c) => c.date === TODAY);
    expect(todayCell?.count).toBe(50);
    // The resulting density is in the mid bucket (50..99 → 3).
    expect(intensityBucket(todayCell!.count)).toBe(3);
  });

  it("accumulates 100 reviews on the same date — saturates at bucket 4", () => {
    const log = Array.from({ length: 100 }, () => entry(TODAY));
    const columns = computeReviewHeatmap(log, TODAY);
    const todayCell = columns.flat().find((c) => c.date === TODAY);
    expect(todayCell?.count).toBe(100);
    expect(intensityBucket(todayCell!.count)).toBe(4);
  });
});

describe("computeReviewHeatmap — weekStart=1 (Monday-start)", () => {
  it("still returns 53 columns of 7 cells when weekStart=1", () => {
    const columns = computeReviewHeatmap([], TODAY, 1);
    expect(columns).toHaveLength(53);
    expect(columns.every((c) => c.length === 7)).toBe(true);
  });

  it("today still appears exactly once in the grid when weekStart=1", () => {
    const log = [entry(TODAY)];
    const columns = computeReviewHeatmap(log, TODAY, 1);
    const todayCells = columns.flat().filter((c) => c.date === TODAY);
    expect(todayCells).toHaveLength(1);
    expect(todayCells[0].count).toBe(1);
  });
});
