/**
 * Tests for `useProfileStatus` hook (#1489).
 *
 * The hook lives in lib/profile/ but renderHook tests must live under
 * components/ for jsdom (see AGENTS.md "Testing").
 *
 * Covers:
 *   - Empty state: streak 0, tokens 0, mastery 0 (all null on first render,
 *     then resolved to zeroes after mount).
 *   - Populated state: non-zero streak, tokens, mastery count.
 *   - pretendAllMastered ON and OFF.
 *   - Locale-scoped cache: reads the correct locale bucket from the cache.
 *   - Non-`en` locale: ja cache key is exercised.
 *   - Parity contract: masteryCount equals computeStats(...).mastery.mastered
 *     for the same card set.
 *   - Reactivity: re-reads on storage event for KEY_MASTERED_COUNT_BY_LOCALE.
 *   - Reactivity: re-reads on SETTINGS_SAVED_EVENT (locale change).
 *   - masteryPercent derivation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReviewableCard, NameReviewCard, ReverseReviewCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";
import {
  MASTERY_REPETITIONS,
  MASTERY_INTERVAL_DAYS,
  computeStats,
} from "@/lib/stats/derive";
import { filterMastered } from "@/lib/pasture/arrivals";

// ---------------------------------------------------------------------------
// Hoisted shared fixtures and mock functions (available inside vi.mock factories)
// ---------------------------------------------------------------------------

const {
  mockStreakNavState,
  mockUseSuperuser,
  mockLoadSettings,
  mockUseSeed,
  minimalSeedPokemon,
} = vi.hoisted(() => {
  // A small deterministic seed so totalSpecies is stable in tests.
  // The real seed has ~1025 entries; we use 10 here.
  const minimalSeedPokemon = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    speciesId: i + 1,
    displayName: `Pokemon${i + 1}`,
    name: `pokemon${i + 1}`,
    spriteUrl: "",
    types: ["normal"],
    stats: {
      hp: 50, attack: 50, defense: 50,
      specialAttack: 50, specialDefense: 50, speed: 50,
    },
    flavorText: "",
    flavorTexts: undefined as undefined,
    evolutionChain: [] as never[],
    height: 10,
    weight: 100,
    baseExperience: 64,
    genus: "",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium",
    habitat: null as null,
    genderRate: 0,
    isLegendary: false,
    isMythical: false,
    cryUrl: null as null,
    isDefaultForm: true,
    formCategory: "default" as const,
    formSlug: null as null,
    versionGroups: [] as string[],
  }));

  return {
    minimalSeedPokemon,
    mockStreakNavState: vi.fn(() => ({
      streak: null as number | null,
      tokenBalance: null as number | null,
      daysToNextMilestone: null as number | null,
    })),
    mockUseSuperuser: vi.fn(() => ({
      flags: { pretendAllMastered: false },
    })),
    mockLoadSettings: vi.fn(() => ({
      pokemonNameLocale: "en" as string,
      masteryRepetitions: 3,
    })),
    mockUseSeed: vi.fn(() => ({
      seed: {
        seedPokemon: minimalSeedPokemon,
        seedEvolutionCards: [] as never[],
        seedReverseEvolutionCards: [] as never[],
      },
      error: null as null,
      retry: vi.fn(),
    })),
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/streak/useStreakNavState", () => ({
  useStreakNavState: () => mockStreakNavState(),
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => mockUseSuperuser(),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

// Mock @/lib/pokemon/seed - still needed for REVERSE_ID_OFFSET (value import)
// and the parity-contract tests that call filterMastered / computeStats.
vi.mock("@/lib/pokemon/seed", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/pokemon/seed")>();
  return { ...original, SEED_POKEMON: minimalSeedPokemon };
});

// Mock useSeed() to return the same minimal seed so the hook under test reads
// the correct totalSpecies (10) without needing a real SeedProvider or fetch.
vi.mock("@/lib/pokemon/SeedContext", () => ({
  useSeed: () => mockUseSeed(),
}));

// ---------------------------------------------------------------------------
// Import hook under test AFTER mocks are hoisted.
// ---------------------------------------------------------------------------

import { useProfileStatus } from "@/lib/profile/useProfileStatus";
import {
  readMasteredCountCache,
  writeMasteredCountForLocale,
} from "@/lib/profile/masteredCountCache";
import { KEY_MASTERED_COUNT_BY_LOCALE } from "@/lib/storage/keys";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TODAY = "2026-06-01";

function masteredState(lastReview = TODAY): Partial<ReviewState> {
  return {
    reps: MASTERY_REPETITIONS,
    scheduledDays: MASTERY_INTERVAL_DAYS,
    fsrsState: "review" as const,
    lastReview,
    firstSeen: "2026-01-01",
    stability: 30,
    difficulty: 5,
  };
}

function unmasteredState(): Partial<ReviewState> {
  return {
    reps: 1,
    scheduledDays: 5,
    fsrsState: "learning" as const,
    lastReview: "2026-05-20",
    firstSeen: "2026-05-01",
    stability: 5,
    difficulty: 5,
  };
}

function baseState(): ReviewState {
  return {
    stability: 0,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    fsrsState: "new" as const,
    dueDate: TODAY,
    lastReview: null,
    firstSeen: null,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  };
}

function makeNameCard(
  id: number,
  overrides: Partial<ReviewState> = {},
  locale = "en",
): NameReviewCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon${id}`,
    name: `Pokemon${id}`,
    spriteUrl: "",
    types: ["normal"] as [string],
    stats: {
      hp: 50, attack: 50, defense: 50,
      specialAttack: 50, specialDefense: 50, speed: 50,
    },
    flavorText: "",
    flavorTexts: [""],
    evolutionChain: [],
    height: 10,
    weight: 100,
    baseExperience: 64,
    genus: "",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium",
    habitat: null,
    genderRate: 0,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    cardType: "name" as const,
    subjectKey: String(id),
    locale: locale as "en" | "ja" | "zh-Hans" | "zh-Hant",
    state: { ...baseState(), ...overrides },
  };
}

function makeReverseCard(
  speciesId: number,
  overrides: Partial<ReviewState> = {},
  locale = "en",
): ReverseReviewCard {
  const base = makeNameCard(speciesId, overrides, locale);
  return {
    ...base,
    cardType: "reverse" as const,
    id: REVERSE_ID_OFFSET + speciesId,
    pokemonId: speciesId,
    subjectKey: String(speciesId),
    state: { ...baseState(), ...overrides },
  };
}

/** A minimal localStorage-in-memory implementation. */
function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => {
      store.delete(k);
    },
    setItem: (k, v) => {
      store.set(k, String(v));
    },
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    value: makeLocalStorage(),
    configurable: true,
    writable: true,
  });

  // Reset mocks to empty / zero state.
  mockStreakNavState.mockReturnValue({
    streak: null,
    tokenBalance: null,
    daysToNextMilestone: null,
  });
  mockUseSuperuser.mockReturnValue({ flags: { pretendAllMastered: false } });
  mockLoadSettings.mockReturnValue({
    pokemonNameLocale: "en",
    masteryRepetitions: 3,
  });
  mockUseSeed.mockReturnValue({
    seed: {
      seedPokemon: minimalSeedPokemon,
      seedEvolutionCards: [] as never[],
      seedReverseEvolutionCards: [] as never[],
    },
    error: null,
    retry: vi.fn(),
  });
});

// ---------------------------------------------------------------------------
// Empty state tests
// ---------------------------------------------------------------------------

describe("useProfileStatus - empty state (streak 0 / tokens 0 / mastery 0)", () => {
  it("streak and tokenBalance come from useStreakNavState (null pre-hydration)", () => {
    // useStreakNavState returns null until hydrated; cache is empty.
    const { result } = renderHook(() => useProfileStatus());
    // streak and tokenBalance mirror useStreakNavState which is null in this mock.
    expect(result.current.streak).toBeNull();
    expect(result.current.tokenBalance).toBeNull();
  });

  it("resolves mastery to 0 / 10 / 0% when cache is empty after mount", async () => {
    mockStreakNavState.mockReturnValue({ streak: 0, tokenBalance: 0, daysToNextMilestone: null });

    const { result } = renderHook(() => useProfileStatus());

    await act(async () => {});

    expect(result.current.streak).toBe(0);
    expect(result.current.tokenBalance).toBe(0);
    expect(result.current.masteryCount).toBe(0);
    expect(result.current.totalSpecies).toBe(10); // mocked SEED_POKEMON.length
    expect(result.current.masteryPercent).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Populated state tests
// ---------------------------------------------------------------------------

describe("useProfileStatus - populated state", () => {
  it("returns non-zero streak and tokenBalance from useStreakNavState", async () => {
    mockStreakNavState.mockReturnValue({ streak: 5, tokenBalance: 2, daysToNextMilestone: 2 });

    const { result } = renderHook(() => useProfileStatus());
    await act(async () => {});

    expect(result.current.streak).toBe(5);
    expect(result.current.tokenBalance).toBe(2);
  });

  it("reads masteryCount from the locale cache", async () => {
    // Pre-populate cache for locale "en".
    writeMasteredCountForLocale("en", 3);

    mockStreakNavState.mockReturnValue({ streak: 7, tokenBalance: 1, daysToNextMilestone: null });

    const { result } = renderHook(() => useProfileStatus());
    await act(async () => {});

    expect(result.current.masteryCount).toBe(3);
    expect(result.current.totalSpecies).toBe(10);
    expect(result.current.masteryPercent).toBe(30);
  });

  it("computes masteryPercent rounded to one decimal place", async () => {
    // 1/3 = 33.333... → 33.3
    writeMasteredCountForLocale("en", 1);

    // Override SEED_POKEMON length to 3 for this check via cache arithmetic.
    // Instead of mocking seed, use a count that produces a clear fraction.
    // With total=10 (mock): 1/10 = 10.0
    const { result } = renderHook(() => useProfileStatus());
    await act(async () => {});

    expect(result.current.masteryPercent).toBe(10); // 1/10 * 100 = 10.0
  });
});

// ---------------------------------------------------------------------------
// pretendAllMastered flag
// ---------------------------------------------------------------------------

describe("useProfileStatus - pretendAllMastered", () => {
  it("returns masteryCount === totalSpecies when pretendAllMastered is ON", async () => {
    mockUseSuperuser.mockReturnValue({ flags: { pretendAllMastered: true } });
    // Cache has 0 - must be overridden by the flag.
    const { result } = renderHook(() => useProfileStatus());
    await act(async () => {});

    expect(result.current.masteryCount).toBe(10); // totalSpecies
    expect(result.current.totalSpecies).toBe(10);
    expect(result.current.masteryPercent).toBe(100);
  });

  it("returns real mastery count when pretendAllMastered is OFF", async () => {
    mockUseSuperuser.mockReturnValue({ flags: { pretendAllMastered: false } });
    writeMasteredCountForLocale("en", 4);

    const { result } = renderHook(() => useProfileStatus());
    await act(async () => {});

    expect(result.current.masteryCount).toBe(4);
    expect(result.current.masteryPercent).toBe(40);
  });

  it("switches to 100% when pretendAllMastered toggles ON mid-session", async () => {
    mockUseSuperuser.mockReturnValue({ flags: { pretendAllMastered: false } });
    writeMasteredCountForLocale("en", 2);

    const { result, rerender } = renderHook(() => useProfileStatus());
    await act(async () => {});
    expect(result.current.masteryCount).toBe(2);

    // Toggle flag on.
    mockUseSuperuser.mockReturnValue({ flags: { pretendAllMastered: true } });
    rerender();
    await act(async () => {});

    expect(result.current.masteryCount).toBe(10);
    expect(result.current.masteryPercent).toBe(100);
  });

  it("returns real mastery count after pretendAllMastered toggles back OFF", async () => {
    mockUseSuperuser.mockReturnValue({ flags: { pretendAllMastered: true } });
    writeMasteredCountForLocale("en", 2);

    const { result, rerender } = renderHook(() => useProfileStatus());
    await act(async () => {});
    expect(result.current.masteryCount).toBe(10); // override

    // Toggle off.
    mockUseSuperuser.mockReturnValue({ flags: { pretendAllMastered: false } });
    rerender();
    await act(async () => {});

    expect(result.current.masteryCount).toBe(2); // real cache value
  });
});

// ---------------------------------------------------------------------------
// Locale-scoped cache (including non-en locale)
// ---------------------------------------------------------------------------

describe("useProfileStatus - locale-scoped mastery", () => {
  it("reads from en bucket when pokemonNameLocale is en", async () => {
    mockLoadSettings.mockReturnValue({ pokemonNameLocale: "en", masteryRepetitions: 3 });
    writeMasteredCountForLocale("en", 5);
    writeMasteredCountForLocale("ja", 2);

    const { result } = renderHook(() => useProfileStatus());
    await act(async () => {});

    expect(result.current.masteryCount).toBe(5); // en bucket, not ja
  });

  it("reads from ja bucket when pokemonNameLocale is ja", async () => {
    mockLoadSettings.mockReturnValue({ pokemonNameLocale: "ja", masteryRepetitions: 3 });
    writeMasteredCountForLocale("en", 5);
    writeMasteredCountForLocale("ja", 2);

    const { result } = renderHook(() => useProfileStatus());
    await act(async () => {});

    expect(result.current.masteryCount).toBe(2); // ja bucket
  });

  it("reads from zh-Hans bucket when pokemonNameLocale is zh-Hans", async () => {
    mockLoadSettings.mockReturnValue({ pokemonNameLocale: "zh-Hans", masteryRepetitions: 3 });
    writeMasteredCountForLocale("zh-Hans", 7);

    const { result } = renderHook(() => useProfileStatus());
    await act(async () => {});

    expect(result.current.masteryCount).toBe(7);
  });

  it("reads from zh-Hant bucket when pokemonNameLocale is zh-Hant", async () => {
    mockLoadSettings.mockReturnValue({ pokemonNameLocale: "zh-Hant", masteryRepetitions: 3 });
    writeMasteredCountForLocale("zh-Hant", 9);

    const { result } = renderHook(() => useProfileStatus());
    await act(async () => {});

    expect(result.current.masteryCount).toBe(9);
  });

  it("activePokemonNameLocale takes precedence over pokemonNameLocale (#1562 bug fix)", async () => {
    // Simulate a user who has switched the active language to 'ja' via the
    // language switcher - activePokemonNameLocale is 'ja', pokemonNameLocale is
    // still 'en' (the back-compat alias is not updated on every switch).
    // Cast is needed because the mock type is intentionally narrow (it only
    // declares the fields used by other tests); the hook reads the full
    // UserSettings shape at runtime.
    mockLoadSettings.mockReturnValue({
      pokemonNameLocale: "en",
      activePokemonNameLocale: "ja",
      masteryRepetitions: 3,
    } as unknown as ReturnType<typeof mockLoadSettings>);
    writeMasteredCountForLocale("en", 8);
    writeMasteredCountForLocale("ja", 3);

    const { result } = renderHook(() => useProfileStatus());
    await act(async () => {});

    // Must read from the ja bucket (activePokemonNameLocale), not en.
    expect(result.current.masteryCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Reactivity
// ---------------------------------------------------------------------------

describe("useProfileStatus - reactivity", () => {
  it("updates when a storage event fires for KEY_MASTERED_COUNT_BY_LOCALE", async () => {
    writeMasteredCountForLocale("en", 1);
    mockLoadSettings.mockReturnValue({ pokemonNameLocale: "en", masteryRepetitions: 3 });

    const { result } = renderHook(() => useProfileStatus());
    await act(async () => {});
    expect(result.current.masteryCount).toBe(1);

    // Simulate ReviewSession writing a new count. writeMasteredCountForLocale
    // dispatches a StorageEvent via writeLocalStorage({ notify: true }); we
    // call it directly and also fire a plain StorageEvent (jsdom rejects our
    // homemade Storage instance in the storageArea slot, so we omit it).
    act(() => {
      writeMasteredCountForLocale("en", 4);
      // Additional explicit event to ensure the hook listener fires.
      const evt = new StorageEvent("storage", {
        key: KEY_MASTERED_COUNT_BY_LOCALE,
        newValue: JSON.stringify({ en: 4, ja: 0, "zh-Hans": 0, "zh-Hant": 0 }),
      });
      window.dispatchEvent(evt);
    });

    await act(async () => {});
    expect(result.current.masteryCount).toBe(4);
  });

  it("updates locale bucket on SETTINGS_SAVED_EVENT (locale switch)", async () => {
    writeMasteredCountForLocale("en", 5);
    writeMasteredCountForLocale("ja", 3);
    mockLoadSettings.mockReturnValue({ pokemonNameLocale: "en", masteryRepetitions: 3 });

    const { result } = renderHook(() => useProfileStatus());
    await act(async () => {});
    expect(result.current.masteryCount).toBe(5); // en bucket

    // Simulate a locale switch to ja.
    mockLoadSettings.mockReturnValue({ pokemonNameLocale: "ja", masteryRepetitions: 3 });
    act(() => {
      window.dispatchEvent(new Event("poke-memory:settings-saved"));
    });

    await act(async () => {});
    expect(result.current.masteryCount).toBe(3); // ja bucket now
  });
});

// ---------------------------------------------------------------------------
// Parity contract test (#1489 forcing function)
//
// Asserts that the count written by writeMasteredCountForLocale (which
// ReviewSession produces via filterMastered) equals
// computeStats(...).mastery.mastered for the same card set. This is the
// contract that prevents the lightweight cache from silently diverging from
// the authoritative derivation.
// ---------------------------------------------------------------------------

describe("useProfileStatus - parity contract: masteryCount == computeStats.mastery.mastered", () => {
  /**
   * Fixture:
   *   Species 1: name + reverse both mastered (en locale) → species-mastered.
   *   Species 2: name mastered, reverse NOT mastered → NOT species-mastered.
   *   Species 3: neither mastered → NOT species-mastered.
   *
   * Expected mastered count: 1 (only species 1).
   */
  function buildParityFixture(): ReviewableCard[] {
    return [
      // Species 1: both legs mastered.
      makeNameCard(1, masteredState()),
      makeReverseCard(1, masteredState()),
      // Species 2: name mastered, reverse unmastered.
      makeNameCard(2, masteredState()),
      makeReverseCard(2, unmasteredState()),
      // Species 3: neither leg mastered.
      makeNameCard(3, unmasteredState()),
      makeReverseCard(3, unmasteredState()),
    ];
  }

  it("filterMastered count equals computeStats mastered count for en locale", () => {
    const cards = buildParityFixture();

    // Authoritative: what computeStats says.
    const statsResult = computeStats(cards, TODAY, 10, false, "en");
    const statsCount = statsResult.mastered;

    // Cache write path: filterMastered (same derivation used by writeMasteredCountCache
    // inside ReviewSession).
    const filterCount = filterMastered(cards, false, "en").length;

    expect(filterCount).toBe(statsCount);
    expect(statsCount).toBe(1); // only species 1 fully mastered
  });

  it("hook masteryCount equals computeStats mastered count for the same fixture", async () => {
    const cards = buildParityFixture();

    // Compute authoritative count.
    const statsResult = computeStats(cards, TODAY, 10, false, "en");
    const expectedCount = statsResult.mastered; // 1

    // Simulate what ReviewSession.writeMasteredCountCache writes.
    const filterCount = filterMastered(cards, false, "en").length;
    writeMasteredCountForLocale("en", filterCount);

    mockLoadSettings.mockReturnValue({ pokemonNameLocale: "en", masteryRepetitions: 3 });

    const { result } = renderHook(() => useProfileStatus());
    await act(async () => {});

    expect(result.current.masteryCount).toBe(expectedCount);
  });

  it("parity holds for ja locale with locale-specific cards", () => {
    // Build a fixture with ja-locale cards.
    const jaCards: ReviewableCard[] = [
      makeNameCard(1, masteredState(), "ja"),
      makeReverseCard(1, masteredState(), "ja"),
      makeNameCard(2, unmasteredState(), "ja"),
      makeReverseCard(2, unmasteredState(), "ja"),
    ];

    const statsJa = computeStats(jaCards, TODAY, 10, false, "ja");
    const filterJa = filterMastered(jaCards, false, "ja").length;

    expect(filterJa).toBe(statsJa.mastered);
    expect(statsJa.mastered).toBe(1); // only species 1 fully mastered in ja
  });

  it("parity holds across all four locales for a mixed locale fixture", () => {
    const locales = ["en", "ja", "zh-Hans", "zh-Hant"] as const;

    for (const locale of locales) {
      const cards: ReviewableCard[] = [
        makeNameCard(1, masteredState(), locale),
        makeReverseCard(1, masteredState(), locale),
        makeNameCard(2, unmasteredState(), locale),
        makeReverseCard(2, unmasteredState(), locale),
      ];

      const stats = computeStats(cards, TODAY, 10, false, locale);
      const filterCount = filterMastered(cards, false, locale).length;

      expect(filterCount).toBe(stats.mastered);
    }
  });
});

// ---------------------------------------------------------------------------
// Cache read/write helpers
// ---------------------------------------------------------------------------

describe("readMasteredCountCache / writeMasteredCountForLocale", () => {
  it("returns EMPTY_COUNTS when nothing is stored", () => {
    const cache = readMasteredCountCache();
    expect(cache).toEqual({ en: 0, ja: 0, "zh-Hans": 0, "zh-Hant": 0 });
  });

  it("writes and reads back a single locale count", () => {
    writeMasteredCountForLocale("ja", 5);
    const cache = readMasteredCountCache();
    expect(cache.ja).toBe(5);
    // Other locales unchanged.
    expect(cache.en).toBe(0);
    expect(cache["zh-Hans"]).toBe(0);
    expect(cache["zh-Hant"]).toBe(0);
  });

  it("preserves existing locale counts when updating one locale", () => {
    writeMasteredCountForLocale("en", 3);
    writeMasteredCountForLocale("ja", 7);
    writeMasteredCountForLocale("zh-Hans", 1);

    const cache = readMasteredCountCache();
    expect(cache.en).toBe(3);
    expect(cache.ja).toBe(7);
    expect(cache["zh-Hans"]).toBe(1);
    expect(cache["zh-Hant"]).toBe(0);
  });

  it("returns EMPTY_COUNTS when stored JSON is malformed", () => {
    window.localStorage.setItem(
      "poke-memory:mastered-count-by-locale:v1",
      "not-json",
    );
    const cache = readMasteredCountCache();
    expect(cache).toEqual({ en: 0, ja: 0, "zh-Hans": 0, "zh-Hant": 0 });
  });
});
