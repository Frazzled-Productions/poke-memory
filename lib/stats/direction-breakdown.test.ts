import { describe, it, expect } from "vitest";
import {
  CARD_DIRECTIONS,
  computeDirectionBreakdown,
  computeSessionDirectionAccuracy,
  enabledDirectionsFromSettings,
  totalDirectionReviews,
  type CardDirection,
  type SessionDirectionTally,
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

describe("computeSessionDirectionAccuracy", () => {
  it("returns an empty array for an empty tally", () => {
    const tally: SessionDirectionTally = new Map();
    expect(computeSessionDirectionAccuracy(tally)).toEqual([]);
  });

  it("returns only directions present in the tally, in display order", () => {
    const tally: SessionDirectionTally = new Map([
      ["cry", { total: 2, passes: 1 }],
      ["name", { total: 3, passes: 3 }],
    ]);
    const rows = computeSessionDirectionAccuracy(tally);
    // Display order: name before cry (CARD_DIRECTIONS order: name, reverse, cry, ...)
    expect(rows.map((r) => r.direction)).toEqual(["name", "cry"]);
  });

  it("computes accuracy as passes / total", () => {
    const tally: SessionDirectionTally = new Map([
      ["name", { total: 4, passes: 3 }],
    ]);
    const rows = computeSessionDirectionAccuracy(tally);
    expect(rows[0].accuracy).toBeCloseTo(0.75);
    expect(rows[0].total).toBe(4);
    expect(rows[0].passes).toBe(3);
  });

  it("omits a direction whose total is 0", () => {
    const tally: SessionDirectionTally = new Map([
      ["name", { total: 0, passes: 0 }],
      ["evolution", { total: 2, passes: 1 }],
    ]);
    const rows = computeSessionDirectionAccuracy(tally);
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe("evolution");
  });

  it("all directions present are returned in CARD_DIRECTIONS order", () => {
    const tally: SessionDirectionTally = new Map(
      CARD_DIRECTIONS.map((d) => [d, { total: 1, passes: 1 }]),
    );
    const rows = computeSessionDirectionAccuracy(tally);
    expect(rows.map((r) => r.direction)).toEqual([...CARD_DIRECTIONS]);
  });

  it("disabled is always false (session tally has no settings context)", () => {
    const tally: SessionDirectionTally = new Map([
      ["cry", { total: 1, passes: 0 }],
    ]);
    const rows = computeSessionDirectionAccuracy(tally);
    expect(rows[0].disabled).toBe(false);
  });
});

describe("enabledDirectionsFromSettings", () => {
  // Name and reverse are always on since #1234 — no per-direction toggle.
  it("always includes name and reverse regardless of enrichment flags", () => {
    const enabled = enabledDirectionsFromSettings({
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      cryCardsEnabled: false,
    });
    expect(enabled.has("name")).toBe(true);
    expect(enabled.has("reverse")).toBe(true);
    expect(enabled.has("evolution")).toBe(false);
    expect(enabled.has("reverse-evolution")).toBe(false);
    expect(enabled.has("cry")).toBe(false);
  });

  it("includes all five when all enrichment flags are enabled", () => {
    const enabled = enabledDirectionsFromSettings({
      evolutionCardsEnabled: true,
      reverseEvolutionCardsEnabled: true,
      cryCardsEnabled: true,
    });
    expect(enabled.size).toBe(5);
  });

  it("returns name and reverse even when enrichment flags are all disabled", () => {
    const enabled = enabledDirectionsFromSettings({
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      cryCardsEnabled: false,
    });
    // name and reverse are always on
    expect(enabled.size).toBe(2);
  });
});
