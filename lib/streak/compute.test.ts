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
});
