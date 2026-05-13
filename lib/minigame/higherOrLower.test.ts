import { describe, it, expect } from "vitest";
import {
  scoreGuess,
  getSeenPokemon,
  pickPair,
  BASE_STATS,
  type StatKey,
} from "./higherOrLower";
import type { SeedPokemon } from "@/lib/pokemon/seed";
import type { ReviewableCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";

// Minimal SeedPokemon factory — only the fields touched by this module.
function makePokemon(
  id: number,
  stats: Partial<Record<StatKey, number>> = {},
): SeedPokemon {
  return {
    id,
    name: `Pokemon${id}`,
    spriteUrl: "",
    types: [],
    stats: {
      hp: stats.hp ?? 50,
      attack: stats.attack ?? 50,
      defense: stats.defense ?? 50,
      specialAttack: stats.specialAttack ?? 50,
      specialDefense: stats.specialDefense ?? 50,
      speed: stats.speed ?? 50,
    },
    flavorText: "",
    flavorTexts: undefined,
    evolutionChain: [],
    height: null,
    weight: null,
    baseExperience: null,
    genus: null,
    generation: null,
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
  };
}

const seenState: ReviewState = {
  stability: 1,
  difficulty: 5,
  elapsedDays: 0,
  scheduledDays: 1,
  reps: 1,
  lapses: 0,
  fsrsState: "learning",
  dueDate: "2026-01-01",
  lastReview: "2026-01-01",
  firstSeen: "2026-01-01",
  hiddenSince: null,
  seenInPasture: false,
  learningStep: null,
  stepStartedAt: null,
};

const unseenState: ReviewState = {
  ...seenState,
  firstSeen: null,
  lastReview: null,
};

// ── scoreGuess ──────────────────────────────────────────────────────────────

describe("scoreGuess", () => {
  const high = makePokemon(1, { attack: 100 });
  const low = makePokemon(2, { attack: 40 });
  const equal = makePokemon(3, { attack: 100 });

  it("correct when guessing left and left has higher stat", () => {
    const result = scoreGuess(high, low, "attack", "left");
    expect(result).toEqual({ correct: true, tie: false });
  });

  it("incorrect when guessing left but right has higher stat", () => {
    const result = scoreGuess(low, high, "attack", "left");
    expect(result).toEqual({ correct: false, tie: false });
  });

  it("correct when guessing right and right has higher stat", () => {
    const result = scoreGuess(low, high, "attack", "right");
    expect(result).toEqual({ correct: true, tie: false });
  });

  it("incorrect when guessing right but left has higher stat", () => {
    const result = scoreGuess(high, low, "attack", "right");
    expect(result).toEqual({ correct: false, tie: false });
  });

  it("tie is always correct regardless of guess direction — left", () => {
    expect(scoreGuess(high, equal, "attack", "left")).toEqual({
      correct: true,
      tie: true,
    });
  });

  it("tie is always correct regardless of guess direction — right", () => {
    expect(scoreGuess(high, equal, "attack", "right")).toEqual({
      correct: true,
      tie: true,
    });
  });
});

// ── getSeenPokemon ───────────────────────────────────────────────────────────

describe("getSeenPokemon", () => {
  const p1 = makePokemon(1);
  const p2 = makePokemon(2);
  const p3 = makePokemon(3);
  const seed = [p1, p2, p3];

  it("includes a Pokémon seen via a name card", () => {
    const cards: ReviewableCard[] = [
      { ...p1, cardType: "name", state: seenState },
    ];
    const result = getSeenPokemon(cards, seed);
    expect(result.map((p) => p.id)).toEqual([1]);
  });

  it("includes a Pokémon seen via a reverse card", () => {
    const cards: ReviewableCard[] = [
      {
        ...p2,
        id: 2_000_002,
        pokemonId: p2.id,
        cardType: "reverse",
        state: seenState,
      },
    ];
    const result = getSeenPokemon(cards, seed);
    expect(result.map((p) => p.id)).toEqual([2]);
  });

  it("includes a Pokémon seen via a cry card", () => {
    const cards: ReviewableCard[] = [
      {
        ...p3,
        id: 3_000_003,
        pokemonId: p3.id,
        cardType: "cry",
        state: seenState,
      },
    ];
    const result = getSeenPokemon(cards, seed);
    expect(result.map((p) => p.id)).toEqual([3]);
  });

  it("includes both preEvo and postEvo for a seen evolution card", () => {
    const cards: ReviewableCard[] = [
      {
        cardType: "evolution",
        id: 1_500_001,
        preEvoId: 1,
        preEvoName: "Pokemon1",
        preEvoSpriteUrl: "",
        postEvoId: 2,
        postEvoName: "Pokemon2",
        postEvoSpriteUrl: "",
        triggerPhrase: null,
        state: seenState,
      },
    ];
    const result = getSeenPokemon(cards, seed);
    expect(result.map((p) => p.id).sort()).toEqual([1, 2]);
  });

  it("deduplicates across multiple card types for the same Pokémon", () => {
    const cards: ReviewableCard[] = [
      { ...p1, cardType: "name", state: seenState },
      {
        ...p1,
        id: 2_000_001,
        pokemonId: p1.id,
        cardType: "reverse",
        state: seenState,
      },
      {
        ...p1,
        id: 3_000_001,
        pokemonId: p1.id,
        cardType: "cry",
        state: seenState,
      },
    ];
    const result = getSeenPokemon(cards, seed);
    expect(result.map((p) => p.id)).toEqual([1]);
  });

  it("excludes cards where firstSeen is null", () => {
    const cards: ReviewableCard[] = [
      { ...p1, cardType: "name", state: unseenState },
      { ...p2, cardType: "name", state: seenState },
    ];
    const result = getSeenPokemon(cards, seed);
    expect(result.map((p) => p.id)).toEqual([2]);
  });

  it("returns empty array when no cards are seen", () => {
    const cards: ReviewableCard[] = [
      { ...p1, cardType: "name", state: unseenState },
    ];
    const result = getSeenPokemon(cards, seed);
    expect(result).toEqual([]);
  });

  it("handles mixed seen and unseen cards for the same Pokémon", () => {
    const cards: ReviewableCard[] = [
      { ...p1, cardType: "name", state: unseenState },
      {
        ...p1,
        id: 2_000_001,
        pokemonId: p1.id,
        cardType: "reverse",
        state: seenState,
      },
    ];
    const result = getSeenPokemon(cards, seed);
    expect(result.map((p) => p.id)).toEqual([1]);
  });
});

// ── pickPair ─────────────────────────────────────────────────────────────────

describe("pickPair", () => {
  const pool = [
    makePokemon(1),
    makePokemon(2),
    makePokemon(3),
    makePokemon(4),
    makePokemon(5),
    makePokemon(6),
  ];

  const validStatKeys = new Set<string>(BASE_STATS.map((s) => s.key));

  it("always picks two distinct Pokémon", () => {
    // Run 50 times with Math.random to exercise the re-roll path
    for (let i = 0; i < 50; i++) {
      const { left, right } = pickPair(pool);
      expect(left.id).not.toBe(right.id);
    }
  });

  it("always picks a valid stat key", () => {
    for (let i = 0; i < 50; i++) {
      const { stat } = pickPair(pool);
      expect(validStatKeys.has(stat)).toBe(true);
    }
  });

  it("is deterministic when an rng is injected", () => {
    // A counter-based rng produces a predictable sequence.
    let call = 0;
    // Values: 0.0 → idx 0, 0.5 → idx 3 (floor(0.5*6)), 0.16 → stat idx 0
    const values = [0.0, 0.5, 0.16];
    const rng = () => values[call++ % values.length];

    const result = pickPair(pool, rng);
    expect(result.left.id).toBe(pool[0].id);
    expect(result.right.id).toBe(pool[3].id);
    expect(validStatKeys.has(result.stat)).toBe(true);
  });

  it("picks a different Pokémon for right when rng initially collides", () => {
    // rng sequence: first two calls return 0.0 (collision), third returns 0.5
    let call = 0;
    const values = [0.0, 0.0, 0.5, 0.0];
    const rng = () => values[call++ % values.length];

    const { left, right } = pickPair(pool, rng);
    expect(left.id).not.toBe(right.id);
  });

  it("throws when the pool has fewer than 2 entries", () => {
    expect(() => pickPair([pool[0]])).toThrow();
    expect(() => pickPair([])).toThrow();
  });
});
