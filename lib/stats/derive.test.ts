import { describe, it, expect } from "vitest";
import { computeStreak } from "@/lib/stats/derive";

const TODAY = "2026-05-09";

function daysAgo(n: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

describe("computeStreak", () => {
  it("returns 0 for empty array", () => {
    expect(computeStreak([], TODAY)).toBe(0);
  });

  it("returns 1 when only today is reviewed", () => {
    expect(computeStreak([TODAY], TODAY)).toBe(1);
  });

  it("returns 3 for three consecutive days ending today", () => {
    const dates = [daysAgo(2), daysAgo(1), TODAY];
    expect(computeStreak(dates, TODAY)).toBe(3);
  });

  it("returns 0 when last review was 3 days ago with no today", () => {
    const dates = [daysAgo(3), daysAgo(4)];
    expect(computeStreak(dates, TODAY)).toBe(0);
  });

  it("returns 1 when only yesterday is reviewed (today absent)", () => {
    expect(computeStreak([daysAgo(1)], TODAY)).toBe(1);
  });

  it("stops at a gap in a long run", () => {
    // 5 days ago, 4 days ago, 3 days ago, then gap at 2 days ago, then 1 day ago and today
    const dates = [daysAgo(5), daysAgo(4), daysAgo(3), daysAgo(1), TODAY];
    expect(computeStreak(dates, TODAY)).toBe(2);
  });

  it("returns 1 when today is reviewed but yesterday is not", () => {
    const dates = [daysAgo(3), daysAgo(2), TODAY];
    expect(computeStreak(dates, TODAY)).toBe(1);
  });

  it("deduplicates dates — streak treats repeated dates as one", () => {
    const dates = [TODAY, TODAY, daysAgo(1), daysAgo(1)];
    expect(computeStreak(dates, TODAY)).toBe(2);
  });

  it("handles a long consecutive streak without hanging", () => {
    const dates = Array.from({ length: 30 }, (_, i) => daysAgo(29 - i));
    expect(computeStreak(dates, TODAY)).toBe(30);
  });
});
