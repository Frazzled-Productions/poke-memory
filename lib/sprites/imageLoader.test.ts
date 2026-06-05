import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  snapToGeneratedWidth,
  GENERATED_SPRITE_WIDTHS,
} from "./imageLoaderHelpers";
import imageLoader from "./imageLoader";

// ---------------------------------------------------------------------------
// snapToGeneratedWidth
// ---------------------------------------------------------------------------

describe("snapToGeneratedWidth", () => {
  it("returns the exact width when it is already in the generated set", () => {
    for (const w of GENERATED_SPRITE_WIDTHS) {
      expect(snapToGeneratedWidth(w)).toBe(w);
    }
  });

  it("rounds up to the next larger generated width for in-between values", () => {
    // Between 32 and 40 - should round up to 40.
    expect(snapToGeneratedWidth(35)).toBe(40);

    // Between 40 and 48 - should round up to 48.
    expect(snapToGeneratedWidth(44)).toBe(48);

    // Between 64 and 120 - should round up to 120.
    expect(snapToGeneratedWidth(80)).toBe(120);
  });

  it("returns the smallest generated width for requests smaller than all widths", () => {
    expect(snapToGeneratedWidth(1)).toBe(GENERATED_SPRITE_WIDTHS[0]);
  });

  it("caps at the largest generated width for requests larger than all widths", () => {
    const largest = GENERATED_SPRITE_WIDTHS[GENERATED_SPRITE_WIDTHS.length - 1]!;
    expect(snapToGeneratedWidth(largest + 1)).toBe(largest);
    expect(snapToGeneratedWidth(9999)).toBe(largest);
    // Source resolution cap - 475 px exceeds 320 (the largest).
    expect(snapToGeneratedWidth(475)).toBe(largest);
  });
});

// ---------------------------------------------------------------------------
// GENERATED_SPRITE_WIDTHS invariants
// ---------------------------------------------------------------------------

describe("GENERATED_SPRITE_WIDTHS", () => {
  it("is a non-empty sorted array of positive integers", () => {
    expect(GENERATED_SPRITE_WIDTHS.length).toBeGreaterThan(0);
    for (let i = 0; i < GENERATED_SPRITE_WIDTHS.length; i++) {
      const w = GENERATED_SPRITE_WIDTHS[i]!;
      expect(w).toBeGreaterThan(0);
      expect(Number.isInteger(w)).toBe(true);
      if (i > 0) {
        expect(w).toBeGreaterThan(GENERATED_SPRITE_WIDTHS[i - 1]!);
      }
    }
  });

  it("contains 320 (PRACTICE_SPRITE_SIZE) as a generated width", () => {
    expect(GENERATED_SPRITE_WIDTHS).toContain(320);
  });

  it("does not exceed source resolution (475 px)", () => {
    const max = GENERATED_SPRITE_WIDTHS[GENERATED_SPRITE_WIDTHS.length - 1]!;
    expect(max).toBeLessThanOrEqual(475);
  });
});

// ---------------------------------------------------------------------------
// imageLoader (default export)
// ---------------------------------------------------------------------------

describe("imageLoader", () => {
  it("redirects a raw sprite PNG path to the pre-generated WebP variant", () => {
    const result = imageLoader({ src: "/sprites/pokemon/25.png", width: 64, quality: 75 });
    expect(result).toBe("/sprites/pokemon/webp/25/64.webp");
  });

  it("snaps the requested width to the nearest generated width when not exact", () => {
    // 35 is between 32 and 40 - should snap up to 40
    const result = imageLoader({ src: "/sprites/pokemon/1.png", width: 35, quality: 75 });
    expect(result).toBe("/sprites/pokemon/webp/1/40.webp");
  });

  it("caps at the largest generated width for oversized requests", () => {
    const result = imageLoader({ src: "/sprites/pokemon/1.png", width: 9999, quality: 75 });
    expect(result).toBe("/sprites/pokemon/webp/1/320.webp");
  });

  it("does not double-redirect a path already in the WebP tree", () => {
    // src already contains /webp/ - the guard should pass it through unchanged
    const src = "/sprites/pokemon/webp/25/64.webp";
    expect(imageLoader({ src, width: 64, quality: 75 })).toBe(src);
  });

  it("passes a sprite-like path with a non-numeric ID through unchanged (extractSpriteId returns null)", () => {
    const src = "/sprites/pokemon/foo.png";
    expect(imageLoader({ src, width: 64, quality: 75 })).toBe(src);
  });

  it("passes GitHub avatar URLs through unchanged", () => {
    const src = "https://avatars.githubusercontent.com/u/12345?v=4";
    expect(imageLoader({ src, width: 40, quality: 75 })).toBe(src);
  });

  it("passes unrecognised src paths through unchanged (catch-all)", () => {
    const src = "/some/other/image.png";
    expect(imageLoader({ src, width: 100, quality: 75 })).toBe(src);
  });

});

// ---------------------------------------------------------------------------
// Width-array sync: scripts/optimise-sprites.mjs vs GENERATED_SPRITE_WIDTHS
//
// The script hard-codes its width array independently of the TypeScript
// constant. This test fails if the two drift apart so CI catches the
// discrepancy rather than a silent mismatch at sprite-generation time.
// ---------------------------------------------------------------------------

describe("optimise-sprites.mjs width-array sync", () => {
  it("GENERATED_WIDTHS in scripts/optimise-sprites.mjs matches GENERATED_SPRITE_WIDTHS", () => {
    const scriptPath = resolve(process.cwd(), "scripts/optimise-sprites.mjs");
    const source = readFileSync(scriptPath, "utf8");
    const match = source.match(/const GENERATED_WIDTHS\s*=\s*(\[[\d,\s]+\])/);
    expect(match, "could not find GENERATED_WIDTHS array in scripts/optimise-sprites.mjs").not.toBeNull();
    const scriptWidths: number[] = JSON.parse(match![1]!);
    expect(scriptWidths).toEqual([...GENERATED_SPRITE_WIDTHS]);
  });
});
