import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  computeNextReview,
  cardBelongsToSpecies,
  useNextReviewDate,
} from "@/lib/review/useNextReviewDate";
import type { ReviewableCard } from "@/lib/review/session";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockSession, mockSettings } = vi.hoisted(() => ({
  mockSession: { value: null as { cards: ReviewableCard[] } | null },
  mockSettings: { value: { timezone: "UTC" as string | null } },
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: async () => mockSession.value,
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockSettings.value,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNameCard(
  id: number,
  overrides: Partial<ReviewableCard["state"]> = {},
): ReviewableCard {
  return {
    id,
    cardType: "name",
    subjectKey: String(id),
    name: "Bulbasaur",
    displayName: "Bulbasaur",
    spriteUrl: "/sprites/pokemon/1.png",
    types: ["grass"],
    stats: {
      hp: 45,
      attack: 49,
      defense: 49,
      specialAttack: 65,
      specialDefense: 65,
      speed: 45,
    },
    flavorText: "",
    flavorTexts: [],
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
    genderRate: 4,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    state: {
      stability: 1,
      difficulty: 5,
      elapsedDays: 1,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      fsrsState: "learning",
      dueDate: "2026-06-01",
      lastReview: "2026-05-19",
      firstSeen: "2026-05-19",
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
      ...overrides,
    },
  } as unknown as ReviewableCard;
}

function makeReverseCard(
  pokemonId: number,
  overrides: Partial<ReviewableCard["state"]> = {},
): ReviewableCard {
  return {
    id: 2_000_000 + pokemonId,
    cardType: "reverse",
    subjectKey: String(pokemonId),
    pokemonId,
    name: "Bulbasaur",
    displayName: "Bulbasaur",
    spriteUrl: "/sprites/pokemon/1.png",
    types: ["grass"],
    stats: {
      hp: 45,
      attack: 49,
      defense: 49,
      specialAttack: 65,
      specialDefense: 65,
      speed: 45,
    },
    flavorText: "",
    flavorTexts: [],
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
    genderRate: 4,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    speciesId: pokemonId,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    state: {
      stability: 1,
      difficulty: 5,
      elapsedDays: 1,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      fsrsState: "learning",
      dueDate: "2026-06-01",
      lastReview: "2026-05-19",
      firstSeen: "2026-05-19",
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
      ...overrides,
    },
  } as unknown as ReviewableCard;
}

function makeEvolutionCard(
  preEvoId: number,
  postEvoId: number,
  overrides: Partial<ReviewableCard["state"]> = {},
): ReviewableCard {
  return {
    id: 1_500_001,
    cardType: "evolution",
    subjectKey: `${preEvoId}:${postEvoId}`,
    preEvoId,
    preEvoName: "Bulbasaur",
    preEvoSpriteUrl: "/sprites/pokemon/1.png",
    postEvoId,
    postEvoName: "Ivysaur",
    postEvoSpriteUrl: "/sprites/pokemon/2.png",
    triggerPhrase: null,
    state: {
      stability: 1,
      difficulty: 5,
      elapsedDays: 1,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      fsrsState: "learning",
      dueDate: "2026-06-01",
      lastReview: "2026-05-19",
      firstSeen: "2026-05-19",
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
      ...overrides,
    },
  } as unknown as ReviewableCard;
}

// ---------------------------------------------------------------------------
// Unit tests - cardBelongsToSpecies
// ---------------------------------------------------------------------------

describe("cardBelongsToSpecies", () => {
  it("name card matches its own species id", () => {
    const card = makeNameCard(1);
    expect(cardBelongsToSpecies(card, 1)).toBe(true);
    expect(cardBelongsToSpecies(card, 2)).toBe(false);
  });

  it("reverse card matches via pokemonId", () => {
    const card = makeReverseCard(1);
    expect(cardBelongsToSpecies(card, 1)).toBe(true);
    expect(cardBelongsToSpecies(card, 2)).toBe(false);
  });

  it("evolution card matches both preEvoId and postEvoId", () => {
    const card = makeEvolutionCard(1, 2);
    expect(cardBelongsToSpecies(card, 1)).toBe(true);
    expect(cardBelongsToSpecies(card, 2)).toBe(true);
    expect(cardBelongsToSpecies(card, 3)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit tests - computeNextReview
// ---------------------------------------------------------------------------

describe("computeNextReview", () => {
  const TODAY = "2026-05-19";

  it("returns not-started when no started cards exist for this species", () => {
    const unstarted = makeNameCard(1, { lastReview: null });
    expect(computeNextReview([unstarted], 1, TODAY)).toEqual({
      status: "not-started",
    });
  });

  it("returns not-started when session has no cards at all", () => {
    expect(computeNextReview([], 1, TODAY)).toEqual({ status: "not-started" });
  });

  it("returns due-today when dueDate equals today", () => {
    const card = makeNameCard(1, {
      dueDate: TODAY,
      lastReview: "2026-05-18",
    });
    expect(computeNextReview([card], 1, TODAY)).toEqual({ status: "due-today" });
  });

  it("returns due-today when dueDate is in the past (overdue)", () => {
    const card = makeNameCard(1, {
      dueDate: "2026-05-10",
      lastReview: "2026-05-09",
    });
    expect(computeNextReview([card], 1, TODAY)).toEqual({ status: "due-today" });
  });

  it("returns due-in with correct day count for a future dueDate", () => {
    const card = makeNameCard(1, {
      dueDate: "2026-05-26",
      lastReview: "2026-05-19",
    });
    expect(computeNextReview([card], 1, TODAY)).toEqual({
      status: "due-in",
      days: 7,
    });
  });

  it("uses the soonest dueDate across multiple started cards", () => {
    const nameCard = makeNameCard(1, {
      dueDate: "2026-06-01",
      lastReview: "2026-05-19",
    });
    const reverseCard = makeReverseCard(1, {
      dueDate: "2026-05-22",
      lastReview: "2026-05-19",
    });
    expect(computeNextReview([nameCard, reverseCard], 1, TODAY)).toEqual({
      status: "due-in",
      days: 3,
    });
  });

  it("ignores cards belonging to other species", () => {
    const other = makeNameCard(99, {
      dueDate: "2026-05-20",
      lastReview: "2026-05-19",
    });
    expect(computeNextReview([other], 1, TODAY)).toEqual({
      status: "not-started",
    });
  });

  it("ignores unstarted cards when a started card is present", () => {
    const started = makeNameCard(1, {
      dueDate: "2026-05-26",
      lastReview: "2026-05-19",
    });
    const unstarted = makeReverseCard(1, {
      dueDate: "2026-05-20",
      lastReview: null,
    });
    expect(computeNextReview([started, unstarted], 1, TODAY)).toEqual({
      status: "due-in",
      days: 7,
    });
  });

  it("picks due-today when one card is due today and another is due later", () => {
    const dueToday = makeNameCard(1, {
      dueDate: TODAY,
      lastReview: "2026-05-18",
    });
    const dueLater = makeReverseCard(1, {
      dueDate: "2026-06-01",
      lastReview: "2026-05-19",
    });
    expect(computeNextReview([dueToday, dueLater], 1, TODAY)).toEqual({
      status: "due-today",
    });
  });
});

// ---------------------------------------------------------------------------
// Hook tests - useNextReviewDate
// ---------------------------------------------------------------------------

describe("useNextReviewDate", () => {
  beforeEach(() => {
    mockSession.value = null;
    mockSettings.value = { timezone: "UTC" };
  });

  it("starts as pending before the effect resolves", () => {
    const { result } = renderHook(() => useNextReviewDate(1));
    expect(result.current).toEqual({ status: "pending" });
  });

  it("resolves to not-started when session is null", async () => {
    mockSession.value = null;
    const { result } = renderHook(() => useNextReviewDate(1));
    await vi.waitFor(() =>
      expect(result.current.status).not.toBe("pending"),
    );
    expect(result.current).toEqual({ status: "not-started" });
  });

  it("resolves to not-started when session has no started cards for the species", async () => {
    mockSession.value = {
      cards: [makeNameCard(1, { lastReview: null })],
    };
    const { result } = renderHook(() => useNextReviewDate(1));
    await vi.waitFor(() =>
      expect(result.current.status).not.toBe("pending"),
    );
    expect(result.current).toEqual({ status: "not-started" });
  });

  it("resolves to due-today when dueDate is far in the past", async () => {
    // A dueDate long in the past is always "due-today" regardless of clock.
    mockSession.value = {
      cards: [makeNameCard(1, { dueDate: "2020-01-01", lastReview: "2019-12-31" })],
    };
    const { result } = renderHook(() => useNextReviewDate(1));
    await vi.waitFor(() =>
      expect(result.current.status).not.toBe("pending"),
    );
    expect(result.current).toEqual({ status: "due-today" });
  });

  it("resolves to due-in when dueDate is far in the future", async () => {
    const farFuture = "2099-01-01";
    mockSession.value = {
      cards: [makeNameCard(1, { dueDate: farFuture, lastReview: "2026-05-19" })],
    };
    const { result } = renderHook(() => useNextReviewDate(1));
    await vi.waitFor(() =>
      expect(result.current.status).not.toBe("pending"),
    );
    expect(result.current.status).toBe("due-in");
    if (result.current.status === "due-in") {
      expect(result.current.days).toBeGreaterThan(0);
    }
  });
});
