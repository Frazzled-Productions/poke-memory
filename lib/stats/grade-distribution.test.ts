import { describe, it, expect } from "vitest";
import {
  computeGradeDistribution,
  computeGradeTrend,
} from "./grade-distribution";
import type { GradeLog } from "@/lib/gradelog/persistence";

function entry(
  grade: 1 | 2 | 4 | 5,
  date = "2026-05-12",
): GradeLog[number] {
  return { date, grade, cardType: "name", occurredAt: 0 };
}

// ---------------------------------------------------------------------------
// computeGradeDistribution
// ---------------------------------------------------------------------------

describe("computeGradeDistribution", () => {
  it("returns all zeros for an empty log", () => {
    const dist = computeGradeDistribution([]);
    expect(dist).toEqual({ again: 0, hard: 0, good: 0, easy: 0, total: 0 });
  });

  it("correctly counts each grade bucket", () => {
    const log: GradeLog = [
      entry(1),
      entry(1),
      entry(2),
      entry(4),
      entry(4),
      entry(4),
      entry(5),
    ];
    const dist = computeGradeDistribution(log);
    expect(dist.again).toBe(2);
    expect(dist.hard).toBe(1);
    expect(dist.good).toBe(3);
    expect(dist.easy).toBe(1);
    expect(dist.total).toBe(7);
  });

  it("total equals the sum of the four buckets", () => {
    const log: GradeLog = [
      entry(1),
      entry(2),
      entry(4),
      entry(5),
    ];
    const dist = computeGradeDistribution(log);
    expect(dist.total).toBe(dist.again + dist.hard + dist.good + dist.easy);
  });

  it("works with only Again grades", () => {
    const log: GradeLog = [entry(1), entry(1)];
    const dist = computeGradeDistribution(log);
    expect(dist).toEqual({ again: 2, hard: 0, good: 0, easy: 0, total: 2 });
  });

  it("derives from log entries across all card types", () => {
    const log: GradeLog = [
      { date: "2026-05-12", grade: 4, cardType: "evolution", occurredAt: 1 },
      { date: "2026-05-12", grade: 1, cardType: "cry", occurredAt: 2 },
      { date: "2026-05-12", grade: 5, cardType: "reverse", occurredAt: 3 },
    ];
    const dist = computeGradeDistribution(log);
    expect(dist.again).toBe(1);
    expect(dist.good).toBe(1);
    expect(dist.easy).toBe(1);
    expect(dist.total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// computeGradeTrend
// ---------------------------------------------------------------------------

describe("computeGradeTrend", () => {
  it("returns the requested number of weeks", () => {
    const points = computeGradeTrend([], "2026-05-12", 12);
    expect(points).toHaveLength(12);
  });

  it("returns weeks in ascending weekStart order", () => {
    const points = computeGradeTrend([], "2026-05-12", 4);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].weekStart > points[i - 1].weekStart).toBe(true);
    }
  });

  it("all-zero totals for an empty log", () => {
    const points = computeGradeTrend([], "2026-05-12", 4);
    expect(points.every((p) => p.total === 0)).toBe(true);
  });

  it("buckets entries into the correct week", () => {
    // 2026-05-12 is a Tuesday — week starts 2026-05-11 (Monday).
    const log: GradeLog = [
      entry(4, "2026-05-11"), // this week
      entry(1, "2026-05-12"), // this week
      entry(5, "2026-05-04"), // prior week (week starts 2026-05-04)
    ];
    const points = computeGradeTrend(log, "2026-05-12", 4);

    const thisWeek = points.find((p) => p.weekStart === "2026-05-11");
    expect(thisWeek).toBeDefined();
    expect(thisWeek!.good).toBe(1);
    expect(thisWeek!.again).toBe(1);
    expect(thisWeek!.total).toBe(2);

    const priorWeek = points.find((p) => p.weekStart === "2026-05-04");
    expect(priorWeek).toBeDefined();
    expect(priorWeek!.easy).toBe(1);
    expect(priorWeek!.total).toBe(1);
  });

  it("ignores entries outside the window", () => {
    // 12 weeks back from 2026-05-12 (Mon) is 2026-02-16 (Mon).
    // An entry from 2026-01-01 is out of window.
    const log: GradeLog = [
      entry(4, "2026-01-01"),
      entry(4, "2026-05-12"),
    ];
    const points = computeGradeTrend(log, "2026-05-12", 12);
    const total = points.reduce((s, p) => s + p.total, 0);
    // Only the May entry should be counted.
    expect(total).toBe(1);
  });

  it("today on a Monday puts the entry in the current week", () => {
    // 2026-05-11 is a Monday.
    const log: GradeLog = [entry(5, "2026-05-11")];
    const points = computeGradeTrend(log, "2026-05-11", 2);
    const current = points[points.length - 1];
    expect(current.weekStart).toBe("2026-05-11");
    expect(current.easy).toBe(1);
  });

  it("total per point equals sum of the four grade buckets", () => {
    const log: GradeLog = [
      entry(1, "2026-05-12"),
      entry(2, "2026-05-12"),
      entry(4, "2026-05-12"),
      entry(5, "2026-05-12"),
    ];
    const points = computeGradeTrend(log, "2026-05-12", 4);
    for (const p of points) {
      expect(p.total).toBe(p.again + p.hard + p.good + p.easy);
    }
  });
});
