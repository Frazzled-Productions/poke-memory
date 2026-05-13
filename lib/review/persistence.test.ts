import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadSession, saveSession } from "./persistence";
import type { ReverseReviewCard, NameReviewCard, DailyLimits } from "./session";
import { DEFAULT_LIMITS } from "./session";
import { initialReviewState } from "@/lib/srs/scheduler";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";

const KEY = "poke-memory:review-session:v1";

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

function makeNameCard(): NameReviewCard {
  return {
    id: 1,
    cardType: "name",
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
    cryUrl: null,
    state: initialReviewState(NOW),
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
    cryUrl: null,
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
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    vi.stubGlobal("window", { localStorage: { ...storage, setItem: throwingSetItem } });
    vi.stubGlobal("localStorage", { ...storage, setItem: throwingSetItem });

    expect(() =>
      saveSession({ cards: [makeReverseCard()], limits: defaultLimits })
    ).not.toThrow();
  });

  it("returns { ok: false, reason: 'quota' } on QuotaExceededError", () => {
    const storage = makeMockStorage();
    const throwingSetItem = vi.fn(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    vi.stubGlobal("window", { localStorage: { ...storage, setItem: throwingSetItem } });
    vi.stubGlobal("localStorage", { ...storage, setItem: throwingSetItem });

    const result = saveSession({ cards: [makeReverseCard()], limits: defaultLimits });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("quota");
  });

  it("returns { ok: true } on successful save", () => {
    const storage = makeMockStorage();
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("localStorage", storage);

    const result = saveSession({ cards: [makeReverseCard()], limits: defaultLimits });
    expect(result.ok).toBe(true);
  });
});

describe("saveSession (synthetic StorageEvent dispatch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("dispatches a same-tab StorageEvent for the session key on a successful write", () => {
    const dispatched: Event[] = [];
    const storage = makeMockStorage();
    vi.stubGlobal(
      "StorageEvent",
      class extends Event {
        key: string | null;
        constructor(type: string, init: { key?: string | null } = {}) {
          super(type);
          this.key = init.key ?? null;
        }
      },
    );
    vi.stubGlobal("window", {
      localStorage: storage,
      dispatchEvent: (e: Event) => {
        dispatched.push(e);
        return true;
      },
    });
    vi.stubGlobal("localStorage", storage);

    const result = saveSession({ cards: [makeReverseCard()], limits: defaultLimits });

    expect(result.ok).toBe(true);
    expect(dispatched).toHaveLength(1);
    expect((dispatched[0] as unknown as { key: string }).key).toBe(
      "poke-memory:review-session:v1",
    );
  });

  it("does not dispatch when the write fails (quota exceeded)", () => {
    const dispatched: Event[] = [];
    const storage = makeMockStorage();
    const throwingSetItem = vi.fn(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    vi.stubGlobal(
      "StorageEvent",
      class extends Event {
        constructor(type: string) {
          super(type);
        }
      },
    );
    vi.stubGlobal("window", {
      localStorage: { ...storage, setItem: throwingSetItem },
      dispatchEvent: (e: Event) => {
        dispatched.push(e);
        return true;
      },
    });
    vi.stubGlobal("localStorage", { ...storage, setItem: throwingSetItem });

    const result = saveSession({ cards: [makeReverseCard()], limits: defaultLimits });

    expect(result.ok).toBe(false);
    expect(dispatched).toHaveLength(0);
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

    const raw = storage._store[KEY];
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
    storage._store[KEY] = JSON.stringify({ cards: [slimCard], limits: defaultLimits });

    const result = loadSession();
    expect(result).not.toBeNull();
    expect(result!.cards).toHaveLength(1);
    const loaded = result!.cards[0];
    expect(loaded.cardType).toBe("reverse");
    expect(loaded.state.dueDate).toBe(state.dueDate);
  });
});

describe("saveSession (name card stripping)", () => {
  let storage: ReturnType<typeof makeMockStorage>;

  beforeEach(() => {
    storage = makeMockStorage();
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("strips flavorTexts and evolutionChain from name cards before writing", () => {
    const card = makeNameCard();
    saveSession({ cards: [card], limits: defaultLimits });

    const raw = storage._store[KEY];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw) as { cards: unknown[] };
    expect(parsed.cards).toHaveLength(1);
    const stored = parsed.cards[0] as Record<string, unknown>;
    expect(stored.flavorTexts).toBeUndefined();
    expect(stored.evolutionChain).toBeUndefined();
    expect(stored.cardType).toBe("name");
    expect(stored.name).toBe("bulbasaur");
  });

  it("preserves flavorText (singular) on name cards", () => {
    const card = makeNameCard();
    saveSession({ cards: [card], limits: defaultLimits });

    const raw = storage._store[KEY];
    const parsed = JSON.parse(raw) as { cards: unknown[] };
    const stored = parsed.cards[0] as Record<string, unknown>;
    expect(stored.flavorText).toBe("A strange seed was planted on its back at birth.");
  });
});
