/**
 * Unit tests for `lib/pokemon/starterIds.ts`.
 *
 * Asserts that `STARTER_IDS` contains the correct species ids for each
 * generation's trio, that the set is deduplicated, and that its size remains
 * stable (27 starters across Gens I–IX).
 *
 * Node project (no DOM). Uses vitest's `node` environment.
 */

import { describe, it, expect } from "vitest";
import { STARTER_IDS } from "./starterIds";

// ---------------------------------------------------------------------------
// Set properties
// ---------------------------------------------------------------------------

describe("STARTER_IDS — set properties", () => {
  it("contains exactly 27 entries (3 starters × 9 generations)", () => {
    expect(STARTER_IDS.size).toBe(27);
  });

  it("is deduplicated — size equals the count of unique values", () => {
    // ReadonlySet is already deduplicated by construction; this guard ensures
    // no future accidental duplicate is added without breaking the size check.
    const asArray = Array.from(STARTER_IDS);
    expect(new Set(asArray).size).toBe(asArray.length);
  });

  it("contains only positive integer ids", () => {
    for (const id of STARTER_IDS) {
      expect(typeof id).toBe("number");
      expect(id).toBeGreaterThan(0);
      expect(Number.isInteger(id)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Per-generation trio membership
// ---------------------------------------------------------------------------

describe("STARTER_IDS — Gen I (Bulbasaur, Charmander, Squirtle)", () => {
  it("includes Bulbasaur (id=1)", () => expect(STARTER_IDS.has(1)).toBe(true));
  it("includes Charmander (id=4)", () => expect(STARTER_IDS.has(4)).toBe(true));
  it("includes Squirtle (id=7)", () => expect(STARTER_IDS.has(7)).toBe(true));
});

describe("STARTER_IDS — Gen II (Chikorita, Cyndaquil, Totodile)", () => {
  it("includes Chikorita (id=152)", () => expect(STARTER_IDS.has(152)).toBe(true));
  it("includes Cyndaquil (id=155)", () => expect(STARTER_IDS.has(155)).toBe(true));
  it("includes Totodile (id=158)", () => expect(STARTER_IDS.has(158)).toBe(true));
});

describe("STARTER_IDS — Gen III (Treecko, Torchic, Mudkip)", () => {
  it("includes Treecko (id=252)", () => expect(STARTER_IDS.has(252)).toBe(true));
  it("includes Torchic (id=255)", () => expect(STARTER_IDS.has(255)).toBe(true));
  it("includes Mudkip (id=258)", () => expect(STARTER_IDS.has(258)).toBe(true));
});

describe("STARTER_IDS — Gen IV (Turtwig, Chimchar, Piplup)", () => {
  it("includes Turtwig (id=387)", () => expect(STARTER_IDS.has(387)).toBe(true));
  it("includes Chimchar (id=390)", () => expect(STARTER_IDS.has(390)).toBe(true));
  it("includes Piplup (id=393)", () => expect(STARTER_IDS.has(393)).toBe(true));
});

describe("STARTER_IDS — Gen V (Snivy, Tepig, Oshawott)", () => {
  it("includes Snivy (id=495)", () => expect(STARTER_IDS.has(495)).toBe(true));
  it("includes Tepig (id=498)", () => expect(STARTER_IDS.has(498)).toBe(true));
  it("includes Oshawott (id=501)", () => expect(STARTER_IDS.has(501)).toBe(true));
});

describe("STARTER_IDS — Gen VI (Chespin, Fennekin, Froakie)", () => {
  it("includes Chespin (id=650)", () => expect(STARTER_IDS.has(650)).toBe(true));
  it("includes Fennekin (id=653)", () => expect(STARTER_IDS.has(653)).toBe(true));
  it("includes Froakie (id=656)", () => expect(STARTER_IDS.has(656)).toBe(true));
});

describe("STARTER_IDS — Gen VII (Rowlet, Litten, Popplio)", () => {
  it("includes Rowlet (id=722)", () => expect(STARTER_IDS.has(722)).toBe(true));
  it("includes Litten (id=725)", () => expect(STARTER_IDS.has(725)).toBe(true));
  it("includes Popplio (id=728)", () => expect(STARTER_IDS.has(728)).toBe(true));
});

describe("STARTER_IDS — Gen VIII (Grookey, Scorbunny, Sobble)", () => {
  it("includes Grookey (id=810)", () => expect(STARTER_IDS.has(810)).toBe(true));
  it("includes Scorbunny (id=813)", () => expect(STARTER_IDS.has(813)).toBe(true));
  it("includes Sobble (id=816)", () => expect(STARTER_IDS.has(816)).toBe(true));
});

describe("STARTER_IDS — Gen IX (Sprigatito, Fuecoco, Quaxly)", () => {
  it("includes Sprigatito (id=906)", () => expect(STARTER_IDS.has(906)).toBe(true));
  it("includes Fuecoco (id=909)", () => expect(STARTER_IDS.has(909)).toBe(true));
  it("includes Quaxly (id=912)", () => expect(STARTER_IDS.has(912)).toBe(true));
});

// ---------------------------------------------------------------------------
// Non-membership (stability / regression guards)
// ---------------------------------------------------------------------------

describe("STARTER_IDS — known non-members", () => {
  it("does NOT include Pikachu (id=25)", () => {
    expect(STARTER_IDS.has(25)).toBe(false);
  });

  it("does NOT include Mewtwo (id=150) — a legendary, not a starter", () => {
    expect(STARTER_IDS.has(150)).toBe(false);
  });

  it("does NOT include Eevee (id=133)", () => {
    expect(STARTER_IDS.has(133)).toBe(false);
  });

  it("does NOT include id=0 (no Pokémon)", () => {
    expect(STARTER_IDS.has(0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Completeness — every gen has exactly 3 members in the expected id ranges
// ---------------------------------------------------------------------------

describe("STARTER_IDS — one trio per generation id range", () => {
  const GEN_RANGES: Array<{ gen: number; first: number; last: number }> = [
    { gen: 1, first: 1,   last: 151  },
    { gen: 2, first: 152, last: 251  },
    { gen: 3, first: 252, last: 386  },
    { gen: 4, first: 387, last: 493  },
    { gen: 5, first: 494, last: 649  },
    { gen: 6, first: 650, last: 721  },
    { gen: 7, first: 722, last: 809  },
    { gen: 8, first: 810, last: 905  },
    { gen: 9, first: 906, last: 1025 },
  ];

  for (const { gen, first, last } of GEN_RANGES) {
    it(`Gen ${gen} contributes exactly 3 starter ids in the range ${first}–${last}`, () => {
      const genStarters = Array.from(STARTER_IDS).filter(
        (id) => id >= first && id <= last,
      );
      expect(genStarters).toHaveLength(3);
    });
  }
});
