import { describe, it, expect } from "vitest";
import {
  PRACTICE_SPRITE_SIZE,
  PICKER_SPRITE_SIZE,
  POKEDEX_GRID_SPRITE_SIZE,
  POKEDEX_DETAIL_SPRITE_SIZE,
  POKEDEX_NODE_SPRITE_SIZE,
  PASTURE_SPRITE_SIZE,
  STATS_SPRITE_SIZE,
  FAVOURITE_MASCOT_SPRITE_SIZE,
  THEME_WATERMARK_SPRITE_SIZE,
} from "@/lib/sprites/sizes";

describe("sprite size constants", () => {
  it("PRACTICE_SPRITE_SIZE is 320 — must match flip-card <Image width> in PokemonCard/EvolutionCard", () => {
    expect(PRACTICE_SPRITE_SIZE).toBe(320);
  });

  it("PICKER_SPRITE_SIZE is 150 — must match SpritePicker <Image width>", () => {
    expect(PICKER_SPRITE_SIZE).toBe(150);
  });

  it("POKEDEX_GRID_SPRITE_SIZE is 64", () => {
    expect(POKEDEX_GRID_SPRITE_SIZE).toBe(64);
  });

  it("POKEDEX_DETAIL_SPRITE_SIZE is 192", () => {
    expect(POKEDEX_DETAIL_SPRITE_SIZE).toBe(192);
  });

  it("POKEDEX_NODE_SPRITE_SIZE is 40", () => {
    expect(POKEDEX_NODE_SPRITE_SIZE).toBe(40);
  });

  it("PASTURE_SPRITE_SIZE is 56", () => {
    expect(PASTURE_SPRITE_SIZE).toBe(56);
  });

  it("STATS_SPRITE_SIZE is 48", () => {
    expect(STATS_SPRITE_SIZE).toBe(48);
  });

  it("FAVOURITE_MASCOT_SPRITE_SIZE is 32", () => {
    expect(FAVOURITE_MASCOT_SPRITE_SIZE).toBe(32);
  });

  it("THEME_WATERMARK_SPRITE_SIZE is 180", () => {
    expect(THEME_WATERMARK_SPRITE_SIZE).toBe(180);
  });

  it("all sizes are positive integers", () => {
    const sizes = [
      PRACTICE_SPRITE_SIZE,
      PICKER_SPRITE_SIZE,
      POKEDEX_GRID_SPRITE_SIZE,
      POKEDEX_DETAIL_SPRITE_SIZE,
      POKEDEX_NODE_SPRITE_SIZE,
      PASTURE_SPRITE_SIZE,
      STATS_SPRITE_SIZE,
      FAVOURITE_MASCOT_SPRITE_SIZE,
      THEME_WATERMARK_SPRITE_SIZE,
    ];
    for (const size of sizes) {
      expect(size).toBeGreaterThan(0);
      expect(Number.isInteger(size)).toBe(true);
    }
  });
});
