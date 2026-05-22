import { describe, it, expect } from "vitest";
import { spriteVariantUrl, rawSpriteUrl } from "./url";

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
