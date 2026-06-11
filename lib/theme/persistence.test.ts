import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadFavourite, saveFavourite, isFavouriteEarned, masteredSpeciesUnion } from "./persistence";
import { CURATED_POKEMON } from "./curated-pokemon";
import { initialReviewState } from "@/lib/srs/scheduler";
import type { ReviewState } from "@/lib/srs/scheduler";
import { MASTERY_INTERVAL_DAYS } from "@/lib/stats/derive";
import type { ReviewableCard } from "@/lib/review/session";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed-constants";
import { filterMastered } from "@/lib/pasture/arrivals";
import { masteredSpeciesIds } from "@/lib/badges/derive";

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

const SETTINGS_KEY = "poke-memory:settings:v1";
const LEGACY_KEY = "poke-memory:favourite:v1";

// Use a real curated Pokémon so name lookup succeeds.
const SAMPLE = CURATED_POKEMON[0];
const SAMPLE_FAV = {
  id: SAMPLE.id,
  name: SAMPLE.name,
  colors: SAMPLE.colors,
  spriteUrl: `/sprites/pokemon/${SAMPLE.id}.png`,
};

describe("loadFavourite", () => {
  let storage: ReturnType<typeof makeMockStorage>;

  beforeEach(() => {
    storage = makeMockStorage();
    vi.stubGlobal("window", { localStorage: storage, dispatchEvent: vi.fn() });
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when neither settings.favouriteTheme nor legacy key are set", () => {
    expect(loadFavourite()).toBeNull();
  });

  it("returns the favourite from settings when present", () => {
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ favouriteTheme: SAMPLE_FAV }),
    );
    expect(loadFavourite()).toEqual(SAMPLE_FAV);
  });

  it("migrates the legacy poke-memory:favourite:v1 key into settings on first read", () => {
    storage.setItem(LEGACY_KEY, JSON.stringify(SAMPLE_FAV));
    expect(storage.getItem(SETTINGS_KEY)).toBeNull();

    const loaded = loadFavourite();
    expect(loaded).toEqual(SAMPLE_FAV);

    // Legacy key was removed.
    expect(storage.getItem(LEGACY_KEY)).toBeNull();

    // Settings now contains the migrated favourite.
    const settingsRaw = storage.getItem(SETTINGS_KEY);
    expect(settingsRaw).not.toBeNull();
    const settings = JSON.parse(settingsRaw!);
    expect(settings.favouriteTheme).toEqual(SAMPLE_FAV);
  });

  it("rejects a favourite with an unknown Pokémon id", () => {
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        favouriteTheme: { ...SAMPLE_FAV, id: 999999 },
      }),
    );
    expect(loadFavourite()).toBeNull();
  });

  it("rejects a favourite with malformed colours", () => {
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        favouriteTheme: { ...SAMPLE_FAV, colors: { ...SAMPLE_FAV.colors, primary: "not-hex" } },
      }),
    );
    expect(loadFavourite()).toBeNull();
  });
});

describe("saveFavourite", () => {
  let storage: ReturnType<typeof makeMockStorage>;

  beforeEach(() => {
    storage = makeMockStorage();
    vi.stubGlobal("window", { localStorage: storage, dispatchEvent: vi.fn() });
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes the entry into settings.favouriteTheme", () => {
    saveFavourite(SAMPLE, "/sprites/pokemon/1.png");
    const settings = JSON.parse(storage.getItem(SETTINGS_KEY)!);
    expect(settings.favouriteTheme).toEqual({
      id: SAMPLE.id,
      name: SAMPLE.name,
      colors: SAMPLE.colors,
      spriteUrl: "/sprites/pokemon/1.png",
    });
  });

  it("clears settings.favouriteTheme when passed null", () => {
    saveFavourite(SAMPLE);
    saveFavourite(null);
    const settings = JSON.parse(storage.getItem(SETTINGS_KEY)!);
    expect(settings.favouriteTheme).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Helpers for building paired ReviewableCard fixtures (name + reverse).
// masteredSpeciesIds requires BOTH legs to report a species as mastered.
// ---------------------------------------------------------------------------

function masteredState(): ReviewState {
  return {
    ...initialReviewState(new Date("2026-05-13")),
    reps: 5,
    // stability >= 21 is the mastery gate since #1765.
    stability: 21,
    scheduledDays: MASTERY_INTERVAL_DAYS + 1,
    lastReview: "2026-05-12",
  };
}

function learningState(): ReviewState {
  return {
    ...initialReviewState(new Date("2026-05-13")),
    reps: 2,
    stability: 5,
    scheduledDays: 3,
    lastReview: "2026-05-12",
  };
}

/** Build a minimal name card for `speciesId` with the given state and locale. */
function nameCard(
  speciesId: number,
  state: ReviewState,
  locale: "en" | "ja" | "zh-Hans" | "zh-Hant" = "en",
): ReviewableCard {
  return {
    cardType: "name",
    id: speciesId,
    subjectKey: String(speciesId),
    displayName: "Test",
    spriteUrl: null,
    types: [],
    locale,
    state,
  } as unknown as ReviewableCard;
}

/** Build a minimal reverse card for `speciesId` with the given state and locale. */
function reverseCard(
  speciesId: number,
  state: ReviewState,
  locale: "en" | "ja" | "zh-Hans" | "zh-Hant" = "en",
): ReviewableCard {
  return {
    cardType: "reverse",
    id: REVERSE_ID_OFFSET + speciesId,
    subjectKey: String(speciesId),
    pokemonId: speciesId,
    displayName: "Test",
    spriteUrl: null,
    types: [],
    locale,
    state,
  } as unknown as ReviewableCard;
}

describe("isFavouriteEarned (#1865 species-level mastery)", () => {
  it("returns true when favourite is null", () => {
    expect(isFavouriteEarned(null, [], false, ["en"])).toBe(true);
  });

  it("returns true when BOTH name and reverse legs are mastered (en)", () => {
    const cards = [
      nameCard(SAMPLE.id, masteredState()),
      reverseCard(SAMPLE.id, masteredState()),
    ];
    expect(isFavouriteEarned(SAMPLE_FAV, cards, false, ["en"])).toBe(true);
  });

  it("returns false when only the name leg is mastered (single-leg lock, #1865 regression)", () => {
    // This is the core regression fix (#1865): name-only mastery must NOT earn the theme.
    const cards = [
      nameCard(SAMPLE.id, masteredState()),
      reverseCard(SAMPLE.id, learningState()),
    ];
    expect(isFavouriteEarned(SAMPLE_FAV, cards, false, ["en"])).toBe(false);
  });

  it("returns false when only the reverse leg is mastered", () => {
    const cards = [
      nameCard(SAMPLE.id, learningState()),
      reverseCard(SAMPLE.id, masteredState()),
    ];
    expect(isFavouriteEarned(SAMPLE_FAV, cards, false, ["en"])).toBe(false);
  });

  it("returns false when the favourite species has no cards", () => {
    expect(isFavouriteEarned(SAMPLE_FAV, [], false, ["en"])).toBe(false);
  });

  it("returns true when forceAllMastered is on (superuser pretendAllMastered)", () => {
    // No cards at all - the flag short-circuits mastery.
    expect(isFavouriteEarned(SAMPLE_FAV, [], true, ["en"])).toBe(true);
  });

  it("mastered when stability >= 21; not mastered when stability < 21 (#1765 stability gate)", () => {
    const masteredCards = [
      nameCard(SAMPLE.id, masteredState()),
      reverseCard(SAMPLE.id, masteredState()),
    ];
    expect(isFavouriteEarned(SAMPLE_FAV, masteredCards, false, ["en"])).toBe(true);

    const learningCards = [
      nameCard(SAMPLE.id, learningState()),
      reverseCard(SAMPLE.id, learningState()),
    ];
    expect(isFavouriteEarned(SAMPLE_FAV, learningCards, false, ["en"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Any-enrolled-locale union check (#1865, building on #1851)
// ---------------------------------------------------------------------------

describe("isFavouriteEarned locale axis (#1865)", () => {
  it("is earned when species is mastered in ja, learningLocales includes ja", () => {
    const cards = [
      nameCard(SAMPLE.id, masteredState(), "ja"),
      reverseCard(SAMPLE.id, masteredState(), "ja"),
    ];
    // learningLocales = ["en", "ja"]: union across locales, ja leg is mastered.
    expect(isFavouriteEarned(SAMPLE_FAV, cards, false, ["en", "ja"])).toBe(true);
  });

  it("is NOT earned when species is mastered in ja but learningLocales is en-only", () => {
    const cards = [
      nameCard(SAMPLE.id, masteredState(), "ja"),
      reverseCard(SAMPLE.id, masteredState(), "ja"),
    ];
    expect(isFavouriteEarned(SAMPLE_FAV, cards, false, ["en"])).toBe(false);
  });

  it("name-only mastered in ja with reverse mastered in en → not earned (locale must match both legs)", () => {
    // Mismatched locale: name in ja (mastered) + reverse in en (mastered).
    // Neither locale achieves BOTH legs simultaneously.
    const cards = [
      nameCard(SAMPLE.id, masteredState(), "ja"),
      reverseCard(SAMPLE.id, masteredState(), "en"),
    ];
    expect(isFavouriteEarned(SAMPLE_FAV, cards, false, ["en", "ja"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// masteredSpeciesUnion - unit tests (#1865)
// ---------------------------------------------------------------------------

describe("masteredSpeciesUnion (#1865)", () => {
  it("returns species mastered in en when enrolled in en", () => {
    const cards = [
      nameCard(SAMPLE.id, masteredState(), "en"),
      reverseCard(SAMPLE.id, masteredState(), "en"),
    ];
    const result = masteredSpeciesUnion(cards, false, ["en"]);
    expect(result.has(SAMPLE.id)).toBe(true);
  });

  it("excludes species with only name-leg mastered", () => {
    const cards = [
      nameCard(SAMPLE.id, masteredState(), "en"),
      reverseCard(SAMPLE.id, learningState(), "en"),
    ];
    const result = masteredSpeciesUnion(cards, false, ["en"]);
    expect(result.has(SAMPLE.id)).toBe(false);
  });

  it("unions across enrolled locales: mastered in ja included when enrolled in en+ja", () => {
    const cards = [
      // en: name only mastered (not species-level)
      nameCard(SAMPLE.id, masteredState(), "en"),
      reverseCard(SAMPLE.id, learningState(), "en"),
      // ja: both legs mastered
      nameCard(SAMPLE.id, masteredState(), "ja"),
      reverseCard(SAMPLE.id, masteredState(), "ja"),
    ];
    const result = masteredSpeciesUnion(cards, false, ["en", "ja"]);
    expect(result.has(SAMPLE.id)).toBe(true);
  });

  it("forceAllMastered returns every name-card species", () => {
    const cards = [
      nameCard(SAMPLE.id, learningState(), "en"),
    ];
    const result = masteredSpeciesUnion(cards, true, ["en"]);
    expect(result.has(SAMPLE.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Contract test: Pasture, Stats (masteredSpeciesIds), and theme picker
// (masteredSpeciesUnion) must agree on the same mastered set (#1865 AC4).
// ---------------------------------------------------------------------------

describe("Pasture / Stats / theme-picker mastery contract (#1865 AC4)", () => {
  const SPECIES_A = CURATED_POKEMON[0].id;
  const SPECIES_B = CURATED_POKEMON[1]?.id ?? CURATED_POKEMON[0].id + 1;

  it("all three predicates agree: species mastered in en (both legs) → included everywhere", () => {
    const cards: ReviewableCard[] = [
      nameCard(SPECIES_A, masteredState(), "en"),
      reverseCard(SPECIES_A, masteredState(), "en"),
    ];

    // filterMastered (Pasture)
    const pastureCards = filterMastered([...cards], false, "en");
    expect(pastureCards.map((c) => c.id)).toContain(SPECIES_A);

    // masteredSpeciesIds (Stats / Journey)
    const statsIds = masteredSpeciesIds(cards, false, "en");
    expect(statsIds.has(SPECIES_A)).toBe(true);

    // masteredSpeciesUnion (theme picker)
    const themeIds = masteredSpeciesUnion(cards, false, ["en"]);
    expect(themeIds.has(SPECIES_A)).toBe(true);
  });

  it("all three predicates agree: name-only mastered → excluded everywhere", () => {
    const cards: ReviewableCard[] = [
      nameCard(SPECIES_A, masteredState(), "en"),
      reverseCard(SPECIES_A, learningState(), "en"),
    ];

    const pastureCards = filterMastered([...cards], false, "en");
    expect(pastureCards.map((c) => c.id)).not.toContain(SPECIES_A);

    const statsIds = masteredSpeciesIds(cards, false, "en");
    expect(statsIds.has(SPECIES_A)).toBe(false);

    const themeIds = masteredSpeciesUnion(cards, false, ["en"]);
    expect(themeIds.has(SPECIES_A)).toBe(false);
  });

  it("all three predicates agree: mastered in ja, enrolled en+ja → included in theme union", () => {
    const cards: ReviewableCard[] = [
      // Species A: mastered in ja
      nameCard(SPECIES_A, masteredState(), "ja"),
      reverseCard(SPECIES_A, masteredState(), "ja"),
      // Species B: mastered in en
      nameCard(SPECIES_B, masteredState(), "en"),
      reverseCard(SPECIES_B, masteredState(), "en"),
    ];

    // filterMastered and masteredSpeciesIds are per-locale
    const pastureJa = filterMastered([...cards], false, "ja");
    expect(pastureJa.map((c) => c.id)).toContain(SPECIES_A);
    expect(pastureJa.map((c) => c.id)).not.toContain(SPECIES_B);

    const statsJa = masteredSpeciesIds(cards, false, "ja");
    expect(statsJa.has(SPECIES_A)).toBe(true);
    expect(statsJa.has(SPECIES_B)).toBe(false);

    // Theme union with ["en","ja"] should include BOTH species
    const themeIds = masteredSpeciesUnion(cards, false, ["en", "ja"]);
    expect(themeIds.has(SPECIES_A)).toBe(true);
    expect(themeIds.has(SPECIES_B)).toBe(true);
  });

  it("forceAllMastered: all three treat every name-card species as mastered", () => {
    // Only a name card (no reverse) - forceAllMastered bypasses the two-leg check.
    const cards: ReviewableCard[] = [
      nameCard(SPECIES_A, learningState(), "en"),
    ];

    const pastureCards = filterMastered([...cards], true, "en");
    expect(pastureCards.map((c) => c.id)).toContain(SPECIES_A);

    const statsIds = masteredSpeciesIds(cards, true, "en");
    expect(statsIds.has(SPECIES_A)).toBe(true);

    const themeIds = masteredSpeciesUnion(cards, true, ["en"]);
    expect(themeIds.has(SPECIES_A)).toBe(true);
  });
});
