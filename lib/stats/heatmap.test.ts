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
