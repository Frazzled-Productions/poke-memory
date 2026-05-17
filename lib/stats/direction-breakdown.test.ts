import { describe, it, expect } from "vitest";
import {
  CARD_DIRECTIONS,
  computeDirectionBreakdown,
  enabledDirectionsFromSettings,
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

  it("disabled is false for all rows when enabledDirections is omitted", () => {
    const rows = computeDirectionBreakdown([]);
    expect(rows.every((r) => r.disabled === false)).toBe(true);
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

  describe("with enabledDirections", () => {
    it("marks directions absent from the set as disabled", () => {
      const enabled = new Set<CardDirection>(["name", "evolution"]);
      const rows = computeDirectionBreakdown([], enabled);
      expect(rows.find((r) => r.direction === "name")!.disabled).toBe(false);
      expect(rows.find((r) => r.direction === "evolution")!.disabled).toBe(false);
      expect(rows.find((r) => r.direction === "reverse")!.disabled).toBe(true);
      expect(rows.find((r) => r.direction === "cry")!.disabled).toBe(true);
      expect(rows.find((r) => r.direction === "reverse-evolution")!.disabled).toBe(true);
    });

    it("a direction with history and disabled=true still has accurate counts", () => {
      const enabled = new Set<CardDirection>(["name"]);
      const log: GradeLog = [entry("cry", 4), entry("cry", 5), entry("cry", 1)];
      const rows = computeDirectionBreakdown(log, enabled);
      const cry = rows.find((r) => r.direction === "cry")!;
      expect(cry.disabled).toBe(true);
      expect(cry.total).toBe(3);
      expect(cry.passes).toBe(2);
    });

    it("a direction with zero reviews is still included (caller decides to hide)", () => {
      const enabled = new Set<CardDirection>(["name"]);
      const rows = computeDirectionBreakdown([], enabled);
      // Every direction is present; directions not in the set have disabled true.
      expect(rows).toHaveLength(CARD_DIRECTIONS.length);
      const zero = rows.filter((r) => r.total === 0);
      expect(zero).toHaveLength(CARD_DIRECTIONS.length);
    });
  });
});

describe("enabledDirectionsFromSettings", () => {
  it("includes only enabled directions", () => {
    const enabled = enabledDirectionsFromSettings({
      nameCardsEnabled: true,
      evolutionCardsEnabled: true,
      reverseEvolutionCardsEnabled: false,
      reverseCardsEnabled: false,
      cryCardsEnabled: false,
    });
    expect(enabled.has("name")).toBe(true);
    expect(enabled.has("evolution")).toBe(true);
    expect(enabled.has("reverse-evolution")).toBe(false);
    expect(enabled.has("reverse")).toBe(false);
    expect(enabled.has("cry")).toBe(false);
  });

  it("includes all five when all are enabled", () => {
    const enabled = enabledDirectionsFromSettings({
      nameCardsEnabled: true,
      evolutionCardsEnabled: true,
      reverseEvolutionCardsEnabled: true,
      reverseCardsEnabled: true,
      cryCardsEnabled: true,
    });
    expect(enabled.size).toBe(5);
  });

  it("returns an empty set when all are disabled", () => {
    const enabled = enabledDirectionsFromSettings({
      nameCardsEnabled: false,
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      reverseCardsEnabled: false,
      cryCardsEnabled: false,
    });
    expect(enabled.size).toBe(0);
  });
});
