/**
 * Unit tests for the server-side scope predicate (#1159).
 *
 * Verifies that `scopeMatchesEntry` correctly mirrors the client-side
 * `speciesMatchesScope` behaviour for each scope axis, and that
 * `resolveAnchorId` correctly extracts the pre-evo id for evolution cards
 * and the species id for name/reverse/cry cards.
 */

import { describe, it, expect } from "vitest";
import { scopeMatchesEntry, resolveAnchorId } from "./scopePredicate";
import type { ScopeLookupEntry } from "@/lib/pokemon/scopeLookup";
import type { PracticeScope } from "@/lib/review/scope";
import { EMPTY_SCOPE } from "@/lib/review/scope";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Default-form Bulbasaur (Gen 1, Grass/Poison). */
const BULBASAUR: ScopeLookupEntry = {
  id: 1,
  speciesId: 1,
  types: ["grass", "poison"],
  isDefaultForm: true,
  formCategory: "default",
  versionGroups: ["red-blue", "gold-silver", "x-y"],
  isLegendary: false,
};

/** Default-form Charizard (Gen 1, Fire/Flying). */
const CHARIZARD: ScopeLookupEntry = {
  id: 6,
  speciesId: 6,
  types: ["fire", "flying"],
  isDefaultForm: true,
  formCategory: "default",
  versionGroups: ["red-blue", "x-y"],
  isLegendary: false,
};

/** Default-form Pikachu (Gen 1, Electric) - a starter-set non-member. */
const PIKACHU: ScopeLookupEntry = {
  id: 25,
  speciesId: 25,
  types: ["electric"],
  isDefaultForm: true,
  formCategory: "default",
  versionGroups: ["red-blue", "sword-shield"],
  isLegendary: false,
};

/** Default-form Bulbasaur - confirmed starter. */
const STARTER_BULBASAUR = BULBASAUR; // id 1 is in STARTER_IDS

/** Default-form Mewtwo (Gen 1, Psychic) - legendary. */
const MEWTWO: ScopeLookupEntry = {
  id: 150,
  speciesId: 150,
  types: ["psychic"],
  isDefaultForm: true,
  formCategory: "default",
  versionGroups: ["red-blue"],
  isLegendary: true,
};

/** Alolan Raichu (id=10100, speciesId=26) - alternate form, regional. */
const ALOLAN_RAICHU: ScopeLookupEntry = {
  id: 10100,
  speciesId: 26,
  types: ["electric", "psychic"],
  isDefaultForm: false,
  formCategory: "regional",
  versionGroups: ["sun-moon", "ultra-sun-ultra-moon"],
  isLegendary: false,
};

/** Gen 5 Pichu (id=172, speciesId=172) - Gen 2. */
const PICHU: ScopeLookupEntry = {
  id: 172,
  speciesId: 172,
  types: ["electric"],
  isDefaultForm: true,
  formCategory: "default",
  versionGroups: ["gold-silver", "sword-shield"],
  isLegendary: false,
};

// ---------------------------------------------------------------------------
// Empty scope
// ---------------------------------------------------------------------------

describe("scopeMatchesEntry - empty scope", () => {
  it("passes every entry when scope is completely empty", () => {
    expect(scopeMatchesEntry(BULBASAUR, EMPTY_SCOPE)).toBe(true);
    expect(scopeMatchesEntry(ALOLAN_RAICHU, EMPTY_SCOPE)).toBe(true);
    expect(scopeMatchesEntry(MEWTWO, EMPTY_SCOPE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// gens axis
// ---------------------------------------------------------------------------

describe("scopeMatchesEntry - gens axis", () => {
  const GEN1_SCOPE: PracticeScope = {
    gens: [1],
    types: [],
    presets: [],
    formCategories: { mode: "all" },
    games: [],
  };

  it("passes a Gen 1 species when gens includes Gen 1", () => {
    expect(scopeMatchesEntry(BULBASAUR, GEN1_SCOPE)).toBe(true);
    expect(scopeMatchesEntry(CHARIZARD, GEN1_SCOPE)).toBe(true);
  });

  it("rejects a non-Gen-1 species when gens is [1]", () => {
    // PICHU is Gen 2 (speciesId 172, range 152..251)
    expect(scopeMatchesEntry(PICHU, GEN1_SCOPE)).toBe(false);
  });

  it("passes an alt-form species (speciesId 26 = Gen 1) when gens includes 1", () => {
    // Alolan Raichu has speciesId=26 which is Gen 1 → passes gen filter
    expect(scopeMatchesEntry(ALOLAN_RAICHU, GEN1_SCOPE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// types axis
// ---------------------------------------------------------------------------

describe("scopeMatchesEntry - types axis", () => {
  const FIRE_SCOPE: PracticeScope = {
    gens: [],
    types: ["fire"],
    presets: [],
    formCategories: { mode: "all" },
    games: [],
  };

  it("passes a Fire-type species", () => {
    expect(scopeMatchesEntry(CHARIZARD, FIRE_SCOPE)).toBe(true);
  });

  it("rejects a non-Fire-type species", () => {
    expect(scopeMatchesEntry(BULBASAUR, FIRE_SCOPE)).toBe(false);
    expect(scopeMatchesEntry(PIKACHU, FIRE_SCOPE)).toBe(false);
  });

  it("passes a dual-typed species when one type matches", () => {
    // Alolan Raichu is Electric/Psychic; a Psychic scope should match.
    const PSYCHIC_SCOPE: PracticeScope = {
      gens: [],
      types: ["psychic"],
      presets: [],
      formCategories: { mode: "all" },
      games: [],
    };
    expect(scopeMatchesEntry(ALOLAN_RAICHU, PSYCHIC_SCOPE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// presets axis
// ---------------------------------------------------------------------------

describe("scopeMatchesEntry - starters preset", () => {
  const STARTERS_SCOPE: PracticeScope = {
    gens: [],
    types: [],
    presets: ["starters"],
    formCategories: { mode: "all" },
    games: [],
  };

  it("passes a starter species (Bulbasaur, id=1)", () => {
    expect(scopeMatchesEntry(STARTER_BULBASAUR, STARTERS_SCOPE)).toBe(true);
  });

  it("rejects a non-starter default species (Pikachu)", () => {
    expect(scopeMatchesEntry(PIKACHU, STARTERS_SCOPE)).toBe(false);
  });
});

describe("scopeMatchesEntry - legendaries preset", () => {
  const LEGENDARIES_SCOPE: PracticeScope = {
    gens: [],
    types: [],
    presets: ["legendaries"],
    formCategories: { mode: "all" },
    games: [],
  };

  it("passes a legendary species (Mewtwo)", () => {
    expect(scopeMatchesEntry(MEWTWO, LEGENDARIES_SCOPE)).toBe(true);
  });

  it("rejects a non-legendary species", () => {
    expect(scopeMatchesEntry(BULBASAUR, LEGENDARIES_SCOPE)).toBe(false);
  });
});

describe("scopeMatchesEntry - incomplete-chains preset (skipped server-side)", () => {
  const IC_SCOPE: PracticeScope = {
    gens: [],
    types: [],
    presets: ["incomplete-chains"],
    formCategories: { mode: "all" },
    games: [],
  };

  /**
   * Deliberate server-side approximation: `incomplete-chains` requires
   * per-user card-review state (which species in a chain have been mastered)
   * that the daily-push route does not load. The safe posture is to treat the
   * preset as "never matches" - meaning users with only this preset active
   * will receive 0 cards from the `incomplete-chains` axis in their push
   * count. This intentionally under-counts rather than over-counts, avoiding
   * phantom notifications for cards the user would not actually be shown.
   *
   * The client-side `speciesMatchesScope` behaves identically when
   * `ScopeMatchContext.incompleteChainSpeciesIds` is absent.
   */
  it("returns false for every entry (deliberate approximation: no runtime review state)", () => {
    expect(scopeMatchesEntry(BULBASAUR, IC_SCOPE)).toBe(false);
    expect(scopeMatchesEntry(MEWTWO, IC_SCOPE)).toBe(false);
    expect(scopeMatchesEntry(ALOLAN_RAICHU, IC_SCOPE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// games axis
// ---------------------------------------------------------------------------

describe("scopeMatchesEntry - games axis", () => {
  const RED_BLUE_SCOPE: PracticeScope = {
    gens: [],
    types: [],
    presets: [],
    formCategories: { mode: "all" },
    games: ["red-blue"],
  };

  it("passes a species that appears in the selected version-group", () => {
    expect(scopeMatchesEntry(BULBASAUR, RED_BLUE_SCOPE)).toBe(true); // has red-blue
  });

  it("rejects a species that does not appear in the selected version-group", () => {
    // Alolan Raichu only has sun-moon and ultra-sun-ultra-moon
    expect(scopeMatchesEntry(ALOLAN_RAICHU, RED_BLUE_SCOPE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formCategories gate
// ---------------------------------------------------------------------------

describe("scopeMatchesEntry - formCategories gate", () => {
  it("default-only mode excludes alternate forms", () => {
    const scope: PracticeScope = {
      gens: [1],
      types: [],
      presets: [],
      formCategories: { mode: "default-only" },
      games: [],
    };
    // Alolan Raichu is not a default form - excluded even though speciesId=26 is Gen 1
    expect(scopeMatchesEntry(ALOLAN_RAICHU, scope)).toBe(false);
    // Pikachu is default - passes
    expect(scopeMatchesEntry(PIKACHU, scope)).toBe(true);
  });

  it("include mode passes default forms unconditionally", () => {
    const scope: PracticeScope = {
      gens: [],
      types: ["fire"],
      presets: [],
      formCategories: { mode: "include", categories: ["regional"] },
      games: [],
    };
    // Charizard is a default form and is Fire - passes both form gate and type axis
    expect(scopeMatchesEntry(CHARIZARD, scope)).toBe(true);
  });

  it("include mode passes a non-default form whose category is in the list", () => {
    const scope: PracticeScope = {
      gens: [],
      types: [],
      presets: ["starters"],
      formCategories: { mode: "include", categories: ["regional"] },
      games: [],
    };
    // Alolan Raichu: formCategory=regional → passes the include gate.
    // presets=['starters'], Raichu (speciesId 26) is not a starter → false.
    // But formCategories doesn't make the species match starters - it just
    // doesn't exclude it from the form gate. The OR axes still need a hit.
    expect(scopeMatchesEntry(ALOLAN_RAICHU, scope)).toBe(false);
  });

  it("include mode excludes a non-default form not in the allowed categories", () => {
    const scope: PracticeScope = {
      gens: [1],
      types: [],
      presets: [],
      // "forme" is NOT in the include list; "regional" is the only allowed category
      formCategories: { mode: "include", categories: ["regional"] },
      games: [],
    };
    // A forme entry that is Gen 1 would be excluded because its category is "forme"
    const DEOXYS_FORME: ScopeLookupEntry = {
      id: 10001,
      speciesId: 386,
      types: ["psychic"],
      isDefaultForm: false,
      formCategory: "forme",
      versionGroups: ["ruby-sapphire"],
      isLegendary: false,
    };
    expect(scopeMatchesEntry(DEOXYS_FORME, scope)).toBe(false);
  });

  it("all mode (default) does not restrict forms", () => {
    const scope: PracticeScope = {
      gens: [1],
      types: [],
      presets: [],
      formCategories: { mode: "all" },
      games: [],
    };
    // Alolan Raichu speciesId=26 is Gen 1 and mode is 'all'
    expect(scopeMatchesEntry(ALOLAN_RAICHU, scope)).toBe(true);
  });

  it("missing formCategories defaults to 'all' (backwards compat)", () => {
    const scope: PracticeScope = {
      gens: [1],
      types: [],
      presets: [],
      // formCategories deliberately omitted
      games: [],
    };
    expect(scopeMatchesEntry(ALOLAN_RAICHU, scope)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// OR logic across axes
// ---------------------------------------------------------------------------

describe("scopeMatchesEntry - OR logic across axes", () => {
  it("passes when only the types axis matches (gens does not)", () => {
    // Mewtwo is Gen 1 Psychic; scope is Gen 5 + Psychic
    const scope: PracticeScope = {
      gens: [5],
      types: ["psychic"],
      presets: [],
      formCategories: { mode: "all" },
      games: [],
    };
    expect(scopeMatchesEntry(MEWTWO, scope)).toBe(true); // psychic matches
  });

  it("passes when only the gens axis matches (types does not)", () => {
    const scope: PracticeScope = {
      gens: [1],
      types: ["water"],
      presets: [],
      formCategories: { mode: "all" },
      games: [],
    };
    // Mewtwo is psychic (not water) but Gen 1
    expect(scopeMatchesEntry(MEWTWO, scope)).toBe(true);
  });

  it("rejects when no axis matches", () => {
    const scope: PracticeScope = {
      gens: [5],
      types: ["water"],
      presets: [],
      formCategories: { mode: "all" },
      games: [],
    };
    // Mewtwo is Gen 1 Psychic - neither Gen 5 nor Water
    expect(scopeMatchesEntry(MEWTWO, scope)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveAnchorId
// ---------------------------------------------------------------------------

describe("resolveAnchorId", () => {
  it("returns the numeric id for name cards", () => {
    expect(resolveAnchorId("name", "25")).toBe(25);
    expect(resolveAnchorId("name", "10100")).toBe(10100);
  });

  it("returns the numeric id for reverse cards", () => {
    expect(resolveAnchorId("reverse", "26")).toBe(26);
  });

  it("returns the numeric id for cry cards", () => {
    expect(resolveAnchorId("cry", "133")).toBe(133);
  });

  it("returns the fromId (pre-evo) for evolution-edge cards", () => {
    // "133>>>134" = Eevee(133) → Vaporeon(134); anchor = 133 (Eevee)
    expect(resolveAnchorId("evolution-edge", "133>>>134")).toBe(133);
  });

  it("returns the fromId (pre-evo) for reverse-evolution-edge cards", () => {
    expect(resolveAnchorId("reverse-evolution-edge", "1>>>2")).toBe(1);
  });

  it("returns null for malformed evolution-edge subjectKey (no >>>)", () => {
    expect(resolveAnchorId("evolution-edge", "25-26")).toBeNull();
  });

  it("returns null for unknown card types", () => {
    expect(resolveAnchorId("future-type", "42")).toBeNull();
  });

  it("returns null when subjectKey is not a valid integer for name cards", () => {
    expect(resolveAnchorId("name", "abc")).toBeNull();
  });
});
