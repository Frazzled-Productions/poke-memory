import { describe, it, expect } from "vitest";
import {
  validateSpeciesCount,
  validateShards,
  validateSprites,
  validateLocaleNames,
  formatIdList,
  SUPPORTED_LOCALES,
  CANONICAL_SPRITE_SIZE,
} from "./seed-validate.mjs";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal generated.json records: 3 total (2 default-form species + 1 alt form). */
const GENERATED = [
  { id: 1, speciesId: 1, isDefaultForm: true },
  { id: 2, speciesId: 2, isDefaultForm: true },
  { id: 10001, speciesId: 1, isDefaultForm: false }, // alternate form of species 1
];

const CORE_OK = [{ id: 1 }, { id: 2 }, { id: 10001 }];
const FLAVOR_OK = [{ id: 1 }, { id: 2 }, { id: 10001 }];
const CHAINS_OK = {
  chains: { abc12345: [] },
  pokemonChain: { "1": "abc12345", "2": "abc12345", "10001": "abc12345" },
};
const LOCALE_OK = [
  {
    speciesId: 1,
    nameByLocale: { en: "Bulbasaur", ja: "フシギダネ", "zh-Hans": "妙蛙种子", "zh-Hant": "妙蛙種子" },
  },
  {
    speciesId: 2,
    nameByLocale: { en: "Ivysaur", ja: "フシギソウ", "zh-Hans": "妙蛙草", "zh-Hant": "妙蛙草" },
  },
];

/** An existsSync stub that always says the file exists. */
const existsAlways = () => true;
/** An existsSync stub that always says the file is missing. */
const existsNever = () => false;
/** Build a stub that returns true only for IDs in the allowSet. */
function existsFor(allowedIds) {
  return (path) => allowedIds.some((id) => path.includes(`/${id}/`));
}

// ---------------------------------------------------------------------------
// validateSpeciesCount
// ---------------------------------------------------------------------------

describe("validateSpeciesCount", () => {
  it("passes when count is equal to pre-seed count", () => {
    const result = validateSpeciesCount(100, 100);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("100");
  });

  it("passes when count grew (additive run with new species)", () => {
    const result = validateSpeciesCount(1026, 1025);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("grew from 1025");
  });

  it("passes when pre-seed count is 0 (fresh checkout)", () => {
    const result = validateSpeciesCount(1025, 0);
    expect(result.ok).toBe(true);
  });

  it("fails when count shrank", () => {
    const result = validateSpeciesCount(900, 1025);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("shrank from 1025 to 900");
  });

  it("failure message mentions npm run seed:all", () => {
    const result = validateSpeciesCount(0, 10);
    expect(result.message).toContain("seed:all");
  });
});

// ---------------------------------------------------------------------------
// validateShards
// ---------------------------------------------------------------------------

describe("validateShards - happy path (all shards complete)", () => {
  const results = validateShards(GENERATED, CORE_OK, FLAVOR_OK, CHAINS_OK, LOCALE_OK);

  it("returns four results", () => {
    expect(results).toHaveLength(4);
  });

  it("all results are ok", () => {
    for (const r of results) {
      expect(r.ok).toBe(true);
    }
  });

  it("core result mentions the record count", () => {
    expect(results[0].message).toContain("3");
  });

  it("chains result mentions pokemonChain", () => {
    expect(results[1].message).toContain("pokemonChain");
  });

  it("flavor result mentions the record count", () => {
    expect(results[2].message).toContain("3");
  });

  it("locale result mentions the default-form species count", () => {
    // 2 default-form species in GENERATED
    expect(results[3].message).toContain("2");
  });
});

describe("validateShards - core shard missing an entry", () => {
  const coreMissing = [{ id: 1 }, { id: 2 }]; // missing id 10001
  const results = validateShards(GENERATED, coreMissing, FLAVOR_OK, CHAINS_OK, LOCALE_OK);

  it("core result is not ok", () => {
    expect(results[0].ok).toBe(false);
  });

  it("failure message mentions the missing ID", () => {
    expect(results[0].message).toContain("10001");
  });

  it("failure message mentions seed:split re-run", () => {
    expect(results[0].message).toContain("seed:split");
  });

  it("other shard results remain ok", () => {
    expect(results[1].ok).toBe(true);
    expect(results[2].ok).toBe(true);
    expect(results[3].ok).toBe(true);
  });
});

describe("validateShards - chains shard missing an entry", () => {
  const chainsMissing = {
    chains: {},
    pokemonChain: { "1": "abc", "2": "abc" }, // missing 10001
  };
  const results = validateShards(GENERATED, CORE_OK, FLAVOR_OK, chainsMissing, LOCALE_OK);

  it("chains result is not ok", () => {
    expect(results[1].ok).toBe(false);
  });

  it("failure message mentions the missing ID", () => {
    expect(results[1].message).toContain("10001");
  });
});

describe("validateShards - flavor shard missing an entry", () => {
  const flavorMissing = [{ id: 1 }, { id: 10001 }]; // missing id 2
  const results = validateShards(GENERATED, CORE_OK, flavorMissing, CHAINS_OK, LOCALE_OK);

  it("flavor result is not ok", () => {
    expect(results[2].ok).toBe(false);
  });

  it("failure message mentions the missing ID", () => {
    expect(results[2].message).toContain("2");
  });
});

describe("validateShards - locale-names shard missing an entry", () => {
  const localeMissing = [
    { speciesId: 1, nameByLocale: { en: "Bulbasaur", ja: "フシギダネ", "zh-Hans": "妙蛙种子", "zh-Hant": "妙蛙種子" } },
    // missing speciesId 2
  ];
  const results = validateShards(GENERATED, CORE_OK, FLAVOR_OK, CHAINS_OK, localeMissing);

  it("locale result is not ok", () => {
    expect(results[3].ok).toBe(false);
  });

  it("failure message mentions the missing species ID", () => {
    expect(results[3].message).toContain("2");
  });

  it("failure message mentions seed:split or seed:locale-names", () => {
    expect(results[3].message).toMatch(/seed:split|seed:locale-names/);
  });
});

describe("validateShards - alternate-form record absent from locale-names (correct behaviour)", () => {
  // Species 1 has an alternate form (id 10001). Locale-names only covers the
  // default form (speciesId 1), so having speciesId 1 present but no 10001
  // entry should pass the locale-names check.
  it("locale check passes when only default-form species are present", () => {
    const results = validateShards(GENERATED, CORE_OK, FLAVOR_OK, CHAINS_OK, LOCALE_OK);
    expect(results[3].ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateSprites
// ---------------------------------------------------------------------------

describe("validateSprites - all sprites present", () => {
  const defaultIds = [1, 2];

  it("returns ok when existsSync always returns true", () => {
    const result = validateSprites(defaultIds, "/fake/webp", existsAlways);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("2 default-form species");
  });

  it("message mentions the canonical size", () => {
    const result = validateSprites(defaultIds, "/fake/webp", existsAlways);
    expect(result.message).toContain(String(CANONICAL_SPRITE_SIZE));
  });
});

describe("validateSprites - some sprites missing", () => {
  const defaultIds = [1, 2, 3];

  it("returns not ok when any sprite is missing", () => {
    // Only species 1 and 2 exist; 3 is missing.
    const result = validateSprites(defaultIds, "/fake/webp", existsFor([1, 2]));
    expect(result.ok).toBe(false);
  });

  it("failure message names the missing species ID", () => {
    const result = validateSprites(defaultIds, "/fake/webp", existsFor([1, 2]));
    expect(result.message).toContain("3");
  });

  it("failure message mentions seed:sprites re-run", () => {
    const result = validateSprites(defaultIds, "/fake/webp", existsFor([1, 2]));
    expect(result.message).toContain("seed:sprites");
  });
});

describe("validateSprites - all sprites missing", () => {
  const defaultIds = [1, 2];

  it("returns not ok", () => {
    const result = validateSprites(defaultIds, "/fake/webp", existsNever);
    expect(result.ok).toBe(false);
  });

  it("failure message mentions both IDs", () => {
    const result = validateSprites(defaultIds, "/fake/webp", existsNever);
    expect(result.message).toContain("1");
    expect(result.message).toContain("2");
  });
});

describe("validateSprites - path construction", () => {
  it("checks the correct path format: {webpRoot}/{id}/{size}.webp", () => {
    const checkedPaths = [];
    const spy = (path) => { checkedPaths.push(path); return true; };
    validateSprites([42], "/base/webp", spy);
    expect(checkedPaths).toEqual([`/base/webp/42/${CANONICAL_SPRITE_SIZE}.webp`]);
  });
});

// ---------------------------------------------------------------------------
// validateLocaleNames
// ---------------------------------------------------------------------------

describe("validateLocaleNames - all locales present", () => {
  it("returns one result per locale", () => {
    const results = validateLocaleNames(LOCALE_OK);
    expect(results).toHaveLength(SUPPORTED_LOCALES.length);
  });

  it("all results are ok", () => {
    for (const r of validateLocaleNames(LOCALE_OK)) {
      expect(r.ok).toBe(true);
    }
  });

  it("each ok message names the locale", () => {
    const results = validateLocaleNames(LOCALE_OK);
    for (let i = 0; i < SUPPORTED_LOCALES.length; i++) {
      expect(results[i].message).toContain(SUPPORTED_LOCALES[i]);
    }
  });
});

describe("validateLocaleNames - English-fallback name is acceptable", () => {
  // Legitimately, PokéAPI may have no Japanese name for a species; the seed
  // script falls back to the English name.  The validator must NOT flag this.
  const localeWithFallback = [
    {
      speciesId: 1,
      nameByLocale: { en: "Bulbasaur", ja: "Bulbasaur", "zh-Hans": "妙蛙种子", "zh-Hant": "妙蛙種子" },
    },
  ];

  it("passes even when ja name equals English fallback", () => {
    const results = validateLocaleNames(localeWithFallback);
    const jaResult = results.find((r) => r.message.includes("ja"));
    expect(jaResult.ok).toBe(true);
  });
});

describe("validateLocaleNames - missing locale key", () => {
  const localeWithMissing = [
    {
      speciesId: 1,
      nameByLocale: { en: "Bulbasaur", "zh-Hans": "妙蛙种子", "zh-Hant": "妙蛙種子" },
      // "ja" key absent
    },
    {
      speciesId: 2,
      nameByLocale: { en: "Ivysaur", ja: "フシギソウ", "zh-Hans": "妙蛙草", "zh-Hant": "妙蛙草" },
    },
  ];

  it("returns not ok for the locale with the missing key", () => {
    const results = validateLocaleNames(localeWithMissing, ["ja"]);
    expect(results[0].ok).toBe(false);
  });

  it("failure message names the locale and the species ID", () => {
    const results = validateLocaleNames(localeWithMissing, ["ja"]);
    expect(results[0].message).toContain("ja");
    expect(results[0].message).toContain("1");
  });

  it("failure message mentions seed:locale-names re-run", () => {
    const results = validateLocaleNames(localeWithMissing, ["ja"]);
    expect(results[0].message).toContain("seed:locale-names");
  });
});

describe("validateLocaleNames - empty string locale value", () => {
  const localeWithEmpty = [
    {
      speciesId: 3,
      nameByLocale: { en: "Venusaur", ja: "", "zh-Hans": "妙蛙花", "zh-Hant": "妙蛙花" },
    },
  ];

  it("returns not ok when a locale name is an empty string", () => {
    const results = validateLocaleNames(localeWithEmpty, ["ja"]);
    expect(results[0].ok).toBe(false);
  });

  it("failure message mentions the species ID", () => {
    const results = validateLocaleNames(localeWithEmpty, ["ja"]);
    expect(results[0].message).toContain("3");
  });
});

describe("validateLocaleNames - custom locale list", () => {
  it("checks only the locales supplied", () => {
    const results = validateLocaleNames(LOCALE_OK, ["ja"]);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatIdList
// ---------------------------------------------------------------------------

describe("formatIdList", () => {
  it("returns all IDs when list is short", () => {
    expect(formatIdList([1, 2, 3])).toBe("1, 2, 3");
  });

  it("truncates when more than 10 IDs", () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const output = formatIdList(ids);
    expect(output).toContain("and 2 more");
    expect(output).toContain("1");
    expect(output).toContain("10");
    expect(output).not.toContain("11");
  });

  it("does not truncate exactly 10 IDs", () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const output = formatIdList(ids);
    expect(output).not.toContain("more");
    expect(output).toContain("10");
  });

  it("returns empty string for empty array", () => {
    expect(formatIdList([])).toBe("");
  });
});
