import { describe, it, expect, vi } from "vitest";
import { paletteFor } from "./palette";
import { CURATED_POKEMON } from "./curated-pokemon";
import { TYPE_PALETTES } from "./type-palettes";

// A small stand-in for the generated file so the order rules are tested
// without depending on what the seed step extracted.
vi.mock("./generated-palettes.json", () => ({
  default: {
    "1": ["#3E8E2E", "#9ACF8C", "#E25C8C", "#000000"],
    "4": "fire",
    "25": ["#111111", "#222222", "#333333", "#FFFFFF"],
  },
}));

describe("paletteFor order (#2187)", () => {
  it("a curated species uses its curated palette, even when a generated one exists", () => {
    const pikachu = CURATED_POKEMON.find((p) => p.id === 25)!;
    expect(paletteFor(25)).toEqual(pikachu.colors);
  });

  it("a species with a generated palette that passed the checks uses it", () => {
    expect(paletteFor(1)).toEqual({
      primary: "#3E8E2E",
      secondary: "#9ACF8C",
      accent: "#E25C8C",
      fgOnPrimary: "#000000",
    });
  });

  it("Extraction fails the check: the species uses its primary type's palette", () => {
    expect(paletteFor(4)).toEqual(TYPE_PALETTES.fire);
  });

  it("an id that is not in the palettes file has no palette", () => {
    expect(paletteFor(999999)).toBeNull();
  });
});
