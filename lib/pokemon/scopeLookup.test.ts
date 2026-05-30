/**
 * Unit tests for `lib/pokemon/scopeLookup.ts`.
 *
 * Exercises the actual `SCOPE_LOOKUP` array (1174 entries derived from the
 * seeded PokéAPI data), verifying structural invariants and correct membership
 * across the gens / types / legendaries / version-groups axes for
 * representative known species. The `scopePredicate.test.ts` already covers
 * the predicate *logic* using fixture objects; these tests verify the *data*
 * behind the lookup — that the entries were built correctly and describe real
 * Pokémon.
 *
 * Node project (no DOM). Uses vitest's `node` environment.
 */

import { describe, it, expect } from "vitest";
import { SCOPE_LOOKUP, type ScopeLookupEntry } from "./scopeLookup";

// ---------------------------------------------------------------------------
// Structural invariants
// ---------------------------------------------------------------------------

describe("SCOPE_LOOKUP — structural invariants", () => {
  it("contains 1174 entries", () => {
    // Hard-coded count matches the comment in the generated file; if the seed
    // is regenerated this test will catch unintended deletions or additions.
    expect(SCOPE_LOOKUP.length).toBe(1174);
  });

  it("has no duplicate ids", () => {
    const ids = SCOPE_LOOKUP.map((e) => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("every entry has at least one type", () => {
    const withoutTypes = SCOPE_LOOKUP.filter((e) => e.types.length === 0);
    expect(withoutTypes).toHaveLength(0);
  });

  it("every entry has a non-zero speciesId", () => {
    const bad = SCOPE_LOOKUP.filter((e) => e.speciesId <= 0);
    expect(bad).toHaveLength(0);
  });

  it("formCategory is one of the six valid values for every entry", () => {
    const valid = new Set(["default", "regional", "mega", "gmax", "primal", "forme"]);
    const invalid = SCOPE_LOOKUP.filter((e) => !valid.has(e.formCategory));
    expect(invalid).toHaveLength(0);
  });

  it("all version-group slugs are non-empty strings", () => {
    const badSlugs = SCOPE_LOOKUP.flatMap((e) =>
      e.versionGroups.filter((vg) => typeof vg !== "string" || vg.trim() === ""),
    );
    expect(badSlugs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Default-form coverage
// ---------------------------------------------------------------------------

describe("SCOPE_LOOKUP — default-form entries", () => {
  it("Gen I species (speciesId 1–151) all have exactly one default-form entry each", () => {
    const gen1Defaults = SCOPE_LOOKUP.filter(
      (e) => e.speciesId >= 1 && e.speciesId <= 151 && e.isDefaultForm,
    );
    // One entry per species for 151 species.
    const speciesIds = gen1Defaults.map((e) => e.speciesId);
    expect(new Set(speciesIds).size).toBe(151);
    expect(gen1Defaults).toHaveLength(151);
  });

  it("non-default-form entries all have an id in the 10 000+ range", () => {
    // PokéAPI assigns alternate-form Pokémon ids >= 10 001.
    const altForms = SCOPE_LOOKUP.filter((e) => !e.isDefaultForm);
    expect(altForms.length).toBeGreaterThan(0);
    const defaultRangeAlts = altForms.filter((e) => e.id < 10_000);
    expect(defaultRangeAlts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Known-species membership — gens axis (via speciesId ranges)
// ---------------------------------------------------------------------------

describe("SCOPE_LOOKUP — gens axis (speciesId ranges)", () => {
  function defaultEntry(id: number): ScopeLookupEntry {
    const entry = SCOPE_LOOKUP.find((e) => e.id === id && e.isDefaultForm);
    if (!entry) throw new Error(`No default-form entry found for id=${id}`);
    return entry;
  }

  it("Bulbasaur (id=1, speciesId=1) is in Gen I range (1–151)", () => {
    const entry = defaultEntry(1);
    expect(entry.speciesId).toBe(1);
    expect(entry.speciesId).toBeGreaterThanOrEqual(1);
    expect(entry.speciesId).toBeLessThanOrEqual(151);
  });

  it("Chikorita (id=152, speciesId=152) is in Gen II range (152–251)", () => {
    const entry = defaultEntry(152);
    expect(entry.speciesId).toBe(152);
    expect(entry.speciesId).toBeGreaterThanOrEqual(152);
    expect(entry.speciesId).toBeLessThanOrEqual(251);
  });

  it("Sprigatito (id=906, speciesId=906) is in Gen IX range (906–1025)", () => {
    const entry = defaultEntry(906);
    expect(entry.speciesId).toBe(906);
    expect(entry.speciesId).toBeGreaterThanOrEqual(906);
    expect(entry.speciesId).toBeLessThanOrEqual(1025);
  });

  it("Alolan Raichu (id=10100) carries speciesId=26 (its Gen I base species)", () => {
    // Alternate-form entries reference the base-species id for gen-axis lookups.
    const entry = SCOPE_LOOKUP.find((e) => e.id === 10100);
    expect(entry).toBeDefined();
    expect(entry!.speciesId).toBe(26);
    expect(entry!.isDefaultForm).toBe(false);
    expect(entry!.formCategory).toBe("regional");
  });
});

// ---------------------------------------------------------------------------
// Known-species membership — types axis
// ---------------------------------------------------------------------------

describe("SCOPE_LOOKUP — types axis", () => {
  it("Bulbasaur (id=1) is Grass/Poison", () => {
    const entry = SCOPE_LOOKUP.find((e) => e.id === 1)!;
    expect(entry.types).toEqual(expect.arrayContaining(["grass", "poison"]));
    expect(entry.types).toHaveLength(2);
  });

  it("Pikachu (id=25) is Electric only", () => {
    const entry = SCOPE_LOOKUP.find((e) => e.id === 25)!;
    expect(entry.types).toEqual(["electric"]);
  });

  it("Mewtwo (id=150) is Psychic", () => {
    const entry = SCOPE_LOOKUP.find((e) => e.id === 150)!;
    expect(entry.types).toContain("psychic");
  });

  it("Alolan Raichu (id=10100) is Electric/Psychic", () => {
    const entry = SCOPE_LOOKUP.find((e) => e.id === 10100)!;
    expect(entry.types).toEqual(expect.arrayContaining(["electric", "psychic"]));
    expect(entry.types).toHaveLength(2);
  });

  it("Sprigatito (id=906) is Grass", () => {
    const entry = SCOPE_LOOKUP.find((e) => e.id === 906)!;
    expect(entry.types).toContain("grass");
  });
});

// ---------------------------------------------------------------------------
// Known-species membership — legendaries
// ---------------------------------------------------------------------------

describe("SCOPE_LOOKUP — legendaries axis", () => {
  it("Mewtwo (id=150) is marked legendary", () => {
    const entry = SCOPE_LOOKUP.find((e) => e.id === 150)!;
    expect(entry.isLegendary).toBe(true);
  });

  it("Bulbasaur (id=1) is not marked legendary", () => {
    const entry = SCOPE_LOOKUP.find((e) => e.id === 1)!;
    expect(entry.isLegendary).toBe(false);
  });

  it("Pikachu (id=25) is not marked legendary", () => {
    const entry = SCOPE_LOOKUP.find((e) => e.id === 25)!;
    expect(entry.isLegendary).toBe(false);
  });

  it("the lookup contains at least 50 legendary entries", () => {
    // Conservative floor: the seed currently tracks 96 legendary entries;
    // asserting a lower bound guards against accidental mass-removal.
    const legendaries = SCOPE_LOOKUP.filter((e) => e.isLegendary);
    expect(legendaries.length).toBeGreaterThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------
// Known-species membership — version-groups (games) axis
// ---------------------------------------------------------------------------

describe("SCOPE_LOOKUP — version-groups axis", () => {
  it("Bulbasaur (id=1) appears in 'red-blue' and 'scarlet-violet'", () => {
    const entry = SCOPE_LOOKUP.find((e) => e.id === 1)!;
    expect(entry.versionGroups).toContain("red-blue");
    expect(entry.versionGroups).toContain("scarlet-violet");
  });

  it("Alolan Raichu (id=10100) appears in 'sun-moon' but not 'red-blue'", () => {
    const entry = SCOPE_LOOKUP.find((e) => e.id === 10100)!;
    expect(entry.versionGroups).toContain("sun-moon");
    expect(entry.versionGroups).not.toContain("red-blue");
  });

  it("Sprigatito (id=906) appears in 'scarlet-violet' but not 'red-blue'", () => {
    const entry = SCOPE_LOOKUP.find((e) => e.id === 906)!;
    expect(entry.versionGroups).toContain("scarlet-violet");
    expect(entry.versionGroups).not.toContain("red-blue");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("SCOPE_LOOKUP — edge cases", () => {
  it("looking up an id that does not exist returns undefined", () => {
    const entry = SCOPE_LOOKUP.find((e) => e.id === 99999);
    expect(entry).toBeUndefined();
  });

  it("speciesId 0 is not present (no entry for a non-existent species)", () => {
    const entry = SCOPE_LOOKUP.find((e) => e.speciesId === 0);
    expect(entry).toBeUndefined();
  });
});
