import { describe, it, expect } from "vitest";
import { preloadableSpriteUrls, PRACTICE_SPRITE_SIZE, PICKER_SPRITE_SIZE } from "./sprites";
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

  it("returns nothing for a reverse card - picker tiles are decoded separately in ReviewSession at PICKER_SPRITE_SIZE", () => {
    // Reverse cards display as a four-tile SpritePicker rendered at 150 px, not
    // the 320 px flip-card size. `preloadableSpriteUrls` intentionally returns []
    // here so callers do not accidentally warm the wrong optimiser variant.
    // The decode-ahead in ReviewSession.handleGrade handles reverse cards
    // explicitly by calling decodeSpriteUrls on the target + distractor sprites
    // at the correct 150 px size (#838).
    const card = { cardType: "reverse", spriteUrl: "/sprites/pokemon/1.png" } as unknown as ReviewableCard;
    expect(preloadableSpriteUrls(card)).toEqual([]);
  });

  it("exposes the practice sprite size shared with the flip cards", () => {
    expect(PRACTICE_SPRITE_SIZE).toBe(320);
  });

  it("pins the picker sprite size to 150 px - must match SpritePicker's <Image width={150}>", () => {
    expect(PICKER_SPRITE_SIZE).toBe(150);
  });
});
