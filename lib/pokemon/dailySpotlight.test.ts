import { describe, it, expect } from "vitest";
import { pickDailySpecies, pickDailyFact } from "@/lib/pokemon/dailySpotlight";
import type { SeedPokemon } from "@/lib/pokemon/seed-builder";
import type { PokemonFact } from "@/lib/pokemon/facts";

function makeSeedPokemon(overrides: Partial<SeedPokemon> & { id: number }): SeedPokemon {
  return {
    speciesId: overrides.id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Species ${overrides.id}`,
    name: `species-${overrides.id}`,
    spriteUrl: `https://example.com/${overrides.id}.png`,
    types: ["normal"],
    stats: { hp: 1, attack: 1, defense: 1, specialAttack: 1, specialDefense: 1, speed: 1 },
    flavorText: "",
    flavorTexts: [],
    evolutionChain: [],
    height: 1,
    weight: 1,
    baseExperience: 1,
    genus: null,
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium",
    habitat: null,
    genderRate: 1,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    ...overrides,
  } as SeedPokemon;
}

describe("pickDailySpecies", () => {
  const list: SeedPokemon[] = [
    makeSeedPokemon({ id: 1 }),
    makeSeedPokemon({ id: 2 }),
    makeSeedPokemon({ id: 3 }),
    // Alternate form - must never be picked.
    makeSeedPokemon({ id: 10100, speciesId: 26, isDefaultForm: false }),
  ];

  it("returns the same species for the same date", () => {
    const a = pickDailySpecies("2026-07-15", list);
    const b = pickDailySpecies("2026-07-15", list);
    expect(a).not.toBeNull();
    expect(a?.id).toBe(b?.id);
  });

  it("rotates to a different pick across dates (over a spread of days)", () => {
    const picks = new Set(
      Array.from({ length: 10 }, (_, i) =>
        pickDailySpecies(`2026-07-${String(i + 1).padStart(2, "0")}`, list)?.id,
      ),
    );
    // With only 3 eligible default forms we can't guarantee every day differs
    // from its neighbour, but across 10 days we expect more than one distinct
    // species to appear.
    expect(picks.size).toBeGreaterThan(1);
  });

  it("never picks an alternate form", () => {
    for (let i = 1; i <= 31; i++) {
      const pick = pickDailySpecies(`2026-01-${String(i).padStart(2, "0")}`, list);
      expect(pick?.isDefaultForm).toBe(true);
      expect(pick?.id).not.toBe(10100);
    }
  });

  it("returns null for an empty list", () => {
    expect(pickDailySpecies("2026-07-15", [])).toBeNull();
  });

  it("returns null when only alternate forms are present", () => {
    const onlyAlt = [makeSeedPokemon({ id: 10100, speciesId: 26, isDefaultForm: false })];
    expect(pickDailySpecies("2026-07-15", onlyAlt)).toBeNull();
  });
});

describe("pickDailyFact", () => {
  const facts: PokemonFact[] = [
    { label: "Height", value: "0.7 m" },
    { label: "Weight", value: "6.9 kg" },
    { label: "Type", value: "Grass / Poison" },
  ];

  it("returns the same fact for the same date", () => {
    const a = pickDailyFact("2026-07-15", facts);
    const b = pickDailyFact("2026-07-15", facts);
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
  });

  it("varies across dates (over a spread of days)", () => {
    const picks = new Set(
      Array.from({ length: 10 }, (_, i) =>
        pickDailyFact(`2026-07-${String(i + 1).padStart(2, "0")}`, facts)?.value,
      ),
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it("returns null for an empty facts list", () => {
    expect(pickDailyFact("2026-07-15", [])).toBeNull();
  });
});
