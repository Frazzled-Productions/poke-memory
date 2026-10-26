import { describe, it, expect } from "vitest";
import { themeForSpecies } from "./themeForSpecies";
import { paletteFor } from "./palette";
import { SEED_POKEMON } from "@/lib/pokemon/seed";

describe("themeForSpecies (#2187)", () => {
  it("A non-curated theme: Bulbasaur's English seed name, its palette and sprite", async () => {
    const bulbasaur = SEED_POKEMON.find((p) => p.id === 1)!;
    expect(await themeForSpecies(bulbasaur)).toEqual({
      id: 1,
      name: "Bulbasaur",
      colors: paletteFor(1),
      spriteUrl: "/sprites/pokemon/1.png",
    });
  });

  it("a curated species uses its curated palette", async () => {
    const pikachu = SEED_POKEMON.find((p) => p.id === 25)!;
    expect((await themeForSpecies(pikachu))?.colors).toEqual(paletteFor(25));
  });
});
