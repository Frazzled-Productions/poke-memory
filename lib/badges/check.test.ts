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

  it("requires every species — a single miss skips the badge", () => {
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
});
