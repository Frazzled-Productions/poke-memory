/**
 * Tests for SeedProvider / useSeed (#1677).
 *
 * Covers:
 * - seed is null before loadSeed resolves (initial state).
 * - seed is populated after loadSeed resolves.
 * - error is set when loadSeed rejects.
 * - retry() clears the error and re-invokes loadSeed.
 *
 * Lives under components/ so renderHook runs in the jsdom project (the node
 * project has no DOM and renderHook would fail with ReferenceError: document
 * is not defined).
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SeedProvider, useSeed } from "@/lib/pokemon/SeedContext";
import type { SeedData } from "@/lib/pokemon/seed-async";

// ---------------------------------------------------------------------------
// Minimal SeedData fixture
// ---------------------------------------------------------------------------

const MOCK_SEED: SeedData = {
  seedPokemon: [
    {
      id: 1,
      speciesId: 1,
      isDefaultForm: true,
      formCategory: "default",
      formSlug: null,
      displayName: "Bulbasaur",
      name: "bulbasaur",
      spriteUrl: "/sprites/1.png",
      types: ["grass", "poison"],
      stats: {
        hp: 45,
        attack: 49,
        defense: 49,
        specialAttack: 65,
        specialDefense: 65,
        speed: 45,
      },
      flavorText: "A strange seed.",
      flavorTexts: undefined,
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
      cryUrl: null,
    },
  ],
  seedEvolutionCards: [],
  seedReverseEvolutionCards: [],
};

// ---------------------------------------------------------------------------
// Mock seed-async
// ---------------------------------------------------------------------------

// We use a resolvable promise so we can control when loadSeed resolves/rejects
// in each test.
let resolveSeed: (data: SeedData) => void;
let rejectSeed: (err: Error) => void;

const mockLoadSeed = vi.fn<() => Promise<SeedData>>();

vi.mock("@/lib/pokemon/seed-async", () => ({
  loadSeed: (...args: Parameters<typeof mockLoadSeed>) => mockLoadSeed(...args),
  getSeedIfLoaded: () => null,
}));

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  return <SeedProvider>{children}</SeedProvider>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockLoadSeed.mockImplementation(
    () =>
      new Promise<SeedData>((resolve, reject) => {
        resolveSeed = resolve;
        rejectSeed = reject;
      }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useSeed - initial state", () => {
  it("returns seed: null and error: null before loadSeed resolves", () => {
    const { result } = renderHook(() => useSeed(), { wrapper });
    expect(result.current.seed).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

describe("useSeed - successful load", () => {
  it("seed is populated after loadSeed resolves", async () => {
    const { result } = renderHook(() => useSeed(), { wrapper });

    expect(result.current.seed).toBeNull();

    await act(async () => {
      resolveSeed(MOCK_SEED);
    });

    await waitFor(() => {
      expect(result.current.seed).toBe(MOCK_SEED);
    });
    expect(result.current.error).toBeNull();
  });
});

describe("useSeed - error state", () => {
  it("error is set when loadSeed rejects", async () => {
    const { result } = renderHook(() => useSeed(), { wrapper });

    await act(async () => {
      rejectSeed(new Error("fetch failed"));
    });

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });
    expect(result.current.error!.message).toMatch(/fetch failed/);
    expect(result.current.seed).toBeNull();
  });
});

describe("useSeed - retry", () => {
  it("retry() clears the error and re-invokes loadSeed", async () => {
    // Set up first call to fail, second to succeed.
    let callCount = 0;
    mockLoadSeed.mockImplementation(
      () =>
        new Promise<SeedData>((resolve, reject) => {
          callCount++;
          if (callCount === 1) {
            // First call: reject immediately
            reject(new Error("first attempt failed"));
          } else {
            // Subsequent calls: resolve with mock seed
            resolveSeed = resolve;
          }
        }),
    );

    const { result } = renderHook(() => useSeed(), { wrapper });

    // Wait for the first call to fail
    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });

    // Retry - this should clear the error and trigger a second loadSeed call
    await act(async () => {
      result.current.retry();
    });

    // Resolve the second call
    await act(async () => {
      resolveSeed(MOCK_SEED);
    });

    await waitFor(() => {
      expect(result.current.seed).toBe(MOCK_SEED);
    });
    expect(result.current.error).toBeNull();
    expect(mockLoadSeed).toHaveBeenCalledTimes(2);
  });
});
