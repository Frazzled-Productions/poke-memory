import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadFavourite, saveFavourite, isFavouriteEarned } from "./persistence";
import { CURATED_POKEMON } from "./curated-pokemon";
import { initialReviewState } from "@/lib/srs/scheduler";
import type { ReviewState } from "@/lib/srs/scheduler";
import { MASTERY_INTERVAL_DAYS } from "@/lib/stats/derive";

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

describe("isFavouriteEarned", () => {
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

  it("returns true when favourite is null", () => {
    expect(isFavouriteEarned(null, [])).toBe(true);
  });

  it("returns true when the underlying card is mastered", () => {
    const cards = [{ id: SAMPLE.id, state: masteredState() }];
    expect(isFavouriteEarned(SAMPLE_FAV, cards)).toBe(true);
  });

  it("returns false when the underlying card exists but is not mastered", () => {
    const cards = [{ id: SAMPLE.id, state: learningState() }];
    expect(isFavouriteEarned(SAMPLE_FAV, cards)).toBe(false);
  });

  it("returns false when there is no card for the favourite", () => {
    const cards = [{ id: 999, state: masteredState() }];
    expect(isFavouriteEarned(SAMPLE_FAV, cards)).toBe(false);
  });

  it("mastered when stability >= 21; not mastered when stability < 21 (#1765 stability gate)", () => {
    // stability = 21 → mastered.
    const masteredCards = [{ id: SAMPLE.id, state: masteredState() }];
    expect(isFavouriteEarned(SAMPLE_FAV, masteredCards)).toBe(true);
    // stability = 5 → not mastered.
    const learningCards = [{ id: SAMPLE.id, state: learningState() }];
    expect(isFavouriteEarned(SAMPLE_FAV, learningCards)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Any-locale earned check (#1851)
// ---------------------------------------------------------------------------

describe("isFavouriteEarned any-locale arbitration (#1851)", () => {
  it("is earned when a later duplicate-id card is mastered (ja after en)", () => {
    // Multi-locale sessions hold several name cards with the same numeric id.
    // The old first-match cards.find arbitrated by array order, so a species
    // mastered only in ja (appended after en) read as un-earned and the
    // favourite was silently wiped on load.
    const masteredJa = {
      ...initialReviewState(new Date("2026-05-13")),
      reps: 5,
      stability: 21,
      scheduledDays: MASTERY_INTERVAL_DAYS + 1,
      lastReview: "2026-05-12",
    };
    const learningEn = {
      ...initialReviewState(new Date("2026-05-13")),
      reps: 2,
      stability: 5,
      scheduledDays: 3,
      lastReview: "2026-05-12",
    };
    const cards = [
      { id: SAMPLE.id, state: learningEn },
      { id: SAMPLE.id, state: masteredJa },
    ];
    expect(isFavouriteEarned(SAMPLE_FAV, cards)).toBe(true);
  });
});
