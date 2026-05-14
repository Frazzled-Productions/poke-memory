import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadSession, saveSession } from "./persistence";
import { __resetForTests } from "@/lib/idb/db";
import * as idbModule from "@/lib/idb/db";
import type { ReverseReviewCard, NameReviewCard, ReverseEvolutionReviewCard, DailyLimits } from "./session";
import { DEFAULT_LIMITS } from "./session";
import { initialReviewState } from "@/lib/srs/scheduler";
import { REVERSE_ID_OFFSET, REVERSE_EDGE_ID_BASE } from "@/lib/pokemon/seed";

// fake-indexeddb/auto is installed by vitest.setup.node.ts and polyfills
// globalThis.indexedDB. Reset the database between test suites to avoid
// state leaking across tests.

const NOW = new Date("2026-05-11T12:00:00Z");

const defaultLimits: DailyLimits = DEFAULT_LIMITS;

function makeNameCard(): NameReviewCard {
  return {
    id: 1,
    speciesId: 1,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: "Bulbasaur",
    cardType: "name",
    subjectKey: "1",
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
    speciesId: 1,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: "Bulbasaur",
    pokemonId: 1,
    cardType: "reverse",
    subjectKey: "1",
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

function makeReverseEvolutionCard(): ReverseEvolutionReviewCard {
  // Mirrors the shape produced by buildSession for reverse-evolution cards:
  // spread of EvolutionCard (preEvo*/postEvo* fields, triggerPhrase) + the
  // reverse-edge id, subjectKey, and state. NO `name`/`spriteUrl` — those
  // live on `preEvoName`/`postEvoName` etc. Regression test for the
  // persistence validator falling through to the non-evolution branch and
  // wiping every saved session that contained a rev-evo card (#343 follow-up).
  return {
    cardType: "reverse-evolution",
    id: REVERSE_EDGE_ID_BASE + 1,
    preEvoId: 1,
    preEvoName: "bulbasaur",
    preEvoSpriteUrl: "https://example.com/1.png",
    postEvoId: 2,
    postEvoName: "ivysaur",
    postEvoSpriteUrl: "https://example.com/2.png",
    triggerPhrase: "at level 16",
    subjectKey: "1>>>2",
    state: initialReviewState(NOW),
  } as ReverseEvolutionReviewCard;
}

// Reset the IDB database between tests to avoid state leaking.
async function resetIdb() {
  // Close the open DB connection first so deleteDatabase doesn't get blocked.
  await __resetForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("poke-memory");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // treat blocked as done
  });
}

describe("saveSession / loadSession (IDB-backed)", () => {
  beforeEach(async () => {
    await resetIdb();
    // Stub window for node env (fake-indexeddb doesn't attach window).
    vi.stubGlobal("window", {
      indexedDB: globalThis.indexedDB,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      dispatchEvent: () => true,
    });
    vi.stubGlobal("StorageEvent", class extends Event {
      key: string | null;
      storageArea: unknown;
      newValue: string | null;
      constructor(type: string, init: { key?: string | null; storageArea?: unknown; newValue?: string | null } = {}) {
        super(type);
        this.key = init.key ?? null;
        this.storageArea = init.storageArea ?? null;
        this.newValue = init.newValue ?? null;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns null when no session stored", async () => {
    const result = await loadSession();
    expect(result).toBeNull();
  });

  it("returns { ok: true } on successful save", async () => {
    const result = await saveSession({ cards: [makeReverseCard()], limits: defaultLimits });
    expect(result.ok).toBe(true);
  });

  it("round-trips a session through IDB", async () => {
    const card = makeReverseCard();
    await saveSession({ cards: [card], limits: defaultLimits });

    const loaded = await loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.cards).toHaveLength(1);
    expect(loaded!.cards[0].cardType).toBe("reverse");
    expect(loaded!.cards[0].state.dueDate).toBe(card.state.dueDate);
  });

  it("strips flavorTexts and evolutionChain from reverse cards before writing", async () => {
    const card = makeReverseCard();
    await saveSession({ cards: [card], limits: defaultLimits });

    const loaded = await loadSession();
    expect(loaded).not.toBeNull();
    // flavorTexts / evolutionChain are stripped by serializeCard
    const storedCard = loaded!.cards[0] as Record<string, unknown>;
    expect(storedCard.flavorTexts).toBeUndefined();
    expect(storedCard.evolutionChain).toBeUndefined();
    expect(storedCard.name).toBe("bulbasaur");
  });

  it("strips flavorTexts and evolutionChain from name cards before writing", async () => {
    const card = makeNameCard();
    await saveSession({ cards: [card], limits: defaultLimits });

    const loaded = await loadSession();
    expect(loaded).not.toBeNull();
    const storedCard = loaded!.cards[0] as Record<string, unknown>;
    expect(storedCard.flavorTexts).toBeUndefined();
    expect(storedCard.evolutionChain).toBeUndefined();
    expect(storedCard.name).toBe("bulbasaur");
  });

  it("preserves flavorText (singular) on name cards", async () => {
    const card = makeNameCard();
    await saveSession({ cards: [card], limits: defaultLimits });

    const loaded = await loadSession();
    expect(loaded).not.toBeNull();
    const storedCard = loaded!.cards[0] as Record<string, unknown>;
    expect(storedCard.flavorText).toBe("A strange seed was planted on its back at birth.");
  });

  // Regression: rev-evo cards (introduced in #343) inherit the EvolutionCard
  // shape — no top-level `name`/`spriteUrl`. The validator used to fall
  // through to the "non-evolution" branch and reject them, so parseSession
  // returned null for any session that included one and every reload silently
  // wiped the user's progress to a fresh-seed state. Force-pull-from-cloud
  // didn't "fix" it because the next reload re-parsed the freshly-written IDB
  // and threw it out again.
  it("round-trips a reverse-evolution card through IDB", async () => {
    const card = makeReverseEvolutionCard();
    await saveSession({ cards: [card], limits: defaultLimits });

    const loaded = await loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.cards).toHaveLength(1);
    expect(loaded!.cards[0].cardType).toBe("reverse-evolution");
    expect(loaded!.cards[0].id).toBe(card.id);
  });

  it("keeps the session valid when a name card and a rev-evo card are saved together", async () => {
    await saveSession({
      cards: [makeNameCard(), makeReverseEvolutionCard()],
      limits: defaultLimits,
    });

    const loaded = await loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.cards).toHaveLength(2);
    expect(loaded!.cards.map((c) => c.cardType).sort()).toEqual([
      "name",
      "reverse-evolution",
    ]);
  });

  it("falls back to localStorage when idbSet silently fails (isIdbAvailable returns false post-write)", async () => {
    const lsData: Record<string, string> = {};
    vi.stubGlobal("window", {
      indexedDB: globalThis.indexedDB,
      localStorage: {
        getItem: () => null,
        setItem: (k: string, v: string) => { lsData[k] = v; },
        removeItem: () => {},
      },
      dispatchEvent: () => true,
    });

    // Simulate idbSet silently failing: isIdbAvailable returns true on the
    // pre-write guard (so we enter the IDB path) but false after the write
    // (as if idbSet caught an internal error and flipped the flag).
    vi.spyOn(idbModule, "isIdbAvailable")
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const result = await saveSession({ cards: [makeReverseCard()], limits: defaultLimits });

    expect(result.ok).toBe(true);
    expect(lsData["poke-memory:review-session:v1"]).toBeDefined();
  });
});

describe("saveSession (synthetic StorageEvent dispatch)", () => {
  beforeEach(async () => {
    await resetIdb();
    vi.stubGlobal("StorageEvent", class extends Event {
      key: string | null;
      storageArea: unknown;
      newValue: string | null;
      constructor(type: string, init: { key?: string | null; storageArea?: unknown; newValue?: string | null } = {}) {
        super(type);
        this.key = init.key ?? null;
        this.storageArea = init.storageArea ?? null;
        this.newValue = init.newValue ?? null;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("dispatches a same-tab StorageEvent for the session key on a successful write", async () => {
    const dispatched: Event[] = [];
    vi.stubGlobal("window", {
      indexedDB: globalThis.indexedDB,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      dispatchEvent: (e: Event) => { dispatched.push(e); return true; },
    });

    const result = await saveSession({ cards: [makeReverseCard()], limits: defaultLimits });

    expect(result.ok).toBe(true);
    expect(dispatched).toHaveLength(1);
    expect((dispatched[0] as unknown as { key: string }).key).toBe(
      "poke-memory:review-session:v1",
    );
  });
});
