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
  // reverse-edge id, subjectKey, and state. NO `name`/`spriteUrl` - those
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
  // shape - no top-level `name`/`spriteUrl`. The validator used to fall
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

// ─── New IDB-path tests (closes #1015) ────────────────────────────────────────
//
// The three scenarios below were not covered by the existing suite:
//   A) loadSession when isIdbAvailable() is already false on entry - must
//      skip IDB entirely and delegate straight to loadSessionLS.
//   B) loadSession when idbGet itself throws - the catch branch on line 326 in
//      persistence.ts must fall back to loadSessionLS rather than propagating.
//   C) loadSession when IDB has no entry for the key - must fall back to
//      loadSessionLS as a last resort (covers the localStorage-to-IDB migration
//      window documented in the inline comment).
//   D) saveSession when idbSet swallows an internal error (real idb-layer
//      failure, not just a mocked isIdbAvailable result) - the post-write
//      availability check must detect the flip and write to localStorage instead.
//
// Tests A–C use vi.spyOn on the already-imported idbModule bindings.
// Test D uses vi.resetModules() + vi.doMock('idb', …) + dynamic imports so the
// real idbSet / saveSession run against a module whose underlying idb.put always
// rejects - matching the pattern used in lib/idb/db.test.ts error-flip tests.

describe("loadSession - IDB unavailable on entry (isIdbAvailable returns false)", () => {
  // Minimal localStorage stub with a valid saved session.
  const validSessionJson = JSON.stringify({
    cards: [],
    limits: DEFAULT_LIMITS,
  });

  beforeEach(async () => {
    await resetIdb();
    vi.stubGlobal("window", {
      indexedDB: globalThis.indexedDB,
      localStorage: {
        getItem: (_k: string) => validSessionJson,
        setItem: () => {},
        removeItem: () => {},
      },
      dispatchEvent: () => true,
    });
    vi.stubGlobal("StorageEvent", class extends Event {
      key: string | null = null;
      storageArea: unknown = null;
      newValue: string | null = null;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("delegates to loadSessionLS without touching IDB when isIdbAvailable returns false", async () => {
    // Force isIdbAvailable to report false on the entry guard inside loadSession.
    vi.spyOn(idbModule, "isIdbAvailable").mockReturnValue(false);
    // idbGet must not be called - spy to detect any accidental call.
    const idbGetSpy = vi.spyOn(idbModule, "idbGet");

    const result = await loadSession();

    // localStorage had a valid (empty-cards) session - loadSessionLS should
    // have returned it.
    expect(result).not.toBeNull();
    expect(result!.cards).toHaveLength(0);
    // idbGet must never have been called.
    expect(idbGetSpy).not.toHaveBeenCalled();
  });

  it("returns null when isIdbAvailable is false and localStorage is also empty", async () => {
    vi.stubGlobal("window", {
      indexedDB: globalThis.indexedDB,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      dispatchEvent: () => true,
    });
    vi.spyOn(idbModule, "isIdbAvailable").mockReturnValue(false);

    const result = await loadSession();
    expect(result).toBeNull();
  });
});

describe("loadSession - IDB read throws, falls back to localStorage", () => {
  const validSessionJson = JSON.stringify({
    cards: [],
    limits: DEFAULT_LIMITS,
  });

  beforeEach(async () => {
    await resetIdb();
    vi.stubGlobal("window", {
      indexedDB: globalThis.indexedDB,
      localStorage: {
        getItem: (_k: string) => validSessionJson,
        setItem: () => {},
        removeItem: () => {},
      },
      dispatchEvent: () => true,
    });
    vi.stubGlobal("StorageEvent", class extends Event {
      key: string | null = null;
      storageArea: unknown = null;
      newValue: string | null = null;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("falls back to localStorage when idbGet throws", async () => {
    // idbGet is available (isIdbAvailable returns true) but the read itself
    // throws - persistence.ts's catch block on line ~326 must rescue this and
    // delegate to loadSessionLS.
    vi.spyOn(idbModule, "idbGet").mockRejectedValue(new DOMException("UnknownError"));

    const result = await loadSession();

    // The catch branch should have called loadSessionLS which reads from the
    // localStorage stub above (validSessionJson has an empty cards array).
    expect(result).not.toBeNull();
    expect(result!.cards).toHaveLength(0);
  });

  it("returns null when idbGet throws and localStorage is also empty", async () => {
    vi.stubGlobal("window", {
      indexedDB: globalThis.indexedDB,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      dispatchEvent: () => true,
    });
    vi.spyOn(idbModule, "idbGet").mockRejectedValue(new DOMException("UnknownError"));

    const result = await loadSession();
    expect(result).toBeNull();
  });
});

describe("loadSession - IDB returns null, falls back to localStorage", () => {
  // Covers the window between migrateFromLocalStorage running and a fresh
  // install: IDB has no entry for the key, so loadSession checks localStorage
  // as a last resort (the comment at line ~321 in persistence.ts explains this).
  beforeEach(async () => {
    await resetIdb();
    vi.stubGlobal("StorageEvent", class extends Event {
      key: string | null = null;
      storageArea: unknown = null;
      newValue: string | null = null;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads from localStorage when IDB has no entry for the session key", async () => {
    const card = makeNameCard();
    const lsJson = JSON.stringify({ cards: [{ ...card, flavorTexts: undefined, evolutionChain: undefined }], limits: DEFAULT_LIMITS });

    vi.stubGlobal("window", {
      indexedDB: globalThis.indexedDB,
      localStorage: {
        getItem: (k: string) => (k === "poke-memory:review-session:v1" ? lsJson : null),
        setItem: () => {},
        removeItem: () => {},
      },
      dispatchEvent: () => true,
    });

    // idbGet will return null for a key not in IDB (IDB is empty after resetIdb).
    const result = await loadSession();

    expect(result).not.toBeNull();
    expect(result!.cards).toHaveLength(1);
    expect(result!.cards[0].cardType).toBe("name");
  });

  it("returns null when both IDB and localStorage have no session", async () => {
    vi.stubGlobal("window", {
      indexedDB: globalThis.indexedDB,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      dispatchEvent: () => true,
    });

    // IDB is empty, localStorage returns null - loadSession must return null.
    const result = await loadSession();
    expect(result).toBeNull();
  });
});

describe("saveSession - real idbSet failure swallowed, localStorage fallback triggered", () => {
  // Uses vi.resetModules() + vi.doMock('idb', …) so both the db.ts module
  // (which holds the idbAvailable flag) and persistence.ts run against a
  // mocked idb whose db.put always rejects. This exercises the full path:
  //   idbSet called → db.put throws → idbSet catches, flips idbAvailable →
  //   saveSession checks isIdbAvailable post-write, finds false →
  //   falls back to saveSessionLS.
  //
  // This is a white-box integration test within the lib layer; it does NOT
  // mock isIdbAvailable itself.

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("window", {
      indexedDB: globalThis.indexedDB,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      dispatchEvent: () => true,
    });
    vi.stubGlobal("StorageEvent", class extends Event {
      key: string | null = null;
      storageArea: unknown = null;
      newValue: string | null = null;
    });
    // Mock the idb module so db.put always rejects, simulating a quota or
    // corruption error that idbSet will catch and swallow.
    vi.doMock("idb", () => ({
      openDB: vi.fn().mockResolvedValue({
        objectStoreNames: { contains: () => true },
        get: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockRejectedValue(new DOMException("QuotaExceededError")),
        delete: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      }),
    }));
  });

  afterEach(async () => {
    vi.doUnmock("idb");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("writes to localStorage when idbSet swallows a real put-rejection", async () => {
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

    // Dynamic imports pick up the vi.doMock above.
    const { saveSession: save } = await import("./persistence");

    const result = await save({ cards: [makeReverseCard()], limits: DEFAULT_LIMITS });

    // idbSet swallowed the error and flipped idbAvailable - saveSession must
    // have fallen back to saveSessionLS, written to localStorage, and returned
    // { ok: true }.
    expect(result.ok).toBe(true);
    expect(lsData["poke-memory:review-session:v1"]).toBeDefined();
  });

  it("returns { ok: true } when the localStorage fallback write succeeds after idbSet failure", async () => {
    const { saveSession: save } = await import("./persistence");
    const result = await save({ cards: [], limits: DEFAULT_LIMITS });
    expect(result.ok).toBe(true);
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
    // saveSession dispatches two events: a synthetic StorageEvent (to wake
    // same-tab useLocalStorageKey subscribers) and a CustomEvent for the
    // SESSION_CHANGED_EVENT channel (to wake BottomTabBar on WebKit).
    expect(dispatched).toHaveLength(2);
    expect((dispatched[0] as unknown as { key: string }).key).toBe(
      "poke-memory:review-session:v1",
    );
    expect(dispatched[1].type).toBe("poke-memory:session-changed");
  });
});
