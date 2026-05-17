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
      { date: "2026-05-12", grade: 2, cardType: "reverse-evolution", occurredAt: 4 },
    ];
    const dist = computeGradeDistribution(log);
    expect(dist.again).toBe(1);
    expect(dist.hard).toBe(1);
    expect(dist.good).toBe(1);
    expect(dist.easy).toBe(1);
    expect(dist.total).toBe(4);
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
    // 2026-05-12 is a Tuesday — currentWeekStart = 2026-05-11 (Monday).
    // With weeks=4 the window covers 2026-04-13 through 2026-05-04 (inclusive);
    // the current in-progress week (2026-05-11) is excluded.
    const log: GradeLog = [
      entry(4, "2026-05-04"), // week starting 2026-05-04 (last slot)
      entry(1, "2026-05-06"), // same week (2026-05-04)
      entry(5, "2026-04-27"), // prior week (week starts 2026-04-27)
    ];
    const points = computeGradeTrend(log, "2026-05-12", 4);

    const lastWeek = points.find((p) => p.weekStart === "2026-05-04");
    expect(lastWeek).toBeDefined();
    expect(lastWeek!.good).toBe(1);
    expect(lastWeek!.again).toBe(1);
    expect(lastWeek!.total).toBe(2);

    const priorWeek = points.find((p) => p.weekStart === "2026-04-27");
    expect(priorWeek).toBeDefined();
    expect(priorWeek!.easy).toBe(1);
    expect(priorWeek!.total).toBe(1);
  });

  it("ignores entries outside the window", () => {
    // today = 2026-05-12 (Tue); currentWeekStart = 2026-05-11 (Mon).
    // 12-week window: 2026-02-16 (Mon) through 2026-05-04 (Mon, inclusive).
    // The current in-progress week (2026-05-11) is outside the window.
    // An entry from 2026-01-01 is also out of window.
    const log: GradeLog = [
      entry(4, "2026-01-01"),   // before window — dropped
      entry(4, "2026-05-12"),   // current week (excluded) — dropped
      entry(4, "2026-05-04"),   // last slot in window — counted
    ];
    const points = computeGradeTrend(log, "2026-05-12", 12);
    const total = points.reduce((s, p) => s + p.total, 0);
    // Only the 2026-05-04 entry should be counted.
    expect(total).toBe(1);
  });

  it("today on a Monday: the last slot is the previous week", () => {
    // 2026-05-11 is a Monday; currentWeekStart = 2026-05-11.
    // With weeks=2 the window covers 2026-04-27 and 2026-05-04 (current week
    // excluded). An entry on 2026-05-04 lands in the last slot.
    const log: GradeLog = [entry(5, "2026-05-04")];
    const points = computeGradeTrend(log, "2026-05-11", 2);
    const last = points[points.length - 1];
    expect(last.weekStart).toBe("2026-05-04");
    expect(last.easy).toBe(1);
  });

  it("total per point equals sum of the four grade buckets", () => {
    // Use 2026-05-04 — within the 4-week window for today=2026-05-12.
    const log: GradeLog = [
      entry(1, "2026-05-04"),
      entry(2, "2026-05-04"),
      entry(4, "2026-05-04"),
      entry(5, "2026-05-04"),
    ];
    const points = computeGradeTrend(log, "2026-05-12", 4);
    for (const p of points) {
      expect(p.total).toBe(p.again + p.hard + p.good + p.easy);
    }
  });
});
