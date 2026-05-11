import { describe, it, expect } from "vitest";
import { pickDistractors } from "@/lib/pokemon/distractors";
import type { SeedPokemon } from "@/lib/pokemon/seed";

function makePokemon(id: number): SeedPokemon {
  return {
    id,
    name: `pokemon-${id}`,
    spriteUrl: `https://example.com/${id}.png`,
    types: ["normal"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "A test Pokémon.",
    flavorTexts: ["A test Pokémon."],
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Test Pokémon",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium-slow",
    habitat: "grassland",
    genderRate: 1,
    isLegendary: false,
    isMythical: false,
  };
}

const POOL = Array.from({ length: 20 }, (_, i) => makePokemon(i + 1));

describe("pickDistractors", () => {
  it("never includes the target id", () => {
    const result = pickDistractors(1, POOL, 3, "seed");
    expect(result.every((p) => p.id !== 1)).toBe(true);
  });

  it("returns exactly count entries when pool is large enough", () => {
    const result = pickDistractors(1, POOL, 3, "seed");
    expect(result).toHaveLength(3);
  });

  it("returns all non-target entries when pool is too small", () => {
    const smallPool = [makePokemon(1), makePokemon(2), makePokemon(3)];
    const result = pickDistractors(1, smallPool, 5, "seed");
    // Only 2 non-target entries available
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.id !== 1)).toBe(true);
  });

  it("does not throw when pool has exactly count non-target entries", () => {
    const exactPool = [makePokemon(1), makePokemon(2), makePokemon(3), makePokemon(4)];
    expect(() => pickDistractors(1, exactPool, 3, "seed")).not.toThrow();
    const result = pickDistractors(1, exactPool, 3, "seed");
    expect(result).toHaveLength(3);
  });

  it("is deterministic: same seed + targetId → same output on repeated calls", () => {
    const a = pickDistractors(5, POOL, 3, "2026-05-11");
    const b = pickDistractors(5, POOL, 3, "2026-05-11");
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
  });

  it("produces different results for different seeds", () => {
    const a = pickDistractors(5, POOL, 3, "seed-A");
    const b = pickDistractors(5, POOL, 3, "seed-B");
    // With 20-item pool, overwhelmingly unlikely to collide
    expect(a.map((p) => p.id)).not.toEqual(b.map((p) => p.id));
  });

  it("produces different results for different target ids with the same seed", () => {
    const a = pickDistractors(1, POOL, 3, "stable-seed");
    const b = pickDistractors(2, POOL, 3, "stable-seed");
    expect(a.map((p) => p.id)).not.toEqual(b.map((p) => p.id));
  });
});
