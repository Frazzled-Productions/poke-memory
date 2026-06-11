import { describe, it, expect } from "vitest";
import {
  validateSpeciesCount,
  validateSpeciesIds,
  validateShards,
  validateShardParity,
  validateSprites,
  validateLocaleNames,
  formatIdList,
  SUPPORTED_LOCALES,
  CANONICAL_SPRITE_SIZE,
} from "./seed-validate.mjs";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal generated.json records: 3 total (2 default-form species + 1 alt form).
 * Records include flavorTexts so the flavor-shard check works correctly.
 */
const GENERATED = [
  { id: 1, speciesId: 1, isDefaultForm: true, flavorTexts: [{ text: "A strange seed.", versions: ["red"] }] },
  { id: 2, speciesId: 2, isDefaultForm: true, flavorTexts: [{ text: "A plant.", versions: ["red"] }] },
  { id: 10001, speciesId: 1, isDefaultForm: false, flavorTexts: [{ text: "An alt form.", versions: ["sword"] }] },
];

/** Generated records where one entry has no flavorTexts (should be excluded from flavor check). */
const GENERATED_WITH_FLAVOURLESS = [
  { id: 1, speciesId: 1, isDefaultForm: true, flavorTexts: [{ text: "A strange seed.", versions: ["red"] }] },
  { id: 2, speciesId: 2, isDefaultForm: true, flavorTexts: [] }, // intentionally no flavor
  { id: 10001, speciesId: 1, isDefaultForm: false, flavorTexts: [{ text: "An alt form.", versions: ["sword"] }] },
];

const CORE_OK = [{ id: 1 }, { id: 2 }, { id: 10001 }];
const FLAVOR_OK = [{ id: 1 }, { id: 2 }, { id: 10001 }];
// CHAINS_OK must have at least one chain node with speciesId > 10000 to pass the form-edge check.
const CHAINS_OK = {
  chains: {
    abc12345: [
      { speciesId: 1, evolvesFromId: null },
      { speciesId: 10001, evolvesFromId: 1 }, // form-aware edge (id > 10000)
    ],
  },
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

  it("returns five results (core / chains-coverage / chains-form-edge / flavor / locale)", () => {
    expect(results).toHaveLength(5);
  });

  it("all results are ok", () => {
    for (const r of results) {
      expect(r.ok).toBe(true);
    }
  });

  it("core result mentions the record count", () => {
    expect(results[0].message).toContain("3");
  });

  it("chains-coverage result mentions pokemonChain", () => {
    expect(results[1].message).toContain("pokemonChain");
  });

  it("chains-form-edge result confirms form-aware edge", () => {
    expect(results[2].ok).toBe(true);
    expect(results[2].message).toContain("form-aware edge");
  });

  it("flavor result mentions the records-with-flavor count", () => {
    // All 3 records in GENERATED have flavorTexts, so the count is 3.
    expect(results[3].message).toContain("3");
  });

  it("locale result mentions the default-form species count", () => {
    // 2 default-form species in GENERATED
    expect(results[4].message).toContain("2");
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
    expect(results[1].ok).toBe(true); // chains-coverage
    expect(results[2].ok).toBe(true); // chains-form-edge
    expect(results[3].ok).toBe(true); // flavor
    expect(results[4].ok).toBe(true); // locale
  });
});

describe("validateShards - chains shard missing an entry", () => {
  // chains.chains is empty so no form-aware edge, and pokemonChain missing id 10001.
  const chainsMissing = {
    chains: { abc: [{ speciesId: 10002, evolvesFromId: 1 }] }, // has form edge but missing pokemonChain id
    pokemonChain: { "1": "abc", "2": "abc" }, // missing 10001
  };
  const results = validateShards(GENERATED, CORE_OK, FLAVOR_OK, chainsMissing, LOCALE_OK);

  it("chains-coverage result is not ok", () => {
    expect(results[1].ok).toBe(false);
  });

  it("failure message mentions the missing ID", () => {
    expect(results[1].message).toContain("10001");
  });
});

describe("validateShards - flavor shard missing an entry", () => {
  const flavorMissing = [{ id: 1 }, { id: 10001 }]; // missing id 2
  const results = validateShards(GENERATED, CORE_OK, flavorMissing, CHAINS_OK, LOCALE_OK);

  it("flavor result is not ok (id=2 has flavorTexts and is absent from shard)", () => {
    expect(results[3].ok).toBe(false);
  });

  it("failure message mentions the missing ID", () => {
    expect(results[3].message).toContain("2");
  });
});

describe("validateShards - flavor shard: flavourless record absent is OK (F58)", () => {
  // id=2 has empty flavorTexts; it should NOT be required in the flavor shard.
  const flavorWithoutId2 = [{ id: 1 }, { id: 10001 }]; // id=2 intentionally absent
  const results = validateShards(GENERATED_WITH_FLAVOURLESS, CORE_OK, flavorWithoutId2, CHAINS_OK, LOCALE_OK);

  it("flavor result is ok when the absent id has no flavorTexts", () => {
    expect(results[3].ok).toBe(true);
  });

  it("flavor message mentions the 2 records with flavor (not all 3)", () => {
    expect(results[3].message).toContain("2 records");
  });
});

describe("validateShards - locale-names shard missing an entry", () => {
  const localeMissing = [
    { speciesId: 1, nameByLocale: { en: "Bulbasaur", ja: "フシギダネ", "zh-Hans": "妙蛙种子", "zh-Hant": "妙蛙種子" } },
    // missing speciesId 2
  ];
  const results = validateShards(GENERATED, CORE_OK, FLAVOR_OK, CHAINS_OK, localeMissing);

  it("locale result is not ok (result index 4)", () => {
    expect(results[4].ok).toBe(false);
  });

  it("failure message mentions the missing species ID", () => {
    expect(results[4].message).toContain("2");
  });

  it("failure message mentions seed:split or seed:locale-names", () => {
    expect(results[4].message).toMatch(/seed:split|seed:locale-names/);
  });
});

describe("validateShards - alternate-form record absent from locale-names (correct behaviour)", () => {
  // Species 1 has an alternate form (id 10001). Locale-names only covers the
  // default form (speciesId 1), so having speciesId 1 present but no 10001
  // entry should pass the locale-names check.
  it("locale check passes when only default-form species are present", () => {
    const results = validateShards(GENERATED, CORE_OK, FLAVOR_OK, CHAINS_OK, LOCALE_OK);
    expect(results[4].ok).toBe(true);
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
// validateShards - form-aware edge check (F17)
// ---------------------------------------------------------------------------

describe("validateShards - form-aware edge check (F17)", () => {
  // Chains with NO id > 10000 in any chain node - form-edge check must fail.
  const chainsNoFormEdge = {
    chains: {
      abc: [{ speciesId: 1, evolvesFromId: null }, { speciesId: 2, evolvesFromId: 1 }],
    },
    pokemonChain: { "1": "abc", "2": "abc", "10001": "abc" },
  };

  it("form-edge check fails when no chain node has id > 10000", () => {
    const results = validateShards(GENERATED, CORE_OK, FLAVOR_OK, chainsNoFormEdge, LOCALE_OK);
    expect(results[2].ok).toBe(false);
  });

  it("failure message explains form-aware edge generation", () => {
    const results = validateShards(GENERATED, CORE_OK, FLAVOR_OK, chainsNoFormEdge, LOCALE_OK);
    expect(results[2].message).toContain("form-aware");
  });

  it("form-edge check passes when a chain node has speciesId > 10000", () => {
    const results = validateShards(GENERATED, CORE_OK, FLAVOR_OK, CHAINS_OK, LOCALE_OK);
    expect(results[2].ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateShards - empty-chain regression check (F18)
// ---------------------------------------------------------------------------

describe("validateShards - empty-chain regression check (F18)", () => {
  // Prior chains has a non-empty chain for id 1; current has an empty chain.
  const priorChainsNonEmpty = {
    chains: { hash1: [{ speciesId: 1, evolvesFromId: null }, { speciesId: 2, evolvesFromId: 1 }] },
    pokemonChain: { "1": "hash1", "2": "hash1", "10001": "hash1" },
  };
  const currentChainsEmpty = {
    chains: { emptyHash: [], "form-ok": [{ speciesId: 10001, evolvesFromId: 1 }] },
    pokemonChain: { "1": "emptyHash", "2": "emptyHash", "10001": "form-ok" },
  };

  it("empty-chain regression check fails when a previously non-empty chain is now empty", () => {
    const results = validateShards(GENERATED, CORE_OK, FLAVOR_OK, currentChainsEmpty, LOCALE_OK, priorChainsNonEmpty);
    const regressionResult = results.find((r) => r.message.includes("non-empty chain"));
    expect(regressionResult).toBeDefined();
    expect(regressionResult.ok).toBe(false);
  });

  it("failure message names the regressed IDs", () => {
    const results = validateShards(GENERATED, CORE_OK, FLAVOR_OK, currentChainsEmpty, LOCALE_OK, priorChainsNonEmpty);
    const regressionResult = results.find((r) => r.message.includes("non-empty chain"));
    // IDs 1 and 2 previously mapped to the non-empty chain.
    expect(regressionResult.message).toContain("1");
  });

  it("empty-chain regression check passes when priorChainsData is null (skipped)", () => {
    const results = validateShards(GENERATED, CORE_OK, FLAVOR_OK, CHAINS_OK, LOCALE_OK, null);
    // Should not have a regression-check result at all.
    const regressionResult = results.find((r) => r.message.includes("non-empty chain"));
    expect(regressionResult).toBeUndefined();
  });

  it("passes when all previously non-empty chains are still non-empty", () => {
    const results = validateShards(GENERATED, CORE_OK, FLAVOR_OK, CHAINS_OK, LOCALE_OK, CHAINS_OK);
    const regressionResult = results.find((r) => r.message.includes("non-empty chain"));
    expect(regressionResult).toBeDefined();
    expect(regressionResult.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateSpeciesIds (F46)
// ---------------------------------------------------------------------------

describe("validateSpeciesIds - set-membership check", () => {
  it("passes when no prior ids (fresh checkout)", () => {
    const result = validateSpeciesIds([1, 2, 3], []);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("skipped");
  });

  it("passes when all prior ids are still present", () => {
    const result = validateSpeciesIds([1, 2, 3], [1, 2, 3]);
    expect(result.ok).toBe(true);
  });

  it("passes when new ids are added (additive run)", () => {
    const result = validateSpeciesIds([1, 2, 3, 4], [1, 2, 3]);
    expect(result.ok).toBe(true);
  });

  it("fails when a prior id has disappeared", () => {
    const result = validateSpeciesIds([1, 3], [1, 2, 3]);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("2");
  });

  it("failure message names all dropped ids", () => {
    const result = validateSpeciesIds([3], [1, 2, 3]);
    expect(result.message).toContain("1");
    expect(result.message).toContain("2");
  });

  it("passes when a dropped id is in the removal allowlist", () => {
    const result = validateSpeciesIds([1, 3], [1, 2, 3], [2]);
    expect(result.ok).toBe(true);
  });

  it("fails when a dropped id is NOT in the removal allowlist", () => {
    const result = validateSpeciesIds([1, 3], [1, 2, 3], [99]);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("2");
  });
});

// ---------------------------------------------------------------------------
// validateShardParity (F47)
// ---------------------------------------------------------------------------

describe("validateShardParity - lib and public copies match", () => {
  const shards = ["generated-core.json", "generated-chains.json", "generated-flavor.json", "generated-locale-names.json"];

  it("passes when all four shards are byte-identical", () => {
    const readFn = (path) => `{"content":"same"}`;
    const results = validateShardParity("/lib/pokemon", "/public/pokemon-data", readFn);
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.ok).toBe(true);
    }
  });

  it("fails when lib copy is missing", () => {
    const readFn = (path) => path.includes("/lib/") ? null : `{"x":1}`;
    const results = validateShardParity("/lib/pokemon", "/public/pokemon-data", readFn);
    for (const r of results) {
      expect(r.ok).toBe(false);
      expect(r.message).toContain("lib/pokemon");
    }
  });

  it("fails when public copy is missing", () => {
    const readFn = (path) => path.includes("/public/") ? null : `{"x":1}`;
    const results = validateShardParity("/lib/pokemon", "/public/pokemon-data", readFn);
    for (const r of results) {
      expect(r.ok).toBe(false);
      expect(r.message).toContain("public/pokemon-data");
    }
  });

  it("fails when lib and public copies differ", () => {
    let call = 0;
    const readFn = () => call++ % 2 === 0 ? `{"a":1}` : `{"b":2}`;
    const results = validateShardParity("/lib/pokemon", "/public/pokemon-data", readFn);
    for (const r of results) {
      expect(r.ok).toBe(false);
      expect(r.message).toContain("differs");
    }
  });

  it("reports the shard filename in every result message", () => {
    const readFn = () => `{}`;
    const results = validateShardParity("/lib/pokemon", "/public/pokemon-data", readFn);
    for (let i = 0; i < results.length; i++) {
      expect(results[i].message).toContain(shards[i]);
    }
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
