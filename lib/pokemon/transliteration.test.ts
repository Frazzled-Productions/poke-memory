// lib/pokemon/transliteration.test.ts
// Unit tests for build-time transliteration helpers (#1259).
//
// These tests use real pinyin-pro and wanakana calls to verify the helpers
// produce correct output for representative Pokemon names.
//
// Runs in the `node` vitest project (no DOM).

import { describe, it, expect } from "vitest";
import {
  generatePinyin,
  normaliseRomaji,
  pinyinWithOverrides,
  PINYIN_OVERRIDES,
} from "./transliteration";

// ---------------------------------------------------------------------------
// Real pinyin-pro and wanakana imports — these are devDependencies so they
// are only available in build/test contexts, never in the runtime bundle.
// ---------------------------------------------------------------------------

// Both pinyin-pro and wanakana ship their own TypeScript declarations.
import { pinyin } from "pinyin-pro";
import { toRomaji } from "wanakana";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pinyinFn(text: string, opts: { toneType: string }): string {
  // Cast to `never` to bypass the overload union; pinyin-pro defaults to
  // string return when no `type` is specified.
  return pinyin(text, opts as never) as string;
}

// ---------------------------------------------------------------------------
// generatePinyin
// ---------------------------------------------------------------------------

describe("generatePinyin", () => {
  it("generates tone-marked pinyin for Simplified Chinese", () => {
    // 妙蛙种子 = Bulbasaur (zh-Hans)
    // Note: 子 in the compound 种子 is neutral tone in Simplified, so pinyin-pro
    // produces "zi" (no tone mark) rather than "zǐ".
    const result = generatePinyin("妙蛙种子", pinyinFn);
    expect(result).toBe("miào wā zhǒng zi");
  });

  it("generates tone-marked pinyin for Traditional Chinese", () => {
    // 妙蛙種子 = Bulbasaur (zh-Hant)
    const result = generatePinyin("妙蛙種子", pinyinFn);
    expect(result).toBe("miào wā zhǒng zǐ");
  });

  it("generates pinyin for a single character name", () => {
    const result = generatePinyin("龍", pinyinFn);
    expect(result).toContain("lóng");
  });

  it("handles rare Traditional characters (spot-check: 噴)", () => {
    // 噴火龍 = Charizard (zh-Hant)
    const result = generatePinyin("噴火龍", pinyinFn);
    expect(result).toBe("pēn huǒ lóng");
  });

  it("handles rare Traditional characters (spot-check: 獸)", () => {
    const result = generatePinyin("獸", pinyinFn);
    expect(result).toContain("shòu");
  });

  it("handles rare Traditional characters (spot-check: 靈)", () => {
    const result = generatePinyin("靈", pinyinFn);
    expect(result).toContain("líng");
  });

  it("handles rare Traditional characters (spot-check: 牠)", () => {
    // 牠 = 3rd-person animal pronoun, found in some zh-Hant names
    const result = generatePinyin("牠", pinyinFn);
    expect(result).toContain("tā");
  });

  it("trims whitespace from the result", () => {
    const result = generatePinyin("龍", pinyinFn);
    expect(result).toBe(result.trim());
  });
});

// ---------------------------------------------------------------------------
// normaliseRomaji
// ---------------------------------------------------------------------------

describe("normaliseRomaji", () => {
  it("returns the jaRoma string when present", () => {
    expect(normaliseRomaji("Fushigidane", "フシギダネ")).toBe("Fushigidane");
  });

  it("trims and collapses whitespace in the jaRoma string", () => {
    expect(normaliseRomaji("  Fushigi  dane  ", "fallback")).toBe("Fushigi dane");
  });

  it("returns the fallback when jaRoma is null", () => {
    const fallback = toRomaji("ヒトカゲ");
    expect(normaliseRomaji(null, fallback)).toBe(fallback);
  });

  it("returns the fallback when jaRoma is undefined", () => {
    const fallback = toRomaji("ゼニガメ");
    expect(normaliseRomaji(undefined, fallback)).toBe(fallback);
  });

  it("returns the fallback when jaRoma is an empty string", () => {
    expect(normaliseRomaji("", "fallback")).toBe("fallback");
  });

  it("wanakana fallback converts katakana correctly", () => {
    // ヒトカゲ = Charmander
    expect(toRomaji("ヒトカゲ")).toBe("hitokage");
    // ゼニガメ = Squirtle
    expect(toRomaji("ゼニガメ")).toBe("zenigame");
    // フシギダネ = Bulbasaur
    expect(toRomaji("フシギダネ")).toBe("fushigidane");
  });
});

// ---------------------------------------------------------------------------
// pinyinWithOverrides
// ---------------------------------------------------------------------------

describe("pinyinWithOverrides", () => {
  it("returns the override when one is registered", () => {
    // Temporarily add an override for testing.
    const originalOverrides = { ...PINYIN_OVERRIDES };
    (PINYIN_OVERRIDES as Record<string, string>)["妙蛙种子"] = "miào wā zhǒng zi (override)";
    try {
      const result = pinyinWithOverrides("妙蛙种子", pinyinFn);
      expect(result).toBe("miào wā zhǒng zi (override)");
    } finally {
      // Restore.
      Object.keys(PINYIN_OVERRIDES).forEach((k) => {
        if (!Object.prototype.hasOwnProperty.call(originalOverrides, k)) {
          delete (PINYIN_OVERRIDES as Record<string, string>)[k];
        }
      });
    }
  });

  it("falls back to generatePinyin when no override exists", () => {
    // 喷火龙 = Charizard (zh-Hans) — not in override map
    const result = pinyinWithOverrides("喷火龙", pinyinFn);
    expect(result).toBe("pēn huǒ lóng");
  });

  it("handles a name not in the override map", () => {
    const result = pinyinWithOverrides("妙蛙种子", pinyinFn);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
