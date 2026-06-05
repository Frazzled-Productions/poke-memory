import { describe, it, expect } from "vitest";
import { pickMcDistractors, buildMcOptions } from "@/lib/srs/multipleChoiceDistractors";
import type { SeedPokemon } from "@/lib/pokemon/seed";

function makePokemon(
  id: number,
  opts: Partial<Pick<SeedPokemon, "generation" | "isDefaultForm" | "displayName">> = {},
): SeedPokemon {
  return {
    id,
    speciesId: id,
    isDefaultForm: opts.isDefaultForm ?? true,
    formCategory: "default",
    formSlug: null,
    displayName: opts.displayName ?? `Pokemon${id}`,
    name: `pokemon-${id}`,
    spriteUrl: `https://example.com/${id}.png`,
    types: ["normal"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "A test Pokémon.",
    flavorTexts: [],
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Test Pokémon",
    generation: opts.generation ?? "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium-slow",
    habitat: "grassland",
    genderRate: 1,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
  };
}

// 5 Gen-I Pokémon + 5 Gen-II Pokémon.
const GEN_I = Array.from({ length: 5 }, (_, i) =>
  makePokemon(i + 1, { generation: "generation-i" }),
);
const GEN_II = Array.from({ length: 5 }, (_, i) =>
  makePokemon(i + 10, { generation: "generation-ii" }),
);
const POOL = [...GEN_I, ...GEN_II];

describe("pickMcDistractors", () => {
  const target = GEN_I[0]; // id=1, generation-i

  it("returns exactly 3 distractors", () => {
    const result = pickMcDistractors(target.id, target, POOL, "seed");
    expect(result).toHaveLength(3);
  });

  it("never includes the target id", () => {
    const result = pickMcDistractors(target.id, target, POOL, "seed");
    expect(result.every((p) => p.id !== target.id)).toBe(true);
  });

  it("prefers same-generation distractors", () => {
    const result = pickMcDistractors(target.id, target, POOL, "seed");
    // Pool has 4 other Gen-I entries - all 3 distractors should be Gen-I.
    expect(result.every((p) => p.generation === "generation-i")).toBe(true);
  });

  it("falls back to other generations when same-gen pool is exhausted", () => {
    // Only 2 other Gen-I Pokémon available; must fill 3rd slot from Gen-II.
    const smallPool = [
      makePokemon(1, { generation: "generation-i" }), // target
      makePokemon(2, { generation: "generation-i" }),
      makePokemon(3, { generation: "generation-i" }),
      makePokemon(10, { generation: "generation-ii" }),
      makePokemon(11, { generation: "generation-ii" }),
    ];
    const tgt = smallPool[0];
    const result = pickMcDistractors(tgt.id, tgt, smallPool, "seed");
    expect(result).toHaveLength(3);
    const ids = result.map((p) => p.id);
    // Should include the two same-gen entries.
    expect(ids).toContain(2);
    expect(ids).toContain(3);
    // Third should be a Gen-II entry.
    expect(ids.some((id) => id >= 10)).toBe(true);
  });

  it("excludes alternate-form entries from distractors", () => {
    const altForm = makePokemon(99, { generation: "generation-i", isDefaultForm: false });
    const poolWithAlt = [...POOL, altForm];
    const result = pickMcDistractors(target.id, target, poolWithAlt, "seed");
    expect(result.every((p) => p.isDefaultForm)).toBe(true);
  });

  it("is deterministic: same arguments return the same set", () => {
    const a = pickMcDistractors(target.id, target, POOL, "my-seed");
    const b = pickMcDistractors(target.id, target, POOL, "my-seed");
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
  });

  it("produces different results for different seeds", () => {
    // Use a larger pool to make collision extremely unlikely.
    const bigPool = Array.from({ length: 50 }, (_, i) =>
      makePokemon(i + 1, { generation: "generation-i" }),
    );
    const tgt = bigPool[0];
    const a = pickMcDistractors(tgt.id, tgt, bigPool, "seed-A");
    const b = pickMcDistractors(tgt.id, tgt, bigPool, "seed-B");
    expect(a.map((p) => p.id)).not.toEqual(b.map((p) => p.id));
  });

  it("handles null generation by treating target as gen-less (no same-gen priority)", () => {
    const noGenTarget = makePokemon(1, { generation: null });
    const noGenPool = [
      noGenTarget,
      makePokemon(2, { generation: null }),
      makePokemon(3, { generation: "generation-i" }),
      makePokemon(4, { generation: "generation-ii" }),
    ];
    // Should still return 3 without throwing.
    const result = pickMcDistractors(noGenTarget.id, noGenTarget, noGenPool, "seed");
    expect(result).toHaveLength(3);
    expect(result.every((p) => p.id !== noGenTarget.id)).toBe(true);
  });
});

describe("buildMcOptions", () => {
  const target = GEN_I[0];

  it("returns exactly 4 options", () => {
    const opts = buildMcOptions(target.id, target, POOL, "seed");
    expect(opts).toHaveLength(4);
  });

  it("includes exactly one correct option", () => {
    const opts = buildMcOptions(target.id, target, POOL, "seed");
    const correct = opts.filter((o) => o.isCorrect);
    expect(correct).toHaveLength(1);
    expect(correct[0].pokemon.id).toBe(target.id);
  });

  it("includes exactly three incorrect options", () => {
    const opts = buildMcOptions(target.id, target, POOL, "seed");
    expect(opts.filter((o) => !o.isCorrect)).toHaveLength(3);
  });

  it("all option pokemon ids are unique", () => {
    const opts = buildMcOptions(target.id, target, POOL, "seed");
    const ids = opts.map((o) => o.pokemon.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("is deterministic", () => {
    const a = buildMcOptions(target.id, target, POOL, "stable");
    const b = buildMcOptions(target.id, target, POOL, "stable");
    expect(a.map((o) => o.pokemon.id)).toEqual(b.map((o) => o.pokemon.id));
  });

  it("correct option is not always first (shuffle distributes it)", () => {
    // Run across 10 different seeds and assert the correct option appears at
    // different positions - a purely unshuffled array would always put it first.
    const positions = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const opts = buildMcOptions(target.id, target, POOL, `shuffle-test-${i}`);
      const idx = opts.findIndex((o) => o.isCorrect);
      positions.add(idx);
    }
    // With 20 trials over 4 positions it would be astronomically unlikely to
    // always land on position 0. Require at least 2 distinct positions.
    expect(positions.size).toBeGreaterThan(1);
  });
});
