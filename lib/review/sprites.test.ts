import { describe, it, expect } from "vitest";
import { preloadableSpriteUrls, PRACTICE_SPRITE_SIZE } from "./sprites";
import type { ReviewableCard } from "./session";

describe("preloadableSpriteUrls", () => {
  it("returns the single sprite for a name card", () => {
    const card = { cardType: "name", spriteUrl: "/sprites/pokemon/1.png" } as unknown as ReviewableCard;
    expect(preloadableSpriteUrls(card)).toEqual(["/sprites/pokemon/1.png"]);
  });

  it("returns the single sprite for a cry card", () => {
    const card = { cardType: "cry", spriteUrl: "/sprites/pokemon/25.png" } as unknown as ReviewableCard;
    expect(preloadableSpriteUrls(card)).toEqual(["/sprites/pokemon/25.png"]);
  });

  it("returns both edge sprites for an evolution card", () => {
    const card = {
      cardType: "evolution",
      preEvoSpriteUrl: "/sprites/pokemon/1.png",
      postEvoSpriteUrl: "/sprites/pokemon/2.png",
    } as unknown as ReviewableCard;
    expect(preloadableSpriteUrls(card)).toEqual([
      "/sprites/pokemon/1.png",
      "/sprites/pokemon/2.png",
    ]);
  });

  it("returns both edge sprites for a reverse-evolution card", () => {
    const card = {
      cardType: "reverse-evolution",
      preEvoSpriteUrl: "/sprites/pokemon/1.png",
      postEvoSpriteUrl: "/sprites/pokemon/2.png",
    } as unknown as ReviewableCard;
    expect(preloadableSpriteUrls(card)).toEqual([
      "/sprites/pokemon/1.png",
      "/sprites/pokemon/2.png",
    ]);
  });

  it("returns nothing for a reverse card — the picker renders tiles at a different size", () => {
    const card = { cardType: "reverse", spriteUrl: "/sprites/pokemon/1.png" } as unknown as ReviewableCard;
    expect(preloadableSpriteUrls(card)).toEqual([]);
  });

  it("exposes the practice sprite size shared with the flip cards", () => {
    expect(PRACTICE_SPRITE_SIZE).toBe(320);
  });
});
