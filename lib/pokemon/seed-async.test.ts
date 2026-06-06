// lib/pokemon/seed-async.test.ts
// Unit tests for the async seed loader.
// Runs in the node project (lib/**) - no DOM, no React.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  loadSeed,
  getSeedIfLoaded,
  _resetSeedAsyncCache,
} from "./seed-async";
import {
  SEED_POKEMON,
  SEED_EVOLUTION_CARDS,
  SEED_REVERSE_EVOLUTION_CARDS,
} from "./seed";

// ---------------------------------------------------------------------------
// Helpers: build minimal fetch mock responses from the real generated JSON.
// We import the raw JSON directly (the node project can do this) to ensure
// the async path produces the same result as the sync path.
// ---------------------------------------------------------------------------

import coreData from "./generated-core.json";
import chainsData from "./generated-chains.json";

function makeFetchMock(overrides?: {
  coreStatus?: number;
  chainsStatus?: number;
  coreThrows?: boolean;
  chainsThrows?: boolean;
}) {
  const { coreStatus = 200, chainsStatus = 200, coreThrows = false, chainsThrows = false } =
    overrides ?? {};

  return vi.fn(async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
    if (urlStr.includes("generated-core.json")) {
      if (coreThrows) throw new Error("network error: core");
      return {
        ok: coreStatus === 200,
        status: coreStatus,
        json: async () => coreData,
      } as Response;
    }
    if (urlStr.includes("generated-chains.json")) {
      if (chainsThrows) throw new Error("network error: chains");
      return {
        ok: chainsStatus === 200,
        status: chainsStatus,
        json: async () => chainsData,
      } as Response;
    }
    throw new Error(`Unexpected fetch URL: ${urlStr}`);
  });
}

// ---------------------------------------------------------------------------
// Setup: reset cache + mock fetch before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetSeedAsyncCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetSeedAsyncCache();
});

// ---------------------------------------------------------------------------
// loadSeed - happy path
// ---------------------------------------------------------------------------

describe("loadSeed", () => {
  it("resolves with a SeedData containing non-empty arrays", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const seed = await loadSeed();
    expect(Array.isArray(seed.seedPokemon)).toBe(true);
    expect(seed.seedPokemon.length).toBeGreaterThan(0);
    expect(Array.isArray(seed.seedEvolutionCards)).toBe(true);
    expect(seed.seedEvolutionCards.length).toBeGreaterThan(0);
    expect(Array.isArray(seed.seedReverseEvolutionCards)).toBe(true);
    expect(seed.seedReverseEvolutionCards.length).toBeGreaterThan(0);
  });

  it("resolved arrays have the same lengths as the synchronous SEED_* exports", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const seed = await loadSeed();
    expect(seed.seedPokemon.length).toBe(SEED_POKEMON.length);
    expect(seed.seedEvolutionCards.length).toBe(SEED_EVOLUTION_CARDS.length);
    expect(seed.seedReverseEvolutionCards.length).toBe(SEED_REVERSE_EVOLUTION_CARDS.length);
  });

  it("calls fetch exactly twice (one for core, one for chains) on the first load", async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    await loadSeed();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("calling loadSeed() twice concurrently shares one in-flight fetch pair (no extra fetches)", async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    // Both calls are made before any microtask can run; they must share the
    // in-flight _loadPromise, not issue a second pair of fetch calls.
    const [r1, r2] = await Promise.all([loadSeed(), loadSeed()]);
    expect(r1).toBe(r2); // same resolved SeedData object from cache
    expect(fetchMock).toHaveBeenCalledTimes(2); // only one pair of fetches total
  });

  it("calling loadSeed() after it has resolved returns from cache without refetching", async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    await loadSeed();
    await loadSeed(); // second call - must hit cache
    expect(fetchMock).toHaveBeenCalledTimes(2); // still only the first pair
  });

  // ---------------------------------------------------------------------------
  // getSeedIfLoaded
  // ---------------------------------------------------------------------------

  it("getSeedIfLoaded returns null before loadSeed resolves", () => {
    expect(getSeedIfLoaded()).toBeNull();
  });

  it("getSeedIfLoaded returns the SeedData after loadSeed resolves", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const seed = await loadSeed();
    expect(getSeedIfLoaded()).toBe(seed);
  });

  // ---------------------------------------------------------------------------
  // Error paths
  // ---------------------------------------------------------------------------

  it("rejects when generated-core.json returns a non-200 status", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ coreStatus: 404 }));
    await expect(loadSeed()).rejects.toThrow(/generated-core\.json.*404/i);
  });

  it("rejects when generated-chains.json returns a non-200 status", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ chainsStatus: 503 }));
    await expect(loadSeed()).rejects.toThrow(/generated-chains\.json.*503/i);
  });

  it("rejects on a network error and resets _loadPromise so the next call re-fetches", async () => {
    // First call: network error on both
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );
    await expect(loadSeed()).rejects.toThrow(/network error/i);

    // After the failure getSeedIfLoaded is still null
    expect(getSeedIfLoaded()).toBeNull();

    // Second call: fetch succeeds - a fresh fetch pair is issued
    const fetchMock = makeFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const seed = await loadSeed();
    expect(seed.seedPokemon.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("resets _loadPromise on HTTP error so the next call re-fetches", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ coreStatus: 500 }));
    await expect(loadSeed()).rejects.toThrow();

    // _loadPromise was reset; next call can succeed
    vi.stubGlobal("fetch", makeFetchMock());
    const seed = await loadSeed();
    expect(seed.seedPokemon.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildSeed parity test
// Verifies that the async path (buildSeed(coreData, chainsData)) produces
// output identical in length and spot-checked entries to the synchronous
// SEED_POKEMON / SEED_EVOLUTION_CARDS / SEED_REVERSE_EVOLUTION_CARDS exports.
// This proves the seed.ts refactor is non-regressive.
// ---------------------------------------------------------------------------

import { buildSeed } from "./seed";

describe("buildSeed parity with synchronous SEED_* exports", () => {
  const built = buildSeed(coreData, chainsData);

  it("seedPokemon length matches SEED_POKEMON", () => {
    expect(built.seedPokemon.length).toBe(SEED_POKEMON.length);
  });

  it("seedEvolutionCards length matches SEED_EVOLUTION_CARDS", () => {
    expect(built.seedEvolutionCards.length).toBe(SEED_EVOLUTION_CARDS.length);
  });

  it("seedReverseEvolutionCards length matches SEED_REVERSE_EVOLUTION_CARDS", () => {
    expect(built.seedReverseEvolutionCards.length).toBe(SEED_REVERSE_EVOLUTION_CARDS.length);
  });

  it("Bulbasaur (#1) matches between async and sync paths", () => {
    const syncBulba = SEED_POKEMON.find((p) => p.id === 1);
    const asyncBulba = built.seedPokemon.find((p) => p.id === 1);
    expect(syncBulba).toBeDefined();
    expect(asyncBulba).toBeDefined();
    expect(asyncBulba!.name).toBe(syncBulba!.name);
    expect(asyncBulba!.evolutionChain.length).toBe(syncBulba!.evolutionChain.length);
  });

  it("Bulbasaur → Ivysaur edge ID matches between async and sync paths", () => {
    const syncEdge = SEED_EVOLUTION_CARDS.find(
      (c) => c.preEvoName === "Bulbasaur" && c.postEvoName === "Ivysaur",
    );
    const asyncEdge = built.seedEvolutionCards.find(
      (c) => c.preEvoName === "Bulbasaur" && c.postEvoName === "Ivysaur",
    );
    expect(syncEdge).toBeDefined();
    expect(asyncEdge).toBeDefined();
    expect(asyncEdge!.id).toBe(syncEdge!.id);
  });

  it("every reverse card ID matches between async and sync paths", () => {
    for (let i = 0; i < SEED_REVERSE_EVOLUTION_CARDS.length; i++) {
      expect(built.seedReverseEvolutionCards[i].id).toBe(
        SEED_REVERSE_EVOLUTION_CARDS[i].id,
      );
    }
  });

  it("every seedPokemon entry has flavorTexts set to undefined (lazy-load preserved)", () => {
    for (const p of built.seedPokemon) {
      expect(p.flavorTexts).toBeUndefined();
    }
  });
});
