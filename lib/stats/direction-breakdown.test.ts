import { describe, it, expect } from "vitest";
import {
  CARD_DIRECTIONS,
  computeDirectionBreakdown,
  totalDirectionReviews,
  type CardDirection,
} from "./direction-breakdown";
import type { GradeLog } from "@/lib/gradelog/persistence";

function entry(
  cardType: CardDirection,
  grade: 1 | 2 | 4 | 5,
): GradeLog[number] {
  return { date: "2026-05-12", grade, cardType, occurredAt: 0 };
}

describe("computeDirectionBreakdown", () => {
  it("always returns one row per card direction in display order", () => {
    const rows = computeDirectionBreakdown([]);
    expect(rows.map((r) => r.direction)).toEqual([...CARD_DIRECTIONS]);
  });

  it("an empty log gives zero totals and null accuracy everywhere", () => {
    const rows = computeDirectionBreakdown([]);
    expect(rows.every((r) => r.total === 0 && r.passes === 0)).toBe(true);
    expect(rows.every((r) => r.accuracy === null)).toBe(true);
    expect(totalDirectionReviews(rows)).toBe(0);
  });

  it("counts passes (4 / 5) and fails (1 / 2) per direction", () => {
    const log: GradeLog = [
      entry("name", 4),
      entry("name", 5),
      entry("name", 1),
      entry("cry", 2),
      entry("cry", 2),
    ];
    const rows = computeDirectionBreakdown(log);
    const name = rows.find((r) => r.direction === "name")!;
    const cry = rows.find((r) => r.direction === "cry")!;
    expect(name.total).toBe(3);
    expect(name.passes).toBe(2);
    expect(name.accuracy).toBeCloseTo(2 / 3);
    expect(cry.total).toBe(2);
    expect(cry.passes).toBe(0);
    expect(cry.accuracy).toBe(0);
  });

  it("totalDirectionReviews sums every direction", () => {
    const log: GradeLog = [
      entry("name", 4),
      entry("reverse", 4),
      entry("evolution", 1),
      entry("reverse-evolution", 5),
    ];
    expect(totalDirectionReviews(computeDirectionBreakdown(log))).toBe(4);
  });

  it("skips entries with an unknown cardType", () => {
    const log = [
      entry("name", 4),
      { date: "2026-05-12", grade: 4 as const, cardType: "future" as CardDirection, occurredAt: 0 },
    ];
    const rows = computeDirectionBreakdown(log);
    expect(totalDirectionReviews(rows)).toBe(1);
  });
});
