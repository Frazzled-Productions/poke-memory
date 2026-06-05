import { describe, it, expect } from "vitest";
import { fnv1a, fnv1aUint32, FNV_OFFSET, FNV_PRIME } from "./fnv1a";

// ---------------------------------------------------------------------------
// fnv1a (string hashing)
// ---------------------------------------------------------------------------

describe("fnv1a", () => {
  it("returns FNV_OFFSET for the empty string (no bytes processed)", () => {
    expect(fnv1a("")).toBe(FNV_OFFSET);
  });

  it("produces the well-known FNV-1a hash for 'a'", () => {
    // Reference value: FNV-1a 32-bit of "a" = 0xe40c292c
    expect(fnv1a("a")).toBe(0xe40c292c >>> 0);
  });

  it("produces the well-known FNV-1a hash for 'foobar'", () => {
    // Reference value: FNV-1a 32-bit of "foobar" = 0xbf9cf968
    expect(fnv1a("foobar")).toBe(0xbf9cf968 >>> 0);
  });

  it("returns an unsigned 32-bit integer (always >= 0)", () => {
    expect(fnv1a("test")).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic - same input always yields the same output", () => {
    expect(fnv1a("Bulbasaur")).toBe(fnv1a("Bulbasaur"));
  });

  it("differs for different inputs", () => {
    expect(fnv1a("Bulbasaur")).not.toBe(fnv1a("Ivysaur"));
  });

  it("is sensitive to character order", () => {
    expect(fnv1a("ab")).not.toBe(fnv1a("ba"));
  });
});

// ---------------------------------------------------------------------------
// fnv1aUint32
// ---------------------------------------------------------------------------

describe("fnv1aUint32", () => {
  it("uses FNV_OFFSET as the default seed (no explicit seed)", () => {
    // Manually compute FNV-1a over the 4 bytes of the integer 1 (little-endian).
    let expected = FNV_OFFSET;
    expected ^= 1 & 0xff;
    expected = Math.imul(expected, FNV_PRIME) >>> 0;
    expected ^= (1 >>> 8) & 0xff;
    expected = Math.imul(expected, FNV_PRIME) >>> 0;
    expected ^= (1 >>> 16) & 0xff;
    expected = Math.imul(expected, FNV_PRIME) >>> 0;
    expected ^= (1 >>> 24) & 0xff;
    expected = Math.imul(expected, FNV_PRIME) >>> 0;

    expect(fnv1aUint32(1)).toBe(expected);
  });

  it("returns FNV_OFFSET XOR'd through 4 zero bytes when n = 0", () => {
    // When n = 0 every byte is 0x00, so each round is:
    //   hash ^= 0  ->  hash unchanged
    //   hash = Math.imul(hash, FNV_PRIME) >>> 0
    // (XOR with 0 is a no-op, so the hash advances only via multiplication.)
    let expected = FNV_OFFSET;
    for (let i = 0; i < 4; i++) {
      expected = Math.imul(expected, FNV_PRIME) >>> 0;
    }
    expect(fnv1aUint32(0)).toBe(expected);
  });

  it("returns an unsigned 32-bit integer (always >= 0)", () => {
    expect(fnv1aUint32(255)).toBeGreaterThanOrEqual(0);
    expect(fnv1aUint32(0xffffffff)).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic - same input always yields the same output", () => {
    expect(fnv1aUint32(42)).toBe(fnv1aUint32(42));
  });

  it("differs for different integers", () => {
    expect(fnv1aUint32(1)).not.toBe(fnv1aUint32(2));
  });

  it("honours the seed parameter - chaining two calls is equivalent to the inline 8-byte block", () => {
    // The inline block from stableShuffleForDay hashes `id` then `daySalt`
    // all from FNV_OFFSET. Verify the chain produces the same result.
    const id = 25; // Pikachu
    const daySalt = fnv1a("2026-05-18");

    // Reference: inline 8-byte block starting at FNV_OFFSET.
    let expected = FNV_OFFSET;
    expected ^= id & 0xff;
    expected = Math.imul(expected, FNV_PRIME) >>> 0;
    expected ^= (id >>> 8) & 0xff;
    expected = Math.imul(expected, FNV_PRIME) >>> 0;
    expected ^= (id >>> 16) & 0xff;
    expected = Math.imul(expected, FNV_PRIME) >>> 0;
    expected ^= (id >>> 24) & 0xff;
    expected = Math.imul(expected, FNV_PRIME) >>> 0;
    expected ^= daySalt & 0xff;
    expected = Math.imul(expected, FNV_PRIME) >>> 0;
    expected ^= (daySalt >>> 8) & 0xff;
    expected = Math.imul(expected, FNV_PRIME) >>> 0;
    expected ^= (daySalt >>> 16) & 0xff;
    expected = Math.imul(expected, FNV_PRIME) >>> 0;
    expected ^= (daySalt >>> 24) & 0xff;
    expected = Math.imul(expected, FNV_PRIME) >>> 0;

    // Chained helper calls.
    const actual = fnv1aUint32(daySalt, fnv1aUint32(id));

    expect(actual).toBe(expected);
  });

  it("honours an explicit seed - result matches seeded inline block", () => {
    // Mirrors the pickDistractors usage where the seed is a pre-computed
    // string hash rather than FNV_OFFSET.
    const seedHash = fnv1a("bulbasaur1");
    const pokemonId = 2; // Ivysaur

    let expected = seedHash;
    expected ^= pokemonId & 0xff;
    expected = Math.imul(expected, FNV_PRIME) >>> 0;
    expected ^= (pokemonId >>> 8) & 0xff;
    expected = Math.imul(expected, FNV_PRIME) >>> 0;
    expected ^= (pokemonId >>> 16) & 0xff;
    expected = Math.imul(expected, FNV_PRIME) >>> 0;
    expected ^= (pokemonId >>> 24) & 0xff;
    expected = Math.imul(expected, FNV_PRIME) >>> 0;

    expect(fnv1aUint32(pokemonId, seedHash)).toBe(expected);
  });

  it("handles large Pokemon IDs (4-digit, e.g. 1025)", () => {
    expect(fnv1aUint32(1025)).toBeGreaterThanOrEqual(0);
    expect(fnv1aUint32(1025)).toBe(fnv1aUint32(1025));
  });
});
