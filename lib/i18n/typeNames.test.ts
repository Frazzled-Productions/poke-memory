/**
 * Unit tests for lib/i18n/typeNames.ts
 *
 * getTypeName() is a pure function that delegates to a `t` function from
 * useTranslations("types"). These tests exercise all 18 types in all 4
 * supported locales (en / ja / zh-Hans / zh-Hant) using the real message
 * catalogues to guard against catalogue drift.
 *
 * The node environment is sufficient because getTypeName has no DOM dependency.
 */

import { describe, it, expect } from "vitest";
import { getTypeName } from "@/lib/i18n/typeNames";
import type { TypeTranslations } from "@/lib/i18n/typeNames";

import enMessages from "@/messages/en.json";
import jaMessages from "@/messages/ja.json";
import zhHansMessages from "@/messages/zh-Hans.json";
import zhHantMessages from "@/messages/zh-Hant.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a TypeTranslations function backed by a real catalogue object.
 * Mimics what next-intl's `useTranslations("types")` returns.
 */
function makeT(catalogue: { types: Record<string, string> }): TypeTranslations {
  return (key) => catalogue.types[key] ?? key;
}

const tEn = makeT(enMessages as { types: Record<string, string> });
const tJa = makeT(jaMessages as { types: Record<string, string> });
const tZhHans = makeT(zhHansMessages as { types: Record<string, string> });
const tZhHant = makeT(zhHantMessages as { types: Record<string, string> });

// ---------------------------------------------------------------------------
// Spot-check each locale with a representative type (Fire)
// ---------------------------------------------------------------------------

describe("getTypeName - locale coverage (fire)", () => {
  it("returns 'Fire' in English", () => {
    expect(getTypeName("fire", tEn)).toBe("Fire");
  });

  it("returns 'ほのお' in Japanese", () => {
    expect(getTypeName("fire", tJa)).toBe("ほのお");
  });

  it("returns '火' in Simplified Chinese", () => {
    expect(getTypeName("fire", tZhHans)).toBe("火");
  });

  it("returns '火' in Traditional Chinese", () => {
    expect(getTypeName("fire", tZhHant)).toBe("火");
  });
});

// ---------------------------------------------------------------------------
// All 18 types - English catalogue completeness
// ---------------------------------------------------------------------------

describe("getTypeName - all 18 types in English", () => {
  const expected: Record<string, string> = {
    bug: "Bug", dark: "Dark", dragon: "Dragon", electric: "Electric",
    fairy: "Fairy", fighting: "Fighting", fire: "Fire", flying: "Flying",
    ghost: "Ghost", grass: "Grass", ground: "Ground", ice: "Ice",
    normal: "Normal", poison: "Poison", psychic: "Psychic",
    rock: "Rock", steel: "Steel", water: "Water",
  };
  for (const [type, name] of Object.entries(expected)) {
    it(`returns '${name}' for '${type}'`, () => {
      expect(getTypeName(type, tEn)).toBe(name);
    });
  }
});

// ---------------------------------------------------------------------------
// All 18 types - Japanese catalogue completeness
// ---------------------------------------------------------------------------

describe("getTypeName - all 18 types in Japanese", () => {
  const expected: Record<string, string> = {
    bug: "むし", dark: "あく", dragon: "ドラゴン", electric: "でんき",
    fairy: "フェアリー", fighting: "かくとう", fire: "ほのお", flying: "ひこう",
    ghost: "ゴースト", grass: "くさ", ground: "じめん", ice: "こおり",
    normal: "ノーマル", poison: "どく", psychic: "エスパー",
    rock: "いわ", steel: "はがね", water: "みず",
  };
  for (const [type, name] of Object.entries(expected)) {
    it(`returns '${name}' for '${type}'`, () => {
      expect(getTypeName(type, tJa)).toBe(name);
    });
  }
});

// ---------------------------------------------------------------------------
// All 18 types - Simplified Chinese catalogue completeness
// ---------------------------------------------------------------------------

describe("getTypeName - all 18 types in Simplified Chinese", () => {
  const expected: Record<string, string> = {
    bug: "虫", dark: "恶", dragon: "龙", electric: "电",
    fairy: "妖精", fighting: "格斗", fire: "火", flying: "飞行",
    ghost: "幽灵", grass: "草", ground: "地面", ice: "冰",
    normal: "一般", poison: "毒", psychic: "超能力",
    rock: "岩石", steel: "钢", water: "水",
  };
  for (const [type, name] of Object.entries(expected)) {
    it(`returns '${name}' for '${type}'`, () => {
      expect(getTypeName(type, tZhHans)).toBe(name);
    });
  }
});

// ---------------------------------------------------------------------------
// All 18 types - Traditional Chinese catalogue completeness
// ---------------------------------------------------------------------------

describe("getTypeName - all 18 types in Traditional Chinese", () => {
  const expected: Record<string, string> = {
    bug: "蟲", dark: "惡", dragon: "龍", electric: "電",
    fairy: "妖精", fighting: "格鬥", fire: "火", flying: "飛行",
    ghost: "幽靈", grass: "草", ground: "地面", ice: "冰",
    normal: "一般", poison: "毒", psychic: "超能力",
    rock: "岩石", steel: "鋼", water: "水",
  };
  for (const [type, name] of Object.entries(expected)) {
    it(`returns '${name}' for '${type}'`, () => {
      expect(getTypeName(type, tZhHant)).toBe(name);
    });
  }
});
