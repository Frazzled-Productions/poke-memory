import { describe, it, expect } from "vitest";
import { nextArrivals } from "./nextArrivals";
import type { ReviewState } from "@/lib/srs/scheduler";
import type { ReviewableCard } from "@/lib/review/session";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    stability: 0,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    fsrsState: "new",
    dueDate: "2026-05-20",
    lastReview: null,
    firstSeen: null,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
    ...overrides,
  };
}

/** A mastered state: reps >= 3, scheduledDays >= 21. */
const masteredState = makeState({
  reps: 3,
  scheduledDays: 21,
  lastReview: "2026-05-01",
  firstSeen: "2026-04-01",
  fsrsState: "review",
});

/** A mid-progress state: seen, not mastered. */
function learningState(
  reps: number,
  dueDate = "2026-05-25",
): ReviewState {
  return makeState({
    reps,
    scheduledDays: 5,
    lastReview: "2026-05-20",
    firstSeen: "2026-04-01",
    fsrsState: "review",
    dueDate,
  });
}

const REVERSE_ID_OFFSET = 2_000_000;

function makeNameCard(
  id: number,
  state: ReviewState,
  overrides: Partial<ReviewableCard> = {},
): ReviewableCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon ${id}`,
    cardType: "name",
    subjectKey: String(id),
    name: `Pokemon ${id}`,
    spriteUrl: `/sprites/${id}.png`,
    types: ["normal"],
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "Test.",
    flavorTexts: [],
    evolutionChain: [],
    height: null,
    weight: null,
    baseExperience: null,
    genus: null,
    generation: null,
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    state,
    ...overrides,
  } as ReviewableCard;
}

function makeReverseCard(
  speciesId: number,
  state: ReviewState,
): ReviewableCard {
  return {
    ...makeNameCard(speciesId, state),
    id: REVERSE_ID_OFFSET + speciesId,
    cardType: "reverse",
    subjectKey: String(speciesId),
    pokemonId: speciesId,
  } as ReviewableCard;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("nextArrivals", () => {
  it("returns empty array when forceAllMastered is true", () => {
    const cards = [
      makeNameCard(1, learningState(2)),
      makeNameCard(2, learningState(1)),
    ];
    expect(nextArrivals(cards, true)).toHaveLength(0);
  });

  it("excludes unseen cards (firstSeen === null)", () => {
    const unseenState = makeState(); // firstSeen: null
    const cards = [makeNameCard(1, unseenState)];
    expect(nextArrivals(cards)).toHaveLength(0);
  });

  it("excludes cards that are already mastered", () => {
    const cards = [makeNameCard(1, masteredState)];
    expect(nextArrivals(cards)).toHaveLength(0);
  });

  it("excludes species where the reverse card is already mastered", () => {
    // Species 1: name not mastered but reverse is mastered → excluded
    const cards = [
      makeNameCard(1, learningState(2)),
      makeReverseCard(1, masteredState),
    ];
    expect(nextArrivals(cards)).toHaveLength(0);
  });

  it("includes seen, unmastered name cards", () => {
    const cards = [makeNameCard(1, learningState(2))];
    const result = nextArrivals(cards);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("sorts by highest reps first", () => {
    const cards = [
      makeNameCard(1, learningState(1)),
      makeNameCard(2, learningState(2)),
      makeNameCard(3, learningState(3, "2026-06-01")), // reps=3 but not mastered (scheduledDays < 21)
    ];
    const result = nextArrivals(cards);
    expect(result.map((c) => c.id)).toEqual([3, 2, 1]);
  });

  it("breaks rep ties by earliest dueDate", () => {
    const cards = [
      makeNameCard(1, learningState(2, "2026-06-10")),
      makeNameCard(2, learningState(2, "2026-05-22")),
      makeNameCard(3, learningState(2, "2026-06-01")),
    ];
    const result = nextArrivals(cards);
    // Sorted by earliest due first
    expect(result.map((c) => c.id)).toEqual([2, 3, 1]);
  });

  it("respects the limit parameter", () => {
    const cards = Array.from({ length: 10 }, (_, i) =>
      makeNameCard(i + 1, learningState(i + 1)),
    );
    expect(nextArrivals(cards, false, 3, "en", 3)).toHaveLength(3);
  });

  it("defaults to limit 5", () => {
    const cards = Array.from({ length: 10 }, (_, i) =>
      makeNameCard(i + 1, learningState(2)),
    );
    expect(nextArrivals(cards)).toHaveLength(5);
  });

  it("returns fewer than limit when not enough candidates", () => {
    const cards = [makeNameCard(1, learningState(2))];
    expect(nextArrivals(cards)).toHaveLength(1);
  });

  it("excludes non-name card types", () => {
    const evoCard = {
      ...makeNameCard(1, learningState(2)),
      cardType: "evolution" as const,
    };
    expect(nextArrivals([evoCard as ReviewableCard])).toHaveLength(0);
  });

  it("honours masteryRepetitions threshold (higher threshold includes near-mastered cards)", () => {
    // Card has reps=3, scheduledDays=21 - mastered at default threshold (3) but
    // not at threshold 5. Under threshold 5, the card should appear.
    const cards = [makeNameCard(1, masteredState)];
    // Default threshold: mastered → excluded
    expect(nextArrivals(cards, false, 3)).toHaveLength(0);
    // Higher threshold: not mastered → included (has firstSeen set)
    expect(nextArrivals(cards, false, 5)).toHaveLength(1);
  });

  it("locale scoping: only includes name cards whose locale matches", () => {
    const jaCard = { ...makeNameCard(1, learningState(2)), locale: "ja" as const };
    const enCard = { ...makeNameCard(2, learningState(2)), locale: "en" as const };
    const cards = [jaCard, enCard] as ReviewableCard[];

    const enResult = nextArrivals(cards, false, 3, "en");
    expect(enResult).toHaveLength(1);
    expect(enResult[0].id).toBe(2);

    const jaResult = nextArrivals(cards, false, 3, "ja");
    expect(jaResult).toHaveLength(1);
    expect(jaResult[0].id).toBe(1);
  });

  it("locale scoping: cards without locale field default to 'en'", () => {
    // Cards from pre-#1259 storage have no locale field.
    const card = makeNameCard(1, learningState(2)); // no locale
    expect(nextArrivals([card], false, 3, "en")).toHaveLength(1);
    expect(nextArrivals([card], false, 3, "ja")).toHaveLength(0);
  });

  it("returns correct id, name, spriteUrl, and state on returned entries", () => {
    const state = learningState(2);
    const cards = [makeNameCard(42, state)];
    const result = nextArrivals(cards);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(42);
    expect(result[0].name).toBe("Pokemon 42");
    expect(result[0].spriteUrl).toBe("/sprites/42.png");
    expect(result[0].state).toEqual(state);
  });

  it("includes a species where name is not mastered even if reverse is also unmastered", () => {
    // Neither leg mastered → species should appear in the arrivals list
    const cards = [
      makeNameCard(1, learningState(2)),
      makeReverseCard(1, learningState(1)),
    ];
    const result = nextArrivals(cards);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });
});
