/**
 * lib/pokemon/versionNames.test.ts
 *
 * Unit tests for VERSION_NAMES and formatVersions.
 * Covers:
 *   - slug → display-name resolution for known slugs
 *   - release-order sort
 *   - up-to-3-then-+N overflow logic
 *   - titleCase fallback for unknown slugs
 *   - empty input
 *   - forcing-function: every slug in VERSION_NAMES has a display and order
 */

import { describe, it, expect } from "vitest";
import { VERSION_NAMES, formatVersions } from "@/lib/pokemon/versionNames";

// ---------------------------------------------------------------------------
// Parity / coverage forcing-function
// ---------------------------------------------------------------------------

describe("VERSION_NAMES parity", () => {
  it("every entry has a non-empty display string", () => {
    for (const [slug, meta] of Object.entries(VERSION_NAMES)) {
      expect(meta.display, `slug "${slug}" display must be non-empty`).toBeTruthy();
    }
  });

  it("every entry has a positive integer order", () => {
    for (const [slug, meta] of Object.entries(VERSION_NAMES)) {
      expect(
        Number.isInteger(meta.order) && meta.order > 0,
        `slug "${slug}" order must be a positive integer`,
      ).toBe(true);
    }
  });

  it("order values are unique (no two slugs share the same ordinal)", () => {
    const orders = Object.values(VERSION_NAMES).map((m) => m.order);
    const unique = new Set(orders);
    expect(unique.size).toBe(orders.length);
  });
});

// ---------------------------------------------------------------------------
// formatVersions - single slug
// ---------------------------------------------------------------------------

describe("formatVersions - single slug", () => {
  it("resolves 'red' to 'Red'", () => {
    expect(formatVersions(["red"])).toBe("Red");
  });

  it("resolves 'firered' to 'FireRed'", () => {
    expect(formatVersions(["firered"])).toBe("FireRed");
  });

  it("resolves 'brilliant-diamond' to 'Brilliant Diamond'", () => {
    expect(formatVersions(["brilliant-diamond"])).toBe("Brilliant Diamond");
  });

  it("falls back to titleCase for an unknown slug", () => {
    expect(formatVersions(["some-unknown-game"])).toBe("Some Unknown Game");
  });

  it("returns empty string for empty input", () => {
    expect(formatVersions([])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// formatVersions - release-order sort
// ---------------------------------------------------------------------------

describe("formatVersions - release-order sort", () => {
  it("sorts slugs by release order (earlier game first)", () => {
    // yellow (order 3) then red (order 1) - should come out Red · Yellow
    expect(formatVersions(["yellow", "red"])).toBe("Red · Yellow");
  });

  it("sorts gold, crystal, silver into Gold · Silver · Crystal", () => {
    expect(formatVersions(["crystal", "gold", "silver"])).toBe("Gold · Silver · Crystal");
  });

  it("unknown slugs sort after known ones", () => {
    const result = formatVersions(["unknown-future-game", "red"]);
    expect(result).toBe("Red · Unknown Future Game");
  });
});

// ---------------------------------------------------------------------------
// formatVersions - up-to-3 display, +N overflow
// ---------------------------------------------------------------------------

describe("formatVersions - overflow logic", () => {
  it("shows all 3 when exactly 3 slugs", () => {
    expect(formatVersions(["red", "blue", "yellow"])).toBe("Red · Blue · Yellow");
  });

  it("shows first 3 + '+1' when 4 slugs", () => {
    // Red (1), Blue (2), Yellow (3), Gold (4) → first 3 shown, +1
    expect(formatVersions(["gold", "red", "blue", "yellow"])).toBe("Red · Blue · Yellow +1");
  });

  it("shows first 3 + '+2' when 5 slugs", () => {
    // red, blue, yellow, gold, silver
    expect(formatVersions(["silver", "gold", "red", "blue", "yellow"])).toBe(
      "Red · Blue · Yellow +2",
    );
  });

  it("shows first 3 + '+4' when 7 slugs (cover all Gen I + Gen II)", () => {
    const slugs = ["crystal", "silver", "gold", "yellow", "blue", "red", "emerald"];
    // sorted: red(1), blue(2), yellow(3), gold(4), silver(5), crystal(6), emerald(11)
    const result = formatVersions(slugs);
    expect(result).toBe("Red · Blue · Yellow +4");
  });
});

// ---------------------------------------------------------------------------
// formatVersions - locale invariance (game names stay English)
// ---------------------------------------------------------------------------

describe("formatVersions - locale-invariant English proper nouns", () => {
  // Game names do not change based on locale - they are English proper nouns.
  // This test documents the invariant: the same slug always resolves to the
  // same English display name regardless of the calling context's locale.

  const cases: Array<[string, string]> = [
    ["red",              "Red"],
    ["blue",             "Blue"],
    ["yellow",           "Yellow"],
    ["firered",          "FireRed"],
    ["leafgreen",        "LeafGreen"],
    ["scarlet",          "Scarlet"],
    ["violet",           "Violet"],
    ["brilliant-diamond","Brilliant Diamond"],
    ["legends-arceus",   "Legends: Arceus"],
    ["lets-go-pikachu",  "Let's Go Pikachu"],
  ];

  for (const [slug, expected] of cases) {
    it(`slug '${slug}' always resolves to '${expected}' (English proper noun, locale-invariant)`, () => {
      expect(formatVersions([slug])).toBe(expected);
    });
  }
});
