import { describe, it, expect } from "vitest";
import {
  computeRetentionComparison,
  RETENTION_WINDOW_DAYS,
} from "./retention";
import type { GradeLog } from "@/lib/gradelog/persistence";

const TODAY = "2026-05-12";

function entry(date: string, grade: 1 | 2 | 4 | 5): GradeLog[number] {
  return { date, grade, cardType: "name", occurredAt: 0 };
}

describe("computeRetentionComparison", () => {
  it("returns a null actual and delta for an empty log", () => {
    const result = computeRetentionComparison([], TODAY, 0.9);
    expect(result.actual).toBeNull();
    expect(result.delta).toBeNull();
    expect(result.reviews).toBe(0);
    expect(result.target).toBe(0.9);
    expect(result.windowDays).toBe(RETENTION_WINDOW_DAYS);
  });

  it("measures recall accuracy and the delta against the target", () => {
    const log: GradeLog = [
      entry("2026-05-12", 4),
      entry("2026-05-12", 5),
      entry("2026-05-11", 1),
      entry("2026-05-10", 4),
    ];
    const result = computeRetentionComparison(log, TODAY, 0.9);
    expect(result.reviews).toBe(4);
    expect(result.actual).toBeCloseTo(0.75); // 3 of 4 passed
    expect(result.delta).toBeCloseTo(0.75 - 0.9);
  });

  it("reports a positive delta when recall runs above target", () => {
    const log: GradeLog = [entry("2026-05-12", 4), entry("2026-05-12", 5)];
    const result = computeRetentionComparison(log, TODAY, 0.9);
    expect(result.actual).toBe(1);
    expect(result.delta).toBeCloseTo(0.1);
  });

  it("excludes reviews older than the window", () => {
    const log: GradeLog = [
      entry("2026-05-12", 4),
      entry("2024-01-01", 1), // well outside a 365-day window
    ];
    const result = computeRetentionComparison(log, TODAY, 0.9);
    expect(result.reviews).toBe(1);
    expect(result.actual).toBe(1);
  });

  it("respects a custom window width", () => {
    const log: GradeLog = [
      entry("2026-05-12", 4),
      entry("2026-05-01", 1), // outside a 7-day window
    ];
    const result = computeRetentionComparison(log, TODAY, 0.9, 7);
    expect(result.windowDays).toBe(7);
    expect(result.reviews).toBe(1);
  });

  it("single review in window - zero Again grades - actual is 1.0", () => {
    // Single-day log with one passing grade: reviews=1, actual=1.0.
    // This is the "retention with zero Again grades" scenario from issue #1019.
    const log: GradeLog = [entry("2026-05-12", 5)];
    const result = computeRetentionComparison(log, TODAY, 0.9);
    expect(result.reviews).toBe(1);
    expect(result.actual).toBe(1);
    expect(result.delta).toBeCloseTo(0.1);
  });
});
