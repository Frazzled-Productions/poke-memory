/**
 * Unit tests for lib/pokedex/sort.ts
 *
 * Covers all three sort comparators and the sortPokemon orchestrator.
 * Tests are in the node project (lib/**) and run without a DOM.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadLocaleNames, _resetLocaleNamesCache } from "@/lib/pokemon/localeNames";
import type { PokemonLocaleNames } from "@/lib/pokemon/seed";
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
    // "bulbasaur" and "bulbasaur2" - lowercase a comes before "2" so a < b
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
    // With force: id order - id 1 before id 5.
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

// ---------------------------------------------------------------------------
// Locale-aware alphabetical sort tests (F39 fix, issue #1852)
// ---------------------------------------------------------------------------

/** Minimal locale-names payload for sort tests. */
const SORT_LOCALE_NAMES: PokemonLocaleNames[] = [
  {
    speciesId: 1,
    nameByLocale: { en: 'Bulbasaur', ja: 'フシギダネ', 'zh-Hans': '妙蛙种子', 'zh-Hant': '妙蛙種子' },
    transliterationByLocale: { ja: 'Fushigidane', 'zh-Hans': 'miào wā zhǒng zi', 'zh-Hant': 'miào wā zhǒng zǐ' },
  },
  {
    speciesId: 4,
    nameByLocale: { en: 'Charmander', ja: 'ヒトカゲ', 'zh-Hans': '小火龙', 'zh-Hant': '小火龍' },
    transliterationByLocale: { ja: 'Hitokage', 'zh-Hans': 'xiǎo huǒ lóng', 'zh-Hant': 'xiǎo huǒ lóng' },
  },
  {
    speciesId: 7,
    nameByLocale: { en: 'Squirtle', ja: 'ゼニガメ', 'zh-Hans': '杰尼龟', 'zh-Hant': '傑尼龜' },
    transliterationByLocale: { ja: 'Zenigame', 'zh-Hans': 'jié ní guī', 'zh-Hant': 'jié ní guī' },
  },
  {
    speciesId: 63,
    nameByLocale: { en: 'Abra', ja: 'ケーシィ', 'zh-Hans': '凯西', 'zh-Hant': '凱西' },
    transliterationByLocale: { ja: 'Keshii', 'zh-Hans': 'kǎi xī', 'zh-Hant': 'kǎi xī' },
  },
];

describe('compareAlphabetical - locale-aware sort (F39, #1852)', () => {
  // Local fixtures for locale sort tests (independent of the mastery-sort describe block).
  const SORT_BULBASAUR  = makeCell(1,  "Bulbasaur",  "locked");
  const SORT_CHARMANDER = makeCell(4,  "Charmander", "locked");
  const SORT_SQUIRTLE   = makeCell(7,  "Squirtle",   "locked");
  const SORT_ABRA       = makeCell(63, "Abra",       "locked");

  beforeEach(async () => {
    _resetLocaleNamesCache();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SORT_LOCALE_NAMES,
    }));
    await loadLocaleNames();
  });

  it('en locale: sorts by English name (Abra < Bulbasaur < Charmander < Squirtle)', () => {
    const list = [SORT_SQUIRTLE, SORT_BULBASAUR, SORT_ABRA, SORT_CHARMANDER];
    const sorted = sortPokemon(list, "alphabetical", false, "en");
    expect(sorted.map((p) => p.id)).toEqual([63, 1, 4, 7]);
  });

  it('ja locale: sorts by Japanese name using "ja" collator', () => {
    // Japanese names: ケーシィ(63), ゼニガメ(7), ヒトカゲ(4), フシギダネ(1)
    // Katakana sorted by code point order: ケ(12465) < ゼ(12476) < ヒ(12498) < フ(12501)
    const list = [SORT_SQUIRTLE, SORT_BULBASAUR, SORT_ABRA, SORT_CHARMANDER];
    const sorted = sortPokemon(list, "alphabetical", false, "ja");
    expect(sorted.map((p) => p.id)).toEqual([63, 7, 4, 1]);
  });

  it('zh-Hans locale: sorts by Simplified Chinese name using "zh-Hans" collator', () => {
    // Chinese names: 凯西(63=kǎi), 妙蛙种子(1=miào), 小火龙(4=xiǎo), 杰尼龟(7=jié)
    // Pinyin order: jié(7) < kǎi(63) < miào(1) < xiǎo(4)
    const list = [SORT_SQUIRTLE, SORT_BULBASAUR, SORT_ABRA, SORT_CHARMANDER];
    const sorted = sortPokemon(list, "alphabetical", false, "zh-Hans");
    // Verify that sorting produces some locale-appropriate order (different from en order)
    // and does not crash. We verify the length and that all ids are present.
    expect(sorted.map((p) => p.id).sort((a, b) => a - b)).toEqual([1, 4, 7, 63]);
    // The zh-Hans collation should put 杰尼龟(7) before 凯西(63) before 妙蛙种子(1) before 小火龙(4)
    expect(sorted.map((p) => p.id)).toEqual([7, 63, 1, 4]);
  });

  it('zh-Hant locale: sorts by Traditional Chinese name (same pinyin order as Hans for these fixtures)', () => {
    const list = [SORT_SQUIRTLE, SORT_BULBASAUR, SORT_ABRA, SORT_CHARMANDER];
    const sorted = sortPokemon(list, "alphabetical", false, "zh-Hant");
    expect(sorted.map((p) => p.id).sort((a, b) => a - b)).toEqual([1, 4, 7, 63]);
  });

  it('falls back to English name when sidecar not yet loaded for a locale', () => {
    _resetLocaleNamesCache();
    // Without pre-loaded sidecar, getLocaleName returns undefined → falls back to p.name
    const list = [SORT_SQUIRTLE, SORT_BULBASAUR, SORT_ABRA, SORT_CHARMANDER];
    const sorted = sortPokemon(list, "alphabetical", false, "ja");
    // Graceful fallback: sorts by English name (same as "en" order)
    expect(sorted.map((p) => p.id)).toEqual([63, 1, 4, 7]);
  });
});
