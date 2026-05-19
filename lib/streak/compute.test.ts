import { describe, it, expect } from "vitest";
import { computeStreak } from "./compute";

describe("computeStreak", () => {
  it("returns 0 for empty array", () => {
    expect(computeStreak([], "2026-05-09")).toBe(0);
  });

  it("returns 1 for a single entry matching today", () => {
    expect(computeStreak(["2026-05-09"], "2026-05-09")).toBe(1);
  });

  it("returns 1 for a single entry matching yesterday (grace window)", () => {
    expect(computeStreak(["2026-05-08"], "2026-05-09")).toBe(1);
  });

  it("returns 0 when last entry was two days ago", () => {
    expect(computeStreak(["2026-05-07"], "2026-05-09")).toBe(0);
  });

  it("counts a multi-day consecutive streak ending today", () => {
    const dates = ["2026-05-07", "2026-05-08", "2026-05-09"];
    expect(computeStreak(dates, "2026-05-09")).toBe(3);
  });

  it("stops streak at a gap even if earlier dates exist", () => {
    const dates = ["2026-05-01", "2026-05-07", "2026-05-08", "2026-05-09"];
    expect(computeStreak(dates, "2026-05-09")).toBe(3);
  });

  it("counts multi-day streak via grace window (today not reviewed)", () => {
    const dates = ["2026-05-06", "2026-05-07", "2026-05-08"];
    expect(computeStreak(dates, "2026-05-09")).toBe(3);
  });

  it("returns 0 when neither today nor yesterday is in the set", () => {
    const dates = ["2026-05-01", "2026-05-02", "2026-05-06"];
    expect(computeStreak(dates, "2026-05-09")).toBe(0);
  });

  it("is idempotent with duplicate entries in input", () => {
    const dates = ["2026-05-08", "2026-05-09", "2026-05-09"];
    expect(computeStreak(dates, "2026-05-09")).toBe(2);
  });

  it("handles out-of-order input correctly", () => {
    // Dates provided in reverse order — Set normalises this.
    const dates = ["2026-05-09", "2026-05-07", "2026-05-08"];
    expect(computeStreak(dates, "2026-05-09")).toBe(3);
  });

  it("handles a month boundary within a consecutive streak", () => {
    // Streak crosses from April into May — offsetDate must carry the month correctly.
    const dates = ["2026-04-29", "2026-04-30", "2026-05-01", "2026-05-02"];
    expect(computeStreak(dates, "2026-05-02")).toBe(4);
  });

  it("handles a year boundary within a consecutive streak", () => {
    const dates = ["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"];
    expect(computeStreak(dates, "2026-01-02")).toBe(4);
  });

  it("is unaffected by a DST spring-forward boundary (UTC arithmetic stays stable)", () => {
    // US Eastern spring-forward: 2026-03-08 02:00 local becomes 03:00.
    // offsetDate anchors to T00:00:00Z so the UTC day count is unambiguous.
    const dates = ["2026-03-07", "2026-03-08", "2026-03-09"];
    expect(computeStreak(dates, "2026-03-09")).toBe(3);
  });

  it("is unaffected by a DST fall-back boundary (UTC arithmetic stays stable)", () => {
    // US Eastern fall-back: 2025-11-02 02:00 local becomes 01:00.
    const dates = ["2025-11-01", "2025-11-02", "2025-11-03"];
    expect(computeStreak(dates, "2025-11-03")).toBe(3);
  });

  it("counts a long consecutive streak via the grace window", () => {
    // 30-day streak ending yesterday — today not yet reviewed.
    const dates: string[] = [];
    for (let i = 30; i >= 1; i--) {
      const d = new Date("2026-05-09T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }
    // dates[0] = 2026-04-09, dates[29] = 2026-05-08 (yesterday)
    expect(computeStreak(dates, "2026-05-09")).toBe(30);
  });

  it("returns 0 when two-day gap separates the most recent entry from today", () => {
    // Regression guard: gap of two days collapses the streak regardless of array length.
    const dates = ["2026-05-07", "2026-05-06", "2026-05-05"];
    expect(computeStreak(dates, "2026-05-09")).toBe(0);
  });
});
