import { describe, it, expect } from "vitest";
import {
  computeActivityHistory,
  isActivityHistoryEmpty,
} from "./activity-history";
import type { GradeLog } from "@/lib/gradelog/persistence";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TODAY = "2026-05-17";

function entry(
  date: string,
  subjectKey?: string,
  grade: 1 | 2 | 4 | 5 = 4,
): GradeLog[number] {
  return {
    date,
    grade,
    cardType: "name",
    occurredAt: 0,
    ...(subjectKey !== undefined ? { subjectKey } : {}),
  };
}

// ---------------------------------------------------------------------------
// computeActivityHistory
// ---------------------------------------------------------------------------

describe("computeActivityHistory", () => {
  it("returns windowDays points for an empty log", () => {
    const result = computeActivityHistory([], TODAY, 7);
    expect(result).toHaveLength(7);
  });

  it("returns 365 points by default", () => {
    const result = computeActivityHistory([], TODAY);
    expect(result).toHaveLength(365);
  });

  it("all zeros for an empty log", () => {
    const result = computeActivityHistory([], TODAY, 7);
    expect(result.every((p) => p.reviews === 0 && p.introduced === 0)).toBe(
      true,
    );
  });

  it("oldest point is windowDays - 1 days before today", () => {
    const result = computeActivityHistory([], TODAY, 7);
    expect(result[0].date).toBe("2026-05-11");
    expect(result[result.length - 1].date).toBe(TODAY);
  });

  it("counts reviews for entries within the window", () => {
    const log: GradeLog = [
      entry(TODAY, "25"),
      entry(TODAY, "26"),
      entry("2026-05-16", "1"),
    ];
    const result = computeActivityHistory(log, TODAY, 7);
    const today = result.find((p) => p.date === TODAY)!;
    const yesterday = result.find((p) => p.date === "2026-05-16")!;
    expect(today.reviews).toBe(2);
    expect(yesterday.reviews).toBe(1);
  });

  it("ignores reviews outside the window", () => {
    const log: GradeLog = [
      entry("2026-01-01", "25"), // well outside a 7-day window
    ];
    const result = computeActivityHistory(log, TODAY, 7);
    expect(result.every((p) => p.reviews === 0)).toBe(true);
  });

  it("counts introductions for first-time subjectKey within window", () => {
    const log: GradeLog = [
      entry(TODAY, "25"),
      entry(TODAY, "25"), // same key - only one introduction
      entry(TODAY, "26"),
    ];
    const result = computeActivityHistory(log, TODAY, 7);
    const today = result.find((p) => p.date === TODAY)!;
    expect(today.introduced).toBe(2); // keys 25 and 26
    expect(today.reviews).toBe(3);
  });

  it("does not count a key as introduced if first seen before the window", () => {
    const log: GradeLog = [
      entry("2026-01-01", "25"), // before the window
      entry(TODAY, "25"),        // re-reviewed inside window - not an introduction
    ];
    const result = computeActivityHistory(log, TODAY, 7);
    const today = result.find((p) => p.date === TODAY)!;
    expect(today.introduced).toBe(0);
    expect(today.reviews).toBe(1); // still counted as a review
  });

  it("assigns introduction to the first-seen date within the window", () => {
    // Key 25 first seen on 2026-05-15, reviewed again on 2026-05-17.
    const log: GradeLog = [
      entry("2026-05-15", "25"),
      entry(TODAY, "25"),
    ];
    const result = computeActivityHistory(log, TODAY, 7);
    const intro = result.find((p) => p.date === "2026-05-15")!;
    const later = result.find((p) => p.date === TODAY)!;
    expect(intro.introduced).toBe(1);
    expect(later.introduced).toBe(0);
  });

  it("excludes entries without subjectKey from introduced count", () => {
    const log: GradeLog = [
      entry(TODAY, undefined), // legacy entry - no subjectKey
      entry(TODAY, undefined),
    ];
    const result = computeActivityHistory(log, TODAY, 7);
    const today = result.find((p) => p.date === TODAY)!;
    expect(today.introduced).toBe(0);
    expect(today.reviews).toBe(2); // still counted as reviews
  });

  it("handles multiple cards introduced on different days", () => {
    const log: GradeLog = [
      entry("2026-05-15", "1"),
      entry("2026-05-15", "2"),
      entry("2026-05-16", "3"),
      entry("2026-05-17", "4"),
      entry("2026-05-17", "1"), // re-review of key 1
    ];
    const result = computeActivityHistory(log, TODAY, 7);
    expect(result.find((p) => p.date === "2026-05-15")!.introduced).toBe(2);
    expect(result.find((p) => p.date === "2026-05-16")!.introduced).toBe(1);
    expect(result.find((p) => p.date === TODAY)!.introduced).toBe(1); // only key 4
  });

  it("returns points in ascending date order (oldest first)", () => {
    const result = computeActivityHistory([], TODAY, 5);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].date > result[i - 1].date).toBe(true);
    }
  });

  it("includes today in the window", () => {
    const log: GradeLog = [entry(TODAY, "99")];
    const result = computeActivityHistory(log, TODAY, 3);
    const today = result.find((p) => p.date === TODAY)!;
    expect(today).toBeDefined();
    expect(today.reviews).toBe(1);
  });

  it("boundary: window of 1 returns only today", () => {
    const log: GradeLog = [
      entry(TODAY, "25"),
      entry("2026-05-16", "26"),
    ];
    const result = computeActivityHistory(log, TODAY, 1);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe(TODAY);
    expect(result[0].reviews).toBe(1);
    expect(result[0].introduced).toBe(1);
  });

  it("prune boundary: card first seen one day before windowStart is not introduced inside the window", () => {
    // windowDays = 7, windowStart = 2026-05-11; first-seen = 2026-05-10 (one day before).
    // Simulates a pruned guest log where the entry on 2026-05-10 is still present
    // (the pruning caveat doesn't erase the data here, but the guard still holds:
    // the card's first-seen date falls outside the window, so it must not be
    // credited as an introduction when it is reviewed inside the window).
    const windowStart = "2026-05-11"; // isoMinusDays(TODAY, 6)
    const firstSeen = "2026-05-10";   // one day before windowStart
    expect(firstSeen < windowStart).toBe(true);

    const log: GradeLog = [
      entry(firstSeen, "prune-card"),  // first-seen just outside window
      entry(TODAY, "prune-card"),      // re-reviewed inside window
    ];
    const result = computeActivityHistory(log, TODAY, 7);
    // No day in the window should credit this key as an introduction.
    const totalIntroduced = result.reduce((sum, p) => sum + p.introduced, 0);
    expect(totalIntroduced).toBe(0);
    // The review inside the window is still counted.
    expect(result.find((p) => p.date === TODAY)!.reviews).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// isActivityHistoryEmpty
// ---------------------------------------------------------------------------

describe("isActivityHistoryEmpty", () => {
  it("returns true for all-zero series", () => {
    const series = [
      { date: "2026-05-17", reviews: 0, introduced: 0 },
      { date: "2026-05-16", reviews: 0, introduced: 0 },
    ];
    expect(isActivityHistoryEmpty(series)).toBe(true);
  });

  it("returns false when any reviews value is non-zero", () => {
    const series = [
      { date: "2026-05-17", reviews: 5, introduced: 0 },
      { date: "2026-05-16", reviews: 0, introduced: 0 },
    ];
    expect(isActivityHistoryEmpty(series)).toBe(false);
  });

  it("returns false when any introduced value is non-zero", () => {
    const series = [
      { date: "2026-05-17", reviews: 0, introduced: 1 },
      { date: "2026-05-16", reviews: 0, introduced: 0 },
    ];
    expect(isActivityHistoryEmpty(series)).toBe(false);
  });

  it("returns true for an empty array", () => {
    expect(isActivityHistoryEmpty([])).toBe(true);
  });
});
