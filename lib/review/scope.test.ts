import { describe, it, expect, beforeEach } from "vitest";
import {
  cardMatchesScope,
  isScopeEmpty,
  EMPTY_SCOPE,
  loadScope,
  saveScope,
  scopeLabel,
  countMatchingSpecies,
  readLegacyScope,
  clearLegacyScope,
} from "./scope";
import type { NameReviewCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";
import type { SeedPokemon } from "@/lib/pokemon/seed";
import type { FormCategory } from "@/lib/pokemon/forms";
import type { PracticeScopePreset } from "./scope";

function state(): ReviewState {
  return {
    stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0,
    reps: 0, lapses: 0, fsrsState: "new",
    dueDate: "2026-05-12", lastReview: null, firstSeen: null,
    learningStep: null, stepStartedAt: null, hiddenSince: null,
    seenInPasture: false,
  };
}

function nameCard(id: number, types: string[] = ["normal"]): NameReviewCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `P${id}`,
    name: `P${id}`, spriteUrl: "", types,
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "", flavorTexts: [""], evolutionChain: [],
    height: 10, weight: 100, baseExperience: 64, genus: "",
    generation: "generation-i", captureRate: 45, baseHappiness: 50,
    growthRate: "medium", habitat: null, genderRate: 0,
    isLegendary: false, isMythical: false, cryUrl: null,
    cardType: "name", subjectKey: String(id), state: state(),
  };
}

describe("cardMatchesScope", () => {
  it("empty scope matches every card", () => {
    expect(cardMatchesScope(nameCard(1), EMPTY_SCOPE)).toBe(true);
    expect(cardMatchesScope(nameCard(1000), EMPTY_SCOPE)).toBe(true);
  });

  it("gen filter matches cards in the listed generation", () => {
    const scope = { gens: [1], types: [], presets: [] };
    expect(cardMatchesScope(nameCard(1), scope)).toBe(true); // gen 1
    expect(cardMatchesScope(nameCard(152), scope)).toBe(false); // gen 2
  });

  it("type filter matches cards with any listed type", () => {
    const scope = { gens: [], types: ["fire"], presets: [] };
    expect(cardMatchesScope(nameCard(1, ["fire", "flying"]), scope)).toBe(true);
    expect(cardMatchesScope(nameCard(1, ["water"]), scope)).toBe(false);
  });

  it("starters preset matches Bulbasaur (1) and Snivy (495)", () => {
    const scope = { gens: [], types: [], presets: ["starters" as const] };
    expect(cardMatchesScope(nameCard(1), scope)).toBe(true);
    expect(cardMatchesScope(nameCard(495), scope)).toBe(true);
    expect(cardMatchesScope(nameCard(2), scope)).toBe(false); // Ivysaur is not a starter
  });

  it("filters are OR'd: passing any active category passes the card", () => {
    const scope = { gens: [1], types: ["water"], presets: [] };
    expect(cardMatchesScope(nameCard(1, ["grass"]), scope)).toBe(true); // gen match
    expect(cardMatchesScope(nameCard(500, ["water"]), scope)).toBe(true); // type match
    expect(cardMatchesScope(nameCard(500, ["grass"]), scope)).toBe(false); // neither
  });
});

describe("isScopeEmpty", () => {
  it("returns true for the canonical empty scope", () => {
    expect(isScopeEmpty(EMPTY_SCOPE)).toBe(true);
  });
  it("returns false once any filter is active", () => {
    expect(isScopeEmpty({ gens: [1], types: [], presets: [] })).toBe(false);
    expect(isScopeEmpty({ gens: [], types: ["fire"], presets: [] })).toBe(false);
    expect(isScopeEmpty({ gens: [], types: [], presets: ["starters"] })).toBe(false);
  });
});

describe("scopeLabel", () => {
  it("default label", () => {
    expect(scopeLabel(EMPTY_SCOPE)).toBe("All Pokémon");
  });
  it("combines categories with bullet separators and Roman numerals for gens", () => {
    expect(
      scopeLabel({ gens: [1], types: ["fire"], presets: ["starters"] }),
    ).toBe("Gen I · Fire · Starters");
  });
  it("joins multiple gens with comma in Roman numerals", () => {
    expect(
      scopeLabel({ gens: [1, 3, 9], types: [], presets: [] }),
    ).toBe("Gen I, III, IX");
  });
});

describe("loadScope / saveScope round-trip (deprecated shims)", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      get length() { return store.size; },
      key: (i: number) => [...store.keys()][i] ?? null,
    };
    Object.defineProperty(globalThis, "window", {
      value: { localStorage: ls },
      writable: true,
    });
  });

  it("returns EMPTY_SCOPE when nothing is stored", () => {
    expect(loadScope()).toEqual(EMPTY_SCOPE);
  });

  it("survives a save → load round-trip", () => {
    const scope = {
      gens: [1, 3],
      types: ["fire"],
      presets: ["starters" as const],
      formCategories: { mode: "all" as const },
    };
    saveScope(scope);
    expect(loadScope()).toEqual(scope);
  });

  it("saving the empty scope clears the key", () => {
    saveScope({ gens: [1], types: [], presets: [] });
    saveScope(EMPTY_SCOPE);
    expect(loadScope()).toEqual(EMPTY_SCOPE);
  });
});

// ─── countMatchingSpecies ────────────────────────────────────────────────

function makeSeed(id: number, types: string[]): SeedPokemon {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: "pkmn-" + id,
    name: "pkmn-" + id,
    spriteUrl: "",
    types,
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "test",
    flavorTexts: ["test"],
    evolutionChain: [],
    height: 10,
    weight: 100,
    baseExperience: 64,
    genus: "Generic",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium",
    habitat: null,
    genderRate: 0,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
  };
}

describe("countMatchingSpecies", () => {
  // Mini seed pool spanning gens I, II, IV with overlapping types.
  // Using real Pokédex ids keeps `generationOf` honest.
  const SEED: readonly SeedPokemon[] = [
    makeSeed(1, ["grass", "poison"]),   // Bulbasaur, Gen I
    makeSeed(4, ["fire"]),              // Charmander, Gen I
    makeSeed(7, ["water"]),             // Squirtle, Gen I
    makeSeed(152, ["grass"]),           // Chikorita, Gen II
    makeSeed(155, ["fire"]),            // Cyndaquil, Gen II
    makeSeed(387, ["grass"]),           // Turtwig, Gen IV
  ];

  it("returns seed.length for the empty scope", () => {
    expect(countMatchingSpecies(SEED, EMPTY_SCOPE)).toBe(SEED.length);
  });

  it("counts species in selected generations", () => {
    expect(countMatchingSpecies(SEED, { gens: [1], types: [], presets: [] })).toBe(3);
    expect(countMatchingSpecies(SEED, { gens: [1, 2], types: [], presets: [] })).toBe(5);
  });

  it("counts species matching any selected type (OR within axis)", () => {
    // Fire: Charmander, Cyndaquil → 2.
    expect(countMatchingSpecies(SEED, { gens: [], types: ["fire"], presets: [] })).toBe(2);
    // Poison: Bulbasaur via dual-type → 1.
    expect(countMatchingSpecies(SEED, { gens: [], types: ["poison"], presets: [] })).toBe(1);
    // Grass: Bulbasaur, Chikorita, Turtwig → 3.
    expect(countMatchingSpecies(SEED, { gens: [], types: ["grass"], presets: [] })).toBe(3);
  });

  it("OR's gens and types — a Pokemon need only match one active axis", () => {
    // Gen I (3) OR Fire (2) — Charmander overlaps, so the union is 4.
    expect(countMatchingSpecies(SEED, { gens: [1], types: ["fire"], presets: [] })).toBe(4);
  });

  it("counts starters preset hits in the seed", () => {
    // The starter preset hard-codes the Gen I/II/III/IV/.../IX trios; the
    // SEED above is composed entirely of starter ids, so the count equals
    // SEED.length. Using a mixed pool with a non-starter would test the
    // *negative* side of the filter — covered by the next case.
    expect(
      countMatchingSpecies(SEED, { gens: [], types: [], presets: ["starters"] }),
    ).toBe(SEED.length);
  });

  it("preset filter excludes species not in the preset's id set", () => {
    // Bulbasaur (1) is a starter; Pikachu (25) is not. The starters preset
    // narrows the count to 1.
    const mixed: readonly SeedPokemon[] = [
      makeSeed(1, ["grass", "poison"]),  // starter
      makeSeed(25, ["electric"]),        // not a starter
    ];
    expect(
      countMatchingSpecies(mixed, { gens: [], types: [], presets: ["starters"] }),
    ).toBe(1);
  });

  it("returns 0 when nothing matches", () => {
    expect(countMatchingSpecies(SEED, { gens: [9], types: ["dragon"], presets: [] })).toBe(0);
  });
});

// ─── readLegacyScope / clearLegacyScope ──────────────────────────────────

describe("readLegacyScope / clearLegacyScope", () => {
  const LEGACY_KEY = "poke-memory:practice-scope:v1";

  beforeEach(() => {
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      get length() { return store.size; },
      key: (i: number) => [...store.keys()][i] ?? null,
    };
    Object.defineProperty(globalThis, "window", {
      value: { localStorage: ls },
      writable: true,
    });
  });

  it("returns null when the key is absent", () => {
    expect(readLegacyScope()).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    window.localStorage.setItem(LEGACY_KEY, "{not json");
    expect(readLegacyScope()).toBeNull();
  });

  it("returns null on a non-object payload", () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify("just a string"));
    expect(readLegacyScope()).toBeNull();
  });

  it("returns the parsed scope on a valid payload", () => {
    window.localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({ gens: [1, 3], types: ["fire"], presets: ["starters"] }),
    );
    expect(readLegacyScope()).toEqual({
      gens: [1, 3],
      types: ["fire"],
      presets: ["starters"],
      formCategories: { mode: "all" },
    });
  });

  it("silently fills in missing axes (legacy data without `presets`)", () => {
    window.localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({ gens: [1], types: ["fire"] }),
    );
    expect(readLegacyScope()).toEqual({
      gens: [1],
      types: ["fire"],
      presets: [],
      formCategories: { mode: "all" },
    });
  });

  it("does NOT mutate the key on read (clear is a separate step)", () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify({ gens: [1], types: [], presets: [] }));
    readLegacyScope();
    expect(window.localStorage.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it("clearLegacyScope removes the key and is idempotent when absent", () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify({ gens: [1], types: [], presets: [] }));
    clearLegacyScope();
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
    // Second call must not throw on an already-empty key.
    expect(() => clearLegacyScope()).not.toThrow();
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});

// ─── formCategories ──────────────────────────────────────────────────────────

/**
 * Build a NameReviewCard for an alternate form (e.g. Alolan Raichu).
 * id = 10100 (PokéAPI alternate-form ID), speciesId = 26 (Raichu).
 */
function formCard(
  id: number,
  speciesId: number,
  formCategory: FormCategory,
  types: string[] = ["electric"],
): NameReviewCard {
  return {
    ...nameCard(speciesId, types),
    id,
    speciesId,
    isDefaultForm: false,
    formCategory,
    displayName: `Form-${id}`,
    name: `form-${id}`,
    subjectKey: String(id),
  };
}

/**
 * Build a SeedPokemon entry for an alternate form, for use in
 * `countMatchingSpecies` tests.
 */
function makeFormSeed(
  id: number,
  speciesId: number,
  formCategory: FormCategory,
  types: string[] = ["electric"],
): SeedPokemon {
  return {
    ...makeSeed(speciesId, types),
    id,
    speciesId,
    isDefaultForm: false,
    formCategory,
    formSlug: "alola",
    displayName: `Form-${id}`,
  };
}

describe("formCategories: new users get mode:'all' default", () => {
  it("EMPTY_SCOPE has formCategories mode:'all'", () => {
    expect(EMPTY_SCOPE.formCategories).toEqual({ mode: "all" });
  });

  it("isScopeEmpty is true for EMPTY_SCOPE (formCategories:all does not activate scope)", () => {
    expect(isScopeEmpty(EMPTY_SCOPE)).toBe(true);
  });

  it("isScopeEmpty is false when formCategories is default-only", () => {
    expect(
      isScopeEmpty({ gens: [], types: [], presets: [], formCategories: { mode: "default-only" } }),
    ).toBe(false);
  });

  it("isScopeEmpty is false when formCategories is include", () => {
    expect(
      isScopeEmpty({
        gens: [],
        types: [],
        presets: [],
        formCategories: { mode: "include", categories: ["regional"] },
      }),
    ).toBe(false);
  });
});

describe("formCategories: persisted scope without field migrates to mode:'all'", () => {
  it("cardMatchesScope treats a scope without formCategories as mode:'all'", () => {
    // Pre-#450 scope objects omit the formCategories field.
    const legacyScope = { gens: [1], types: [], presets: [] };
    const alolan = formCard(10100, 26, "regional");
    // scope has gens:[1]; Raichu is Gen 1 — even the form card should pass.
    expect(cardMatchesScope(alolan, legacyScope)).toBe(true);
  });

  it("countMatchingSpecies treats a scope without formCategories as mode:'all'", () => {
    const legacyScope = { gens: [1], types: [], presets: [] };
    const seed: readonly SeedPokemon[] = [
      makeSeed(26, ["electric"]),                      // Raichu (default, Gen I)
      makeFormSeed(10100, 26, "regional", ["electric"]), // Alolan Raichu (form, Gen I)
    ];
    // Both should match since mode defaults to 'all'.
    expect(countMatchingSpecies(seed, legacyScope)).toBe(2);
  });
});

describe("formCategories: default-only filter", () => {
  const scope = { gens: [] as number[], types: [] as string[], presets: [] as PracticeScopePreset[], formCategories: { mode: "default-only" as const } };

  it("matches a default-form card", () => {
    expect(cardMatchesScope(nameCard(26), scope)).toBe(true);
  });

  it("excludes an alternate-form card (Alolan Raichu)", () => {
    const alolan = formCard(10100, 26, "regional");
    expect(cardMatchesScope(alolan, scope)).toBe(false);
  });

  it("excludes a forme card (Rotom-Heat)", () => {
    const rotom = formCard(10008, 479, "forme", ["fire", "electric"]);
    expect(cardMatchesScope(rotom, scope)).toBe(false);
  });

  it("countMatchingSpecies excludes form entries from the count", () => {
    const seed: readonly SeedPokemon[] = [
      makeSeed(26, ["electric"]),                        // Raichu default
      makeFormSeed(10100, 26, "regional", ["electric"]), // Alolan Raichu
      makeSeed(479, ["electric"]),                       // Rotom default
      makeFormSeed(10008, 479, "forme", ["fire", "electric"]), // Rotom-Heat
    ];
    // Only the 2 default forms should match.
    expect(countMatchingSpecies(seed, scope)).toBe(2);
  });
});

describe("formCategories: include regional only", () => {
  const scope = {
    gens: [] as number[],
    types: [] as string[],
    presets: [] as PracticeScopePreset[],
    formCategories: { mode: "include" as const, categories: ["regional"] as FormCategory[] },
  };

  it("matches the default form of a species", () => {
    expect(cardMatchesScope(nameCard(26), scope)).toBe(true);
  });

  it("matches a regional form card", () => {
    const alolan = formCard(10100, 26, "regional");
    expect(cardMatchesScope(alolan, scope)).toBe(true);
  });

  it("excludes a non-regional alternate form (forme)", () => {
    const rotom = formCard(10008, 479, "forme", ["fire", "electric"]);
    expect(cardMatchesScope(rotom, scope)).toBe(false);
  });

  it("countMatchingSpecies counts default + regional but not other forms", () => {
    const seed: readonly SeedPokemon[] = [
      makeSeed(26, ["electric"]),
      makeFormSeed(10100, 26, "regional", ["electric"]),  // match
      makeSeed(479, ["electric"]),
      makeFormSeed(10008, 479, "forme", ["fire", "electric"]), // no match
    ];
    expect(countMatchingSpecies(seed, scope)).toBe(3); // Raichu + Alolan Raichu + Rotom default
  });
});

describe("formCategories: mode:'all' (passthrough)", () => {
  const scope = {
    gens: [1],
    types: [] as string[],
    presets: [] as PracticeScopePreset[],
    formCategories: { mode: "all" as const },
  };

  it("includes a Gen I form card when mode is all", () => {
    // Alolan Raichu: speciesId=26 → Gen I → passes gens:[1]
    const alolan = formCard(10100, 26, "regional");
    expect(cardMatchesScope(alolan, scope)).toBe(true);
  });
});
