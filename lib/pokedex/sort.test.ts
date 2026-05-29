/**
 * Unit tests for lib/pokedex/sort.ts
 *
 * Covers all three sort comparators and the sortPokemon orchestrator.
 * Tests are in the node project (lib/**) and run without a DOM.
 */

import { describe, it, expect } from "vitest";
import {
  compareByNational,
  compareAlphabetical,
  compareClosestToMastery,
  sortPokemon,
  parseSort,
} from "./sort";
import type { PokemonCellData } from "@/lib/pokemon/filter";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCell(
  id: number,
  name: string,
  cardClass: PokemonCellData["cardClass"] = "locked",
  masteryProgress?: { reps: number; scheduledDays: number },
): PokemonCellData {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: name,
    name,
    spriteUrl: `/sprites/pokemon/${id}.png`,
    types: ["normal"],
    stats: { hp: 1, attack: 1, defense: 1, specialAttack: 1, specialDefense: 1, speed: 1 },
    flavorText: "",
    flavorTexts: [],
    evolutionChain: [],
    height: 1,
    weight: 1,
    baseExperience: 1,
    genus: "",
    generation: "generation-i",
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    cardClass,
    ...(masteryProgress !== undefined ? { masteryProgress } : {}),
  };
}

// ---------------------------------------------------------------------------
// parseSort
// ---------------------------------------------------------------------------

describe("parseSort", () => {
  it('returns "national" for null', () => {
    expect(parseSort(null)).toBe("national");
  });

  it('returns "national" for undefined', () => {
    expect(parseSort(undefined)).toBe("national");
  });

  it('returns "national" for an unknown value', () => {
    expect(parseSort("random")).toBe("national");
  });

  it('returns "alphabetical" for "alphabetical"', () => {
    expect(parseSort("alphabetical")).toBe("alphabetical");
  });

  it('returns "closest-to-mastery" for "closest-to-mastery"', () => {
    expect(parseSort("closest-to-mastery")).toBe("closest-to-mastery");
  });
});

// ---------------------------------------------------------------------------
// compareByNational
// ---------------------------------------------------------------------------

describe("compareByNational", () => {
  it("returns negative when a.id < b.id", () => {
    const a = makeCell(1, "Bulbasaur");
    const b = makeCell(4, "Charmander");
    expect(compareByNational(a, b)).toBeLessThan(0);
  });

  it("returns positive when a.id > b.id", () => {
    const a = makeCell(4, "Charmander");
    const b = makeCell(1, "Bulbasaur");
    expect(compareByNational(a, b)).toBeGreaterThan(0);
  });

  it("returns 0 for equal ids", () => {
    const a = makeCell(1, "Bulbasaur");
    const b = makeCell(1, "Bulbasaur");
    expect(compareByNational(a, b)).toBe(0);
  });

  it("sorts an unsorted list into ascending id order", () => {
    const list = [makeCell(7, "Squirtle"), makeCell(1, "Bulbasaur"), makeCell(4, "Charmander")];
    const sorted = [...list].sort(compareByNational);
    expect(sorted.map((p) => p.id)).toEqual([1, 4, 7]);
  });
});

// ---------------------------------------------------------------------------
// compareAlphabetical
// ---------------------------------------------------------------------------

describe("compareAlphabetical", () => {
  it("returns negative when a.name comes before b.name", () => {
    const a = makeCell(1, "Bulbasaur");
    const b = makeCell(4, "Charmander");
    expect(compareAlphabetical(a, b)).toBeLessThan(0);
  });

  it("returns positive when a.name comes after b.name", () => {
    const a = makeCell(4, "Charmander");
    const b = makeCell(1, "Bulbasaur");
    expect(compareAlphabetical(a, b)).toBeGreaterThan(0);
  });

  it("is case-insensitive", () => {
    const a = makeCell(1, "bulbasaur");
    const b = makeCell(2, "Bulbasaur2");
    // "bulbasaur" and "bulbasaur2" — lowercase a comes before "2" so a < b
    expect(compareAlphabetical(a, b)).toBeLessThan(0);
  });

  it("tie-breaks by national number when names are equal", () => {
    const a = makeCell(1, "SameName");
    const b = makeCell(5, "SameName");
    expect(compareAlphabetical(a, b)).toBeLessThan(0);
  });

  it("sorts a mixed list alphabetically", () => {
    const list = [
      makeCell(7, "Squirtle"),
      makeCell(1, "Bulbasaur"),
      makeCell(4, "Charmander"),
      makeCell(25, "Pikachu"),
    ];
    const sorted = [...list].sort(compareAlphabetical);
    expect(sorted.map((p) => p.name)).toEqual(["Bulbasaur", "Charmander", "Pikachu", "Squirtle"]);
  });

  it("handles accented characters in locale-aware order", () => {
    // Flabébé (é) should sort after Flareon (a) when using locale-aware comparison
    const a = makeCell(669, "Flabébé");
    const b = makeCell(136, "Flareon");
    // "b" < "r" in both locale and simple comparisons
    expect(compareAlphabetical(a, b)).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// compareClosestToMastery
// ---------------------------------------------------------------------------

describe("compareClosestToMastery", () => {
  // Mastered species should sort before learning, learning before locked.
  it("mastered species sorts before learning species", () => {
    const mastered = makeCell(1, "Bulbasaur", "mastered");
    const learning = makeCell(4, "Charmander", "learning", { reps: 2, scheduledDays: 10 });
    expect(compareClosestToMastery(mastered, learning, false)).toBeLessThan(0);
  });

  it("learning species sorts before locked species", () => {
    const learning = makeCell(4, "Charmander", "learning", { reps: 1, scheduledDays: 1 });
    const locked = makeCell(7, "Squirtle", "locked");
    expect(compareClosestToMastery(learning, locked, false)).toBeLessThan(0);
  });

  it("mastered species sorts before locked species", () => {
    const mastered = makeCell(1, "Bulbasaur", "mastered");
    const locked = makeCell(7, "Squirtle", "locked");
    expect(compareClosestToMastery(mastered, locked, false)).toBeLessThan(0);
  });

  it("within learning tier, higher reps sorts first", () => {
    const highReps = makeCell(1, "A", "learning", { reps: 5, scheduledDays: 10 });
    const lowReps = makeCell(2, "B", "learning", { reps: 1, scheduledDays: 10 });
    expect(compareClosestToMastery(highReps, lowReps, false)).toBeLessThan(0);
  });

  it("within learning tier with equal reps, higher scheduledDays sorts first", () => {
    const highDays = makeCell(1, "A", "learning", { reps: 3, scheduledDays: 15 });
    const lowDays = makeCell(2, "B", "learning", { reps: 3, scheduledDays: 5 });
    expect(compareClosestToMastery(highDays, lowDays, false)).toBeLessThan(0);
  });

  it("within learning tier with equal reps and scheduledDays, sorts by id ascending", () => {
    const a = makeCell(1, "A", "learning", { reps: 3, scheduledDays: 10 });
    const b = makeCell(5, "B", "learning", { reps: 3, scheduledDays: 10 });
    expect(compareClosestToMastery(a, b, false)).toBeLessThan(0);
  });

  it("within mastered tier, sorts by id ascending", () => {
    const a = makeCell(1, "A", "mastered");
    const b = makeCell(5, "B", "mastered");
    expect(compareClosestToMastery(a, b, false)).toBeLessThan(0);
  });

  it("within locked tier, sorts by id ascending", () => {
    const a = makeCell(1, "A", "locked");
    const b = makeCell(5, "B", "locked");
    expect(compareClosestToMastery(a, b, false)).toBeLessThan(0);
  });

  it("learning species without masteryProgress defaults to reps=0, days=0", () => {
    // Learning species with no masteryProgress set should sort after a learning
    // species with high progress.
    const highProgress = makeCell(2, "B", "learning", { reps: 5, scheduledDays: 15 });
    const noProgress = makeCell(1, "A", "learning"); // no masteryProgress
    expect(compareClosestToMastery(highProgress, noProgress, false)).toBeLessThan(0);
  });

  // forceAllMastered path
  it("when forceAllMastered is true, degenerates to national-number order", () => {
    const locked = makeCell(1, "A", "locked");
    const mastered = makeCell(5, "B", "mastered");
    // Without force: mastered(5) should come before locked(1) since mastered tier < locked tier.
    // With force: id order — id 1 before id 5.
    expect(compareClosestToMastery(locked, mastered, true)).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// sortPokemon orchestrator
// ---------------------------------------------------------------------------

describe("sortPokemon", () => {
  const BULBASAUR = makeCell(1, "Bulbasaur", "mastered");
  const CHARMANDER = makeCell(4, "Charmander", "learning", { reps: 3, scheduledDays: 10 });
  const SQUIRTLE = makeCell(7, "Squirtle", "locked");
  const ABRA = makeCell(63, "Abra", "learning", { reps: 1, scheduledDays: 2 });

  it('national sort returns ascending id order', () => {
    const list = [SQUIRTLE, BULBASAUR, ABRA, CHARMANDER];
    const sorted = sortPokemon(list, "national", false);
    expect(sorted.map((p) => p.id)).toEqual([1, 4, 7, 63]);
  });

  it('alphabetical sort returns name-sorted order', () => {
    const list = [SQUIRTLE, BULBASAUR, ABRA, CHARMANDER];
    const sorted = sortPokemon(list, "alphabetical", false);
    expect(sorted.map((p) => p.name)).toEqual(["Abra", "Bulbasaur", "Charmander", "Squirtle"]);
  });

  it('closest-to-mastery sort returns mastered first, then learning by progress, then locked', () => {
    const list = [SQUIRTLE, BULBASAUR, ABRA, CHARMANDER];
    const sorted = sortPokemon(list, "closest-to-mastery", false);
    // Bulbasaur: mastered; Charmander: learning reps=3; Abra: learning reps=1; Squirtle: locked
    expect(sorted.map((p) => p.name)).toEqual(["Bulbasaur", "Charmander", "Abra", "Squirtle"]);
  });

  it('does not mutate the input array', () => {
    const list = [SQUIRTLE, BULBASAUR, CHARMANDER];
    const copy = [...list];
    sortPokemon(list, "alphabetical", false);
    expect(list).toEqual(copy);
  });

  it('closest-to-mastery with forceAllMastered degenerates to national order', () => {
    const list = [SQUIRTLE, BULBASAUR, ABRA, CHARMANDER];
    const sorted = sortPokemon(list, "closest-to-mastery", true);
    expect(sorted.map((p) => p.id)).toEqual([1, 4, 7, 63]);
  });
});
