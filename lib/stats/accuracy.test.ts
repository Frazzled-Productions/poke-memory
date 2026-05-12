import { describe, it, expect } from "vitest";
import {
  computeAccuracySparkline,
  computeRollingAccuracy,
} from "./accuracy";
import type { GradeLog } from "@/lib/gradelog/persistence";

const TODAY = "2026-05-12";

function entry(date: string, grade: 1 | 2 | 4 | 5): GradeLog[number] {
  return { date, grade, cardType: "name", occurredAt: 0 };
}

describe("computeAccuracySparkline", () => {
  it("returns windowDays entries ending on today", () => {
    const points = computeAccuracySparkline([], TODAY, 30);
    expect(points).toHaveLength(30);
    expect(points[29].date).toBe(TODAY);
    expect(points[0].date).toBe("2026-04-13");
  });

  it("an empty log produces all-null accuracies", () => {
    const points = computeAccuracySparkline([], TODAY, 7);
    expect(points.every((p) => p.accuracy === null && p.total === 0)).toBe(true);
  });

  it("counts passes (4 / 5) and fails (1 / 2) per day", () => {
    const log: GradeLog = [
      entry("2026-05-12", 4),
      entry("2026-05-12", 5),
      entry("2026-05-12", 1),
      entry("2026-05-11", 2),
      entry("2026-05-11", 4),
    ];
    const points = computeAccuracySparkline(log, TODAY, 7);
    const today = points.find((p) => p.date === "2026-05-12")!;
    const yesterday = points.find((p) => p.date === "2026-05-11")!;
    expect(today.total).toBe(3);
    expect(today.passes).toBe(2);
    expect(today.accuracy).toBeCloseTo(2 / 3);
    expect(yesterday.total).toBe(2);
    expect(yesterday.passes).toBe(1);
    expect(yesterday.accuracy).toBe(0.5);
  });

  it("days outside the window are silently dropped", () => {
    const log: GradeLog = [
      entry("2026-04-01", 4), // way before the window
      entry(TODAY, 4),
    ];
    const points = computeAccuracySparkline(log, TODAY, 7);
    const totals = points.reduce((s, p) => s + p.total, 0);
    expect(totals).toBe(1);
  });
});

describe("computeRollingAccuracy", () => {
  it("returns null for an empty log", () => {
    expect(computeRollingAccuracy([], TODAY, 7)).toBeNull();
  });

  it("aggregates passes / total over the window — not per-day mean", () => {
    const log: GradeLog = [
      // Day A: 1 review, 1 pass → 100%
      entry("2026-05-12", 4),
      // Day B: 9 reviews, 0 passes
      ...Array.from({ length: 9 }, () => entry("2026-05-11", 1)),
    ];
    // Mean of per-day accuracies = 50%. Aggregate is 1 / 10 = 10%.
    expect(computeRollingAccuracy(log, TODAY, 7)).toBeCloseTo(0.1);
  });

  it("respects the window boundary inclusively", () => {
    const log: GradeLog = [
      entry("2026-05-06", 4), // 6 days before today — inside a 7-day window
      entry("2026-05-05", 1), // 7 days before — outside
    ];
    expect(computeRollingAccuracy(log, TODAY, 7)).toBe(1);
  });
});
