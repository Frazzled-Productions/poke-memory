import { describe, it, expect } from "vitest";
import { checkBadges } from "./check";
import type { BadgeDefinition } from "./catalog";

const CATALOG: readonly BadgeDefinition[] = [
  {
    id: "birds",
    name: "Birds",
    description: "",
    lockedHint: "Three legendary wings soar above Kanto…",
    criterion: { kind: "all-mastered", speciesIds: [144, 145, 146] },
  },
  {
    id: "starters",
    name: "Starters",
    description: "",
    lockedHint: "Three Kanto partners and the paths they grow into…",
    criterion: { kind: "all-mastered", speciesIds: [1, 4, 7] },
  },
];

describe("checkBadges", () => {
  it("returns empty when nothing is mastered", () => {
    expect(checkBadges(new Set(), CATALOG, new Set())).toEqual([]);
  });

  it("awards a badge when every species in its criterion is mastered", () => {
    const result = checkBadges(new Set([144, 145, 146]), CATALOG, new Set());
    expect(result.map((b) => b.id)).toEqual(["birds"]);
  });

  it("requires every species - a single miss skips the badge", () => {
    const result = checkBadges(new Set([144, 145]), CATALOG, new Set());
    expect(result).toEqual([]);
  });

  it("never re-awards a badge already in the earned set", () => {
    const result = checkBadges(
      new Set([144, 145, 146, 1, 4, 7]),
      CATALOG,
      new Set(["birds"]),
    );
    expect(result.map((b) => b.id)).toEqual(["starters"]);
  });

  it("returns empty when all satisfiable badges are already earned - full idempotency", () => {
    // Every criterion is met, but every badge id is in alreadyEarned - 
    // no badge should be awarded twice.
    const result = checkBadges(
      new Set([144, 145, 146, 1, 4, 7]),
      CATALOG,
      new Set(["birds", "starters"]),
    );
    expect(result).toEqual([]);
  });

  it("returns multiple newly-earned badges in catalog order", () => {
    const result = checkBadges(
      new Set([1, 4, 7, 144, 145, 146]),
      CATALOG,
      new Set(),
    );
    expect(result.map((b) => b.id)).toEqual(["birds", "starters"]);
  });

  it("returns empty when the catalog is empty", () => {
    expect(checkBadges(new Set([1, 4, 7]), [], new Set())).toEqual([]);
  });

  it("ignores unrelated mastered species", () => {
    const result = checkBadges(
      new Set([999, 1000, 1001]),
      CATALOG,
      new Set(),
    );
    expect(result).toEqual([]);
  });

  it("never awards a badge whose criterion has an empty speciesIds list", () => {
    // criterionMet short-circuits to false when required.length === 0,
    // so a malformed badge entry cannot be auto-awarded regardless of
    // how many species the user has mastered.
    const catalogWithEmpty: readonly BadgeDefinition[] = [
      {
        id: "empty-criterion",
        name: "Empty",
        description: "",
        lockedHint: "…",
        criterion: { kind: "all-mastered", speciesIds: [] },
      },
    ];
    const result = checkBadges(
      new Set([1, 2, 3, 144, 145, 146]),
      catalogWithEmpty,
      new Set(),
    );
    expect(result).toEqual([]);
  });
});
