/**
 * lib/pokemon/flavorTextAccumulator.test.ts
 *
 * Unit tests for the dedup-accumulate logic extracted in #1559.
 * Covers:
 *   - empty and null inputs
 *   - non-English entries are filtered out
 *   - identical texts are merged (versions combined in encounter order, deduped)
 *   - distinct texts are preserved in first-seen order
 *   - FLAVOR_TEXTS_MAX cap applies to distinct entries, not raw entries
 *   - normalizeFlavorText whitespace normalisation
 */

import { describe, it, expect } from "vitest";
import {
  extractFlavorTexts,
  normalizeFlavorText,
  FLAVOR_TEXTS_MAX,
} from "@/lib/pokemon/flavorTextAccumulator";

// ---------------------------------------------------------------------------
// normalizeFlavorText
// ---------------------------------------------------------------------------

describe("normalizeFlavorText", () => {
  it("returns empty string for null/undefined/empty", () => {
    expect(normalizeFlavorText(null)).toBe("");
    expect(normalizeFlavorText(undefined)).toBe("");
    expect(normalizeFlavorText("")).toBe("");
  });

  it("replaces form-feed (\\f) with a space", () => {
    expect(normalizeFlavorText("A\x0CB")).toBe("A B");
  });

  it("replaces newline (\\n) with a space", () => {
    expect(normalizeFlavorText("A\nB")).toBe("A B");
  });

  it("replaces carriage-return (\\r) with a space", () => {
    expect(normalizeFlavorText("A\rB")).toBe("A B");
  });

  it("collapses multiple spaces into one", () => {
    expect(normalizeFlavorText("A  B   C")).toBe("A B C");
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeFlavorText("  hello  ")).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// extractFlavorTexts — edge cases
// ---------------------------------------------------------------------------

describe("extractFlavorTexts — empty / null inputs", () => {
  it("returns [] for null input", () => {
    expect(extractFlavorTexts(null)).toEqual([]);
  });

  it("returns [] for undefined input", () => {
    expect(extractFlavorTexts(undefined)).toEqual([]);
  });

  it("returns [] for empty array", () => {
    expect(extractFlavorTexts([])).toEqual([]);
  });

  it("returns [] when only non-English entries are present", () => {
    const entries = [
      { flavor_text: "ポケモン", language: { name: "ja" }, version: { name: "red" } },
      { flavor_text: "宝可梦", language: { name: "zh-Hans" }, version: { name: "red" } },
    ];
    expect(extractFlavorTexts(entries)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractFlavorTexts — accumulation (the AC-targeted behaviour)
// ---------------------------------------------------------------------------

describe("extractFlavorTexts — dedup-accumulate", () => {
  it("keeps one entry per distinct text, with its version", () => {
    const entries = [
      { flavor_text: "Sleeps a lot.", language: { name: "en" }, version: { name: "red" } },
    ];
    expect(extractFlavorTexts(entries)).toEqual([
      { text: "Sleeps a lot.", versions: ["red"] },
    ]);
  });

  it("merges identical texts and accumulates versions in encounter order", () => {
    const entries = [
      { flavor_text: "Sleeps a lot.", language: { name: "en" }, version: { name: "red" } },
      { flavor_text: "Sleeps a lot.", language: { name: "en" }, version: { name: "blue" } },
      { flavor_text: "Sleeps a lot.", language: { name: "en" }, version: { name: "yellow" } },
    ];
    const result = extractFlavorTexts(entries);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ text: "Sleeps a lot.", versions: ["red", "blue", "yellow"] });
  });

  it("does not duplicate a version slug that appears twice for the same text", () => {
    const entries = [
      { flavor_text: "Sleeps a lot.", language: { name: "en" }, version: { name: "red" } },
      { flavor_text: "Sleeps a lot.", language: { name: "en" }, version: { name: "red" } },
    ];
    const result = extractFlavorTexts(entries);
    expect(result[0].versions).toEqual(["red"]);
  });

  it("preserves distinct texts in first-seen order", () => {
    const entries = [
      { flavor_text: "First text.", language: { name: "en" }, version: { name: "red" } },
      { flavor_text: "Second text.", language: { name: "en" }, version: { name: "blue" } },
      { flavor_text: "First text.", language: { name: "en" }, version: { name: "yellow" } },
    ];
    const result = extractFlavorTexts(entries);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ text: "First text.", versions: ["red", "yellow"] });
    expect(result[1]).toEqual({ text: "Second text.", versions: ["blue"] });
  });

  it("normalises whitespace before deduplicating (form-feed variant = same text)", () => {
    const entries = [
      // PokéAPI sends form-feed (\x0C) as line-separator in some entries
      { flavor_text: "Sleeps\x0Ca lot.", language: { name: "en" }, version: { name: "red" } },
      { flavor_text: "Sleeps a lot.", language: { name: "en" }, version: { name: "blue" } },
    ];
    const result = extractFlavorTexts(entries);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ text: "Sleeps a lot.", versions: ["red", "blue"] });
  });

  it("handles an entry with no version gracefully (empty versions list)", () => {
    const entries = [
      { flavor_text: "Has no version.", language: { name: "en" } },
    ];
    const result = extractFlavorTexts(entries);
    expect(result).toEqual([{ text: "Has no version.", versions: [] }]);
  });

  it("mixes entries with and without version slugs", () => {
    const entries = [
      { flavor_text: "Text A.", language: { name: "en" }, version: { name: "red" } },
      { flavor_text: "Text A.", language: { name: "en" } },
    ];
    const result = extractFlavorTexts(entries);
    // Second entry has no slug — should not add a blank slug or crash.
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ text: "Text A.", versions: ["red"] });
  });
});

// ---------------------------------------------------------------------------
// extractFlavorTexts — FLAVOR_TEXTS_MAX cap
// ---------------------------------------------------------------------------

describe("extractFlavorTexts — FLAVOR_TEXTS_MAX cap", () => {
  it(`stops at ${FLAVOR_TEXTS_MAX} distinct entries`, () => {
    // Create FLAVOR_TEXTS_MAX + 2 distinct texts.
    const entries = Array.from({ length: FLAVOR_TEXTS_MAX + 2 }, (_, i) => ({
      flavor_text: `Unique text number ${i + 1}.`,
      language: { name: "en" },
      version: { name: `game-${i}` },
    }));
    const result = extractFlavorTexts(entries);
    expect(result).toHaveLength(FLAVOR_TEXTS_MAX);
  });

  it("cap is on distinct texts — many identical entries don't consume the cap", () => {
    // All entries share the same text, plus one genuinely distinct entry.
    const repeated = Array.from({ length: FLAVOR_TEXTS_MAX + 5 }, (_, i) => ({
      flavor_text: "Shared text.",
      language: { name: "en" },
      version: { name: `game-${i}` },
    }));
    const distinct = {
      flavor_text: "Distinct text.",
      language: { name: "en" },
      version: { name: "game-last" },
    };
    const result = extractFlavorTexts([...repeated, distinct]);
    // Both texts should be present — repeated entries share 1 slot.
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("Shared text.");
    expect(result[1].text).toBe("Distinct text.");
  });
});
