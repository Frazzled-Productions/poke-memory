import { describe, it, expect } from "vitest";
import { spriteVariantUrl, rawSpriteUrl, spriteGridSrcSet } from "./url";

describe("spriteVariantUrl", () => {
  it("returns the WebP path for a species ID and width", () => {
    expect(spriteVariantUrl(25, 320)).toBe("/sprites/pokemon/webp/25/320.webp");
  });

  it("handles edge-case IDs (0, 10001)", () => {
    expect(spriteVariantUrl(0, 64)).toBe("/sprites/pokemon/webp/0/64.webp");
    expect(spriteVariantUrl(10001, 150)).toBe(
      "/sprites/pokemon/webp/10001/150.webp",
    );
  });

  it("produces distinct paths for different widths", () => {
    expect(spriteVariantUrl(1, 40)).not.toBe(spriteVariantUrl(1, 64));
  });
});

describe("rawSpriteUrl", () => {
  it("returns the raw PNG path for a species ID", () => {
    expect(rawSpriteUrl(25)).toBe("/sprites/pokemon/25.png");
    expect(rawSpriteUrl(1)).toBe("/sprites/pokemon/1.png");
  });

  it("does not include the webp segment", () => {
    expect(rawSpriteUrl(1)).not.toContain("webp");
  });
});

// ---------------------------------------------------------------------------
// spriteGridSrcSet - DPR-aware srcset for the Pokédex grid (#1787)
// ---------------------------------------------------------------------------

describe("spriteGridSrcSet", () => {
  it("contains the 64 px 1x descriptor", () => {
    const srcset = spriteGridSrcSet(1);
    expect(srcset).toContain("/sprites/pokemon/webp/1/64.webp 1x");
  });

  it("contains the 120 px 2x descriptor", () => {
    const srcset = spriteGridSrcSet(1);
    expect(srcset).toContain("/sprites/pokemon/webp/1/120.webp 2x");
  });

  it("contains the 192 px 3x descriptor", () => {
    const srcset = spriteGridSrcSet(1);
    expect(srcset).toContain("/sprites/pokemon/webp/1/192.webp 3x");
  });

  it("uses the correct species ID for all descriptors", () => {
    const srcset = spriteGridSrcSet(25);
    expect(srcset).toContain("/sprites/pokemon/webp/25/64.webp 1x");
    expect(srcset).toContain("/sprites/pokemon/webp/25/120.webp 2x");
    expect(srcset).toContain("/sprites/pokemon/webp/25/192.webp 3x");
  });

  it("descriptors are comma-separated", () => {
    const srcset = spriteGridSrcSet(1);
    // Should have at least two commas separating three entries.
    const parts = srcset.split(",");
    expect(parts).toHaveLength(3);
  });

  it("does not reference the raw PNG path", () => {
    expect(spriteGridSrcSet(1)).not.toContain(".png");
  });
});
