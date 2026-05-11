import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadSession, saveSession, STORAGE_KEY } from "./persistence";
import type { ReverseReviewCard, NameReviewCard, DailyLimits } from "./session";
import { DEFAULT_LIMITS } from "./session";
import { initialReviewState } from "@/lib/srs/scheduler";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";

const NOW = new Date("2026-05-11T12:00:00Z");

const defaultLimits: DailyLimits = DEFAULT_LIMITS;

function makeMockStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k]);
    },
    _store: store,
  };
}

function makeReverseCard(): ReverseReviewCard {
  return {
    id: REVERSE_ID_OFFSET + 1,
    pokemonId: 1,
    cardType: "reverse",
    name: "bulbasaur",
    spriteUrl: "https://example.com/1.png",
    types: ["grass"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "A strange seed was planted on its back at birth.",
    flavorTexts: ["A strange seed.", "It bears the seed."],
    evolutionChain: [
      { speciesId: 1, name: "bulbasaur", evolvesFromId: null },
      { speciesId: 2, name: "ivysaur", evolvesFromId: 1 },
    ],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Seed Pokémon",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium-slow",
    habitat: "grassland",
    genderRate: 1,
    isLegendary: false,
    isMythical: false,
    state: initialReviewState(NOW),
  };
}

function makeNameCard(): NameReviewCard {
  return {
    id: 1,
    cardType: "name",
    name: "bulbasaur",
    spriteUrl: "https://example.com/1.png",
    types: ["grass"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "A strange seed was planted on its back at birth.",
    flavorTexts: ["A strange seed."],
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Seed Pokémon",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium-slow",
    habitat: "grassland",
    genderRate: 1,
    isLegendary: false,
    isMythical: false,
    state: initialReviewState(NOW),
  };
}

describe("saveSession (quota handling)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not throw when localStorage.setItem throws QuotaExceededError", () => {
    const storage = makeMockStorage();
    const throwingSetItem = vi.fn(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    vi.stubGlobal("window", { localStorage: { ...storage, setItem: throwingSetItem } });
    vi.stubGlobal("localStorage", { ...storage, setItem: throwingSetItem });

    expect(() =>
      saveSession({ cards: [makeReverseCard()], limits: defaultLimits })
    ).not.toThrow();
  });
});

describe("saveSession (reverse card stripping)", () => {
  let storage: ReturnType<typeof makeMockStorage>;

  beforeEach(() => {
    storage = makeMockStorage();
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("strips flavorTexts and evolutionChain from reverse cards before writing", () => {
    const card = makeReverseCard();
    saveSession({ cards: [card], limits: defaultLimits });

    const raw = storage._store[STORAGE_KEY];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw) as { cards: unknown[] };
    expect(parsed.cards).toHaveLength(1);
    const stored = parsed.cards[0] as Record<string, unknown>;
    expect(stored.flavorTexts).toBeUndefined();
    expect(stored.evolutionChain).toBeUndefined();
    expect(stored.cardType).toBe("reverse");
    expect(stored.name).toBe("bulbasaur");
  });
});

describe("saveSession (non-reverse card passthrough)", () => {
  let storage: ReturnType<typeof makeMockStorage>;

  beforeEach(() => {
    storage = makeMockStorage();
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes name cards to storage without modification", () => {
    const card = makeNameCard();
    saveSession({ cards: [card], limits: defaultLimits });

    const raw = storage._store[STORAGE_KEY];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw) as { cards: unknown[] };
    expect(parsed.cards).toHaveLength(1);
    const stored = parsed.cards[0] as Record<string, unknown>;
    expect(stored.cardType).toBe("name");
    expect(stored.name).toBe("bulbasaur");
  });
});

describe("loadSession (round-trip slimmed reverse card)", () => {
  let storage: ReturnType<typeof makeMockStorage>;

  beforeEach(() => {
    storage = makeMockStorage();
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads a slimmed reverse card (no flavorTexts/evolutionChain) without error", () => {
    const state = initialReviewState(NOW);
    const slimCard = {
      id: REVERSE_ID_OFFSET + 1,
      pokemonId: 1,
      cardType: "reverse",
      name: "bulbasaur",
      spriteUrl: "https://example.com/1.png",
      state,
    };
    storage._store[STORAGE_KEY] = JSON.stringify({ cards: [slimCard], limits: defaultLimits });

    const result = loadSession();
    expect(result).not.toBeNull();
    expect(result!.cards).toHaveLength(1);
    const loaded = result!.cards[0];
    expect(loaded.cardType).toBe("reverse");
    expect(loaded.state.dueDate).toBe(state.dueDate);
  });
});
