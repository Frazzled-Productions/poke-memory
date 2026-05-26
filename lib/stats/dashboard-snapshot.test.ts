/**
 * Unit tests for computeDashboardSnapshot (#1121).
 *
 * Covers all axes (queue, forecast, mastery, struggling, projection,
 * firstMastery, difficulty), the `include` option, and the superuser
 * `forceAllMastered` flag.
 *
 * Also ports the three scenarios previously tested in
 * `components/stats/forecastTodayBar.test.tsx` (the now-deleted file) into the
 * forecast/queue describe blocks below.
 */

import { describe, it, expect } from "vitest";
import {
  computeDashboardSnapshot,
  computeQueueCount,
  computeQueueCountFromEligible,
  type SnapshotAxis,
} from "./dashboard-snapshot";
import { DEFAULT_LIMITS, buildSessionQueues, type ReviewableCard, type NameReviewCard, type EvolutionReviewCard, type ReverseReviewCard } from "@/lib/review/session";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";
import { EMPTY_SCOPE, computeEligibleCardIds, type EligibilitySettings } from "@/lib/review/scope";
import type { ReviewState } from "@/lib/srs/scheduler";

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

const TODAY = "2026-05-20";

function makeState(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    stability: 0,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    fsrsState: "new",
    dueDate: TODAY,
    lastReview: null,
    firstSeen: null,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
    ...overrides,
  };
}

function makeCard(
  id: number,
  stateOverrides: Partial<ReviewState> = {},
  cardOverrides: Partial<NameReviewCard> = {},
): NameReviewCard {
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
    flavorText: "A pokemon.",
    flavorTexts: ["A pokemon."],
    evolutionChain: [],
    height: 10,
    weight: 100,
    baseExperience: 64,
    genus: "Generic",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium",
    habitat: null,
    genderRate: 0,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    versionGroups: [],
    state: makeState(stateOverrides),
    ...cardOverrides,
  };
}

/** A card that is fully mastered (reps >= 3, scheduledDays >= 21). */
function masteredCard(id: number): NameReviewCard {
  return makeCard(id, {
    lastReview: "2026-04-01",
    firstSeen: "2026-02-01",
    reps: 5,
    scheduledDays: 30,
    dueDate: "2026-05-01",
    fsrsState: "review",
  });
}

/** A card that is introduced but not yet mastered. */
function learningCard(id: number, lastReview = "2026-05-15"): NameReviewCard {
  return makeCard(id, {
    lastReview,
    firstSeen: "2026-05-01",
    reps: 1,
    scheduledDays: 3,
    dueDate: TODAY,
    fsrsState: "review",
  });
}

/** A card that is new (never reviewed). */
function newCard(id: number): NameReviewCard {
  return makeCard(id);
}

/** Struggling card: reps >= 3, lapses > 0, difficulty 8. */
function strugglingCard(id: number): NameReviewCard {
  return makeCard(id, {
    lastReview: "2026-05-19",
    firstSeen: "2026-01-01",
    reps: 5,
    lapses: 2,
    difficulty: 8,
    scheduledDays: 5,
    dueDate: TODAY,
    fsrsState: "review",
  });
}

function makeSettings(overrides: Partial<EligibilitySettings> = {}): EligibilitySettings {
  return {
    evolutionCardsEnabled: true,
    reverseEvolutionCardsEnabled: false,
    cryCardsEnabled: false,
    alternateFormsEnabled: false,
    practiceScope: EMPTY_SCOPE,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Non-name card factories
// ---------------------------------------------------------------------------

/**
 * A minimal evolution card fixture. The IDs (preEvoId=1, postEvoId=2) are kept
 * out of the name-card speciesId space so generation lookups still work — both
 * are Gen I (1..151).
 */
function makeEvoCard(
  id: number,
  stateOverrides: Partial<ReviewState> = {},
): EvolutionReviewCard {
  return {
    cardType: "evolution",
    id,
    preEvoId: 1,  // Bulbasaur (Gen I)
    preEvoName: "Bulbasaur",
    preEvoSpriteUrl: "/sprites/1.png",
    postEvoId: 2, // Ivysaur
    postEvoName: "Ivysaur",
    postEvoSpriteUrl: "/sprites/2.png",
    triggerPhrase: "at level 16",
    subjectKey: "1>2",
    state: makeState(stateOverrides),
  };
}

/**
 * A minimal reverse (sprite-to-name) card fixture. Uses REVERSE_ID_OFFSET + 1
 * to sit in the correct namespace.
 */
function makeReverseCard(
  pokemonId: number,
  stateOverrides: Partial<ReviewState> = {},
): ReverseReviewCard {
  return {
    cardType: "reverse",
    id: REVERSE_ID_OFFSET + pokemonId,
    pokemonId,
    speciesId: pokemonId,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon ${pokemonId}`,
    subjectKey: String(pokemonId),
    name: `Pokemon ${pokemonId}`,
    spriteUrl: `/sprites/${pokemonId}.png`,
    types: ["normal"],
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "A pokemon.",
    flavorTexts: ["A pokemon."],
    evolutionChain: [],
    height: 10,
    weight: 100,
    baseExperience: 64,
    genus: "Generic",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium",
    habitat: null,
    genderRate: 0,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    versionGroups: [],
    state: makeState(stateOverrides),
  };
}

// ---------------------------------------------------------------------------
// Helper: compute queue total using the same path as buildSessionQueues
// ---------------------------------------------------------------------------

function queueTotal(cards: readonly ReviewableCard[], settings: EligibilitySettings): number {
  const eligibleIds = computeEligibleCardIds(cards, settings);
  const { newQueue, learningCardIds, reviewQueue } = buildSessionQueues(
    cards,
    DEFAULT_LIMITS,
    TODAY,
    eligibleIds,
  );
  return newQueue.length + learningCardIds.length + reviewQueue.length;
}

// ---------------------------------------------------------------------------
// queue axis
// ---------------------------------------------------------------------------

describe("queue axis", () => {
  it("today total matches buildSessionQueues for mixed new + review cards", () => {
    const cards: ReviewableCard[] = [
      newCard(1),
      newCard(2),
      learningCard(10, "2026-05-18"),
      learningCard(11, "2026-05-17"),
      // already reviewed today — excluded
      makeCard(20, { lastReview: TODAY, dueDate: TODAY, firstSeen: "2026-05-01", reps: 1, scheduledDays: 1, fsrsState: "review" }),
    ];
    const settings = makeSettings();
    const snapshot = computeDashboardSnapshot(cards, settings, DEFAULT_LIMITS, TODAY, {
      include: ["queue"],
    });

    expect(snapshot.queue).not.toBeNull();
    expect(snapshot.queue!.totalCount).toBe(queueTotal(cards, settings));
    expect(snapshot.queue!.newCount + snapshot.queue!.learningCount + snapshot.queue!.reviewCount)
      .toBe(snapshot.queue!.totalCount);
  });

  it("is null when not in include list", () => {
    const cards: ReviewableCard[] = [newCard(1)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["mastery"],
    });
    expect(snapshot.queue).toBeNull();
  });

  it("respects scope filter — Gen I only excludes Gen II+ cards", () => {
    const genIScope = { ...EMPTY_SCOPE, gens: [1] };
    const settings = makeSettings({ practiceScope: genIScope });
    const cards: ReviewableCard[] = [
      newCard(1),   // Gen I
      newCard(4),   // Gen I
      // Gen II (id 152 → species 152 → Gen II) — excluded by scope
      makeCard(152, { lastReview: "2026-05-18", dueDate: TODAY, firstSeen: "2026-05-01", reps: 1, scheduledDays: 1, fsrsState: "review" }),
    ];
    const snapshot = computeDashboardSnapshot(cards, settings, DEFAULT_LIMITS, TODAY, {
      include: ["queue"],
    });
    // Only Gen I new cards (1, 4) should be in the queue.
    expect(snapshot.queue!.totalCount).toBe(2);
    expect(snapshot.queue!.totalCount).toBe(queueTotal(cards, settings));
  });

  it("respects alternateFormsEnabled toggle", () => {
    const formCardEntry: NameReviewCard = makeCard(10100, {}, {
      id: 10100,
      speciesId: 26,
      isDefaultForm: false,
      formCategory: "regional",
      formSlug: "alola",
      displayName: "Alolan Raichu",
      name: "raichu-alola",
    });
    const cards: ReviewableCard[] = [newCard(1), formCardEntry];

    const settingsOff = makeSettings({ alternateFormsEnabled: false });
    const settingsOn = makeSettings({ alternateFormsEnabled: true });

    const snapshotOff = computeDashboardSnapshot(cards, settingsOff, DEFAULT_LIMITS, TODAY, {
      include: ["queue"],
    });
    const snapshotOn = computeDashboardSnapshot(cards, settingsOn, DEFAULT_LIMITS, TODAY, {
      include: ["queue"],
    });

    expect(snapshotOff.queue!.totalCount).toBe(1);
    expect(snapshotOn.queue!.totalCount).toBe(2);
    expect(snapshotOff.queue!.totalCount).toBe(queueTotal(cards, settingsOff));
    expect(snapshotOn.queue!.totalCount).toBe(queueTotal(cards, settingsOn));
  });
});

// ---------------------------------------------------------------------------
// forecast axis (ports forecastTodayBar.test.tsx scenarios)
// ---------------------------------------------------------------------------

describe("forecast axis", () => {
  it("dueForecast[0].count equals queue total for new + review cards", () => {
    const cards: ReviewableCard[] = [
      newCard(1),
      newCard(2),
      newCard(3),
      learningCard(10, "2026-05-18"),
      learningCard(11, "2026-05-17"),
      makeCard(20, { lastReview: TODAY, dueDate: TODAY, firstSeen: "2026-05-01", reps: 1, scheduledDays: 1, fsrsState: "review" }),
    ];
    const settings = makeSettings();
    const snapshot = computeDashboardSnapshot(cards, settings, DEFAULT_LIMITS, TODAY, {
      include: ["forecast"],
    });
    expect(snapshot.dueForecast).not.toBeNull();
    expect(snapshot.dueForecast![0].count).toBe(queueTotal(cards, settings));
  });

  it("future bars (indices 1–13) count eligible name cards due on those dates", () => {
    // A mastered card due 5 days from now should appear in the future bar.
    const futureDate = "2026-05-25";
    const cards: ReviewableCard[] = [
      masteredCard(1),
      // Override due date to a future date
      makeCard(5, { lastReview: "2026-05-01", firstSeen: "2026-04-01", reps: 5, scheduledDays: 30, dueDate: futureDate, fsrsState: "review" }),
    ];
    const settings = makeSettings();
    const snapshot = computeDashboardSnapshot(cards, settings, DEFAULT_LIMITS, TODAY, {
      include: ["forecast"],
    });
    expect(snapshot.dueForecast).not.toBeNull();
    // Find the bar for futureDate
    const futureBar = snapshot.dueForecast!.find((d) => d.date === futureDate);
    expect(futureBar).toBeDefined();
    expect(futureBar!.count).toBeGreaterThan(0);
  });

  it("is null when not in include list", () => {
    const snapshot = computeDashboardSnapshot([newCard(1)], makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["mastery"],
    });
    expect(snapshot.dueForecast).toBeNull();
  });

  it("returns 14 entries", () => {
    const snapshot = computeDashboardSnapshot([newCard(1)], makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["forecast"],
    });
    expect(snapshot.dueForecast!).toHaveLength(14);
  });

  it("today bar is 0 when no cards are due or new", () => {
    // A single mastered card that's not due today — nothing in queue
    const cards: ReviewableCard[] = [
      makeCard(1, { lastReview: "2026-04-01", firstSeen: "2026-01-01", reps: 5, scheduledDays: 30, dueDate: "2026-06-01", fsrsState: "review" }),
    ];
    const settings = makeSettings();
    const snapshot = computeDashboardSnapshot(cards, settings, DEFAULT_LIMITS, TODAY, {
      include: ["forecast"],
    });
    expect(snapshot.dueForecast![0].count).toBe(0);
  });

  it("scope-filtered: today bar excludes out-of-scope cards", () => {
    const genIScope = { ...EMPTY_SCOPE, gens: [1] };
    const settings = makeSettings({ practiceScope: genIScope });
    const cards: ReviewableCard[] = [
      newCard(1),
      newCard(4),
      makeCard(152, { lastReview: "2026-05-18", dueDate: TODAY, firstSeen: "2026-05-01", reps: 1, scheduledDays: 1, fsrsState: "review" }),
      makeCard(153, { lastReview: "2026-05-18", dueDate: TODAY, firstSeen: "2026-05-01", reps: 1, scheduledDays: 1, fsrsState: "review" }),
    ];
    const snapshot = computeDashboardSnapshot(cards, settings, DEFAULT_LIMITS, TODAY, {
      include: ["forecast"],
    });
    expect(snapshot.dueForecast![0].count).toBe(2); // only Gen I new cards
    expect(snapshot.dueForecast![0].count).toBe(queueTotal(cards, settings));
  });

  it("alternate-forms: today bar respects alternateFormsEnabled", () => {
    const formEntry: NameReviewCard = makeCard(10100, {}, {
      id: 10100,
      speciesId: 26,
      isDefaultForm: false,
      formCategory: "regional",
      formSlug: "alola",
      displayName: "Alolan Raichu",
      name: "raichu-alola",
    });
    const cards: ReviewableCard[] = [newCard(1), formEntry];

    const snapshotOff = computeDashboardSnapshot(
      cards,
      makeSettings({ alternateFormsEnabled: false }),
      DEFAULT_LIMITS,
      TODAY,
      { include: ["forecast"] },
    );
    const snapshotOn = computeDashboardSnapshot(
      cards,
      makeSettings({ alternateFormsEnabled: true }),
      DEFAULT_LIMITS,
      TODAY,
      { include: ["forecast"] },
    );
    expect(snapshotOff.dueForecast![0].count).toBe(1);
    expect(snapshotOn.dueForecast![0].count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// forecast axis — all card types (#1138)
// ---------------------------------------------------------------------------

describe("forecast axis — all card types", () => {
  // Helper: future date N days from TODAY. Derived from the TODAY constant so
  // that bumping TODAY keeps the forecast-window indices in sync (#1150).
  function futureDate(n: number): string {
    const d = new Date(TODAY);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  it("future bars include evolution cards due on that day", () => {
    // An evolution card due 3 days from today should appear in bar [3].
    const evoCard = makeEvoCard(1_500_001, {
      lastReview: "2026-05-10",
      firstSeen: "2026-05-01",
      reps: 2,
      scheduledDays: 13,
      dueDate: futureDate(3),
      fsrsState: "review",
    });
    const settings = makeSettings({ evolutionCardsEnabled: true });
    const snapshot = computeDashboardSnapshot(
      [evoCard],
      settings,
      DEFAULT_LIMITS,
      TODAY,
      { include: ["forecast"] },
    );

    expect(snapshot.dueForecast).not.toBeNull();
    const bar = snapshot.dueForecast!.find((d) => d.date === futureDate(3));
    expect(bar).toBeDefined();
    expect(bar!.count).toBe(1);
  });

  it("future bars include reverse cards due on that day", () => {
    // A reverse card due 5 days from today should appear in bar [5].
    const reverseCard = makeReverseCard(1, {
      lastReview: "2026-05-15",
      firstSeen: "2026-05-01",
      reps: 1,
      scheduledDays: 10,
      dueDate: futureDate(5),
      fsrsState: "review",
    });
    // Reverse is always on since #1234 — no override needed.
    const settings = makeSettings();
    const snapshot = computeDashboardSnapshot(
      [reverseCard],
      settings,
      DEFAULT_LIMITS,
      TODAY,
      { include: ["forecast"] },
    );

    expect(snapshot.dueForecast).not.toBeNull();
    const bar = snapshot.dueForecast!.find((d) => d.date === futureDate(5));
    expect(bar).toBeDefined();
    expect(bar!.count).toBe(1);
  });

  it("future bars show mixed card types in the correct bars", () => {
    // Name card due day 1, evolution card due day 3 — both should appear.
    const nameCardFuture = makeCard(5, {
      lastReview: "2026-05-19",
      firstSeen: "2026-05-01",
      reps: 2,
      scheduledDays: 2,
      dueDate: futureDate(1),
      fsrsState: "review",
    });
    const evoCardFuture = makeEvoCard(1_500_001, {
      lastReview: "2026-05-17",
      firstSeen: "2026-05-01",
      reps: 1,
      scheduledDays: 6,
      dueDate: futureDate(3),
      fsrsState: "review",
    });
    const settings = makeSettings({ evolutionCardsEnabled: true });
    const snapshot = computeDashboardSnapshot(
      [nameCardFuture, evoCardFuture],
      settings,
      DEFAULT_LIMITS,
      TODAY,
      { include: ["forecast"] },
    );

    expect(snapshot.dueForecast).not.toBeNull();
    const bar1 = snapshot.dueForecast!.find((d) => d.date === futureDate(1));
    const bar3 = snapshot.dueForecast!.find((d) => d.date === futureDate(3));
    expect(bar1!.count).toBe(1); // name card
    expect(bar3!.count).toBe(1); // evolution card
  });

  it("future bars exclude cards of disabled card types", () => {
    // Evolution card due day 2, but evolution cards are disabled.
    const evoCardFuture = makeEvoCard(1_500_001, {
      lastReview: "2026-05-18",
      firstSeen: "2026-05-01",
      reps: 1,
      scheduledDays: 4,
      dueDate: futureDate(2),
      fsrsState: "review",
    });
    // Disable evolution cards.
    const settings = makeSettings({ evolutionCardsEnabled: false });
    const snapshot = computeDashboardSnapshot(
      [evoCardFuture],
      settings,
      DEFAULT_LIMITS,
      TODAY,
      { include: ["forecast"] },
    );

    expect(snapshot.dueForecast).not.toBeNull();
    const bar2 = snapshot.dueForecast!.find((d) => d.date === futureDate(2));
    // The evolution card is excluded because the type is disabled.
    expect(bar2!.count).toBe(0);
  });

  it("future bars respect practiceScope — excludes out-of-scope name cards", () => {
    // A Gen II name card due day 4, with Gen I scope active.
    const genIICardFuture = makeCard(152, {
      lastReview: "2026-05-16",
      firstSeen: "2026-05-01",
      reps: 1,
      scheduledDays: 8,
      dueDate: futureDate(4),
      fsrsState: "review",
    });
    const genIScope = { ...EMPTY_SCOPE, gens: [1] };
    const settings = makeSettings({ practiceScope: genIScope });
    const snapshot = computeDashboardSnapshot(
      [genIICardFuture],
      settings,
      DEFAULT_LIMITS,
      TODAY,
      { include: ["forecast"] },
    );

    const bar4 = snapshot.dueForecast!.find((d) => d.date === futureDate(4));
    // The Gen II card is excluded by the Gen I scope.
    expect(bar4!.count).toBe(0);
  });

  it("new cards (lastReview === null) are excluded from future bars", () => {
    // A new card always has dueDate === today by default. Even if it were
    // somehow set to a future date, it should not appear in the future bars.
    const newEvolutionCard = makeEvoCard(1_500_001, {
      // lastReview stays null (default from makeState)
      dueDate: futureDate(2),
    });
    const settings = makeSettings({ evolutionCardsEnabled: true });
    const snapshot = computeDashboardSnapshot(
      [newEvolutionCard],
      settings,
      DEFAULT_LIMITS,
      TODAY,
      { include: ["forecast"] },
    );

    const bar2 = snapshot.dueForecast!.find((d) => d.date === futureDate(2));
    // New card excluded — it flows through the new-card queue, not the review forecast.
    expect(bar2!.count).toBe(0);
  });

  it("today bar (dueForecast[0]) still matches the queue total with mixed card types", () => {
    // Regression check: the today bar must equal computeQueueCount total.
    const cards: ReviewableCard[] = [
      newCard(1),
      learningCard(3, "2026-05-18"),
      makeEvoCard(1_500_001, {
        lastReview: "2026-05-19",
        firstSeen: "2026-05-01",
        reps: 1,
        scheduledDays: 1,
        dueDate: TODAY,
        fsrsState: "review",
      }),
    ];
    const settings = makeSettings({ evolutionCardsEnabled: true });
    const snapshot = computeDashboardSnapshot(cards, settings, DEFAULT_LIMITS, TODAY, {
      include: ["forecast"],
    });
    expect(snapshot.dueForecast![0].count).toBe(queueTotal(cards, settings));
  });
});

// ---------------------------------------------------------------------------
// mastery axis
// ---------------------------------------------------------------------------

describe("mastery axis", () => {
  it("counts are correct for mixed cards", () => {
    const cards: ReviewableCard[] = [
      newCard(1),
      newCard(2),
      learningCard(10),
      masteredCard(20),
      masteredCard(21),
    ];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["mastery"],
    });
    const m = snapshot.mastery!;
    expect(m.totalCards).toBe(5);
    expect(m.introduced).toBe(3);  // learningCard(10) + two mastered
    expect(m.mastered).toBe(2);
    expect(m.learning).toBe(1);
    expect(m.locked).toBe(2);
  });

  it("forceAllMastered overrides counts to all-mastered", () => {
    const cards: ReviewableCard[] = [newCard(1), newCard(2), learningCard(10)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["mastery"],
      forceAllMastered: true,
    });
    const m = snapshot.mastery!;
    expect(m.mastered).toBe(m.totalCards);
    expect(m.locked).toBe(0);
    expect(m.learning).toBe(0);
    expect(m.introduced).toBe(m.totalCards);
  });

  it("perGeneration sums match totalCards", () => {
    // Use Gen I IDs (1..151)
    const cards: ReviewableCard[] = [
      newCard(1), newCard(2), newCard(3),
    ];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["mastery"],
    });
    const genSum = snapshot.mastery!.perGeneration.reduce((s, g) => s + g.total, 0);
    expect(genSum).toBe(snapshot.mastery!.totalCards);
  });

  it("perType covers 18 types", () => {
    const snapshot = computeDashboardSnapshot([newCard(1)], makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["mastery"],
    });
    expect(snapshot.mastery!.perType).toHaveLength(18);
  });

  it("is null when not in include list", () => {
    const snapshot = computeDashboardSnapshot([newCard(1)], makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["queue"],
    });
    expect(snapshot.mastery).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// struggling axis
// ---------------------------------------------------------------------------

describe("struggling axis", () => {
  it("returns top-N introduced cards ordered by difficulty", () => {
    const cards: ReviewableCard[] = [
      strugglingCard(1),
      strugglingCard(2),
      newCard(3), // locked — excluded
    ];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["struggling"],
    });
    expect(snapshot.struggling!.length).toBeGreaterThan(0);
    // All returned cards pass the struggling gate
    snapshot.struggling!.forEach((c) => {
      expect(c.repetitions).toBeGreaterThanOrEqual(1);
    });
  });

  it("is empty when forceAllMastered is on", () => {
    const cards: ReviewableCard[] = [strugglingCard(1), strugglingCard(2)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["struggling"],
      forceAllMastered: true,
    });
    expect(snapshot.struggling).toEqual([]);
  });

  it("is null when not in include list", () => {
    const snapshot = computeDashboardSnapshot([newCard(1)], makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["mastery"],
    });
    expect(snapshot.struggling).toBeNull();
  });

  it("respects strugglingLimit", () => {
    const cards: ReviewableCard[] = Array.from({ length: 20 }, (_, i) =>
      strugglingCard(i + 1),
    );
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["struggling"],
      strugglingLimit: 5,
    });
    expect(snapshot.struggling!.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// projection axis
// ---------------------------------------------------------------------------

describe("projection axis", () => {
  it("returns complete when forceAllMastered", () => {
    const cards: ReviewableCard[] = [newCard(1), newCard(2)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["projection"],
      forceAllMastered: true,
    });
    expect(snapshot.projection).toEqual({ kind: "complete" });
  });

  it("returns complete when all cards are mastered", () => {
    const cards: ReviewableCard[] = [masteredCard(1), masteredCard(2)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["projection"],
      masteryRepetitions: 3,
    });
    expect(snapshot.projection?.kind).toBe("complete");
  });

  it("returns insufficient-history when no mastery events in window", () => {
    const cards: ReviewableCard[] = [newCard(1), learningCard(2)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["projection"],
      masteryRepetitions: 3,
    });
    expect(snapshot.projection?.kind).toBe("insufficient-history");
  });

  it("is null when not in include list", () => {
    const snapshot = computeDashboardSnapshot([newCard(1)], makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["mastery"],
    });
    expect(snapshot.projection).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// firstMastery axis
// ---------------------------------------------------------------------------

describe("firstMastery axis", () => {
  it("is null when no introduced cards exist", () => {
    const cards: ReviewableCard[] = [newCard(1), newCard(2)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["firstMastery"],
      masteryRepetitions: 3,
    });
    expect(snapshot.firstMasteryDays).toBeNull();
  });

  it("is null when any card is already mastered", () => {
    const cards: ReviewableCard[] = [masteredCard(1), learningCard(2)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["firstMastery"],
      masteryRepetitions: 3,
    });
    // mastered > 0, so firstMasteryDays gate excludes the projection
    expect(snapshot.firstMasteryDays).toBeNull();
  });

  it("is a positive number when introduced > 0 and mastered === 0", () => {
    // Cards must have valid FSRS state for the simulation. Use graduated cards
    // with stability > 0 (required by FSRS for the review path) but low enough
    // reps that they are not yet mastered (reps < 3 or scheduledDays < 21).
    const cards: ReviewableCard[] = [
      makeCard(1, {
        lastReview: "2026-05-10",
        firstSeen: "2026-05-01",
        reps: 1,
        scheduledDays: 5,
        stability: 5.0,
        difficulty: 5.0,
        fsrsState: "review",
        dueDate: TODAY,
      }),
      makeCard(2, {
        lastReview: "2026-05-12",
        firstSeen: "2026-05-02",
        reps: 1,
        scheduledDays: 3,
        stability: 3.0,
        difficulty: 5.0,
        fsrsState: "review",
        dueDate: TODAY,
      }),
    ];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["firstMastery", "mastery"],
      masteryRepetitions: 3,
    });
    // Both cards introduced, none mastered — should get a projection
    expect(snapshot.firstMasteryDays).toBeGreaterThan(0);
  });

  it("is null when not in include list", () => {
    const snapshot = computeDashboardSnapshot([newCard(1)], makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["mastery"],
    });
    expect(snapshot.firstMasteryDays).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// difficulty axis
// ---------------------------------------------------------------------------

describe("difficulty axis", () => {
  it("buckets are 9 entries", () => {
    const cards: ReviewableCard[] = [masteredCard(1)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["difficulty"],
    });
    expect(snapshot.difficulty!.buckets).toHaveLength(9);
  });

  it("mean is null when no introduced cards", () => {
    const cards: ReviewableCard[] = [newCard(1), newCard(2)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["difficulty"],
    });
    expect(snapshot.difficulty!.mean).toBeNull();
  });

  it("mean is computed for introduced cards", () => {
    const cards: ReviewableCard[] = [
      makeCard(1, { lastReview: "2026-05-01", firstSeen: "2026-04-01", difficulty: 6, reps: 1, fsrsState: "review" }),
      makeCard(2, { lastReview: "2026-05-01", firstSeen: "2026-04-01", difficulty: 4, reps: 1, fsrsState: "review" }),
    ];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["difficulty"],
    });
    expect(snapshot.difficulty!.mean).toBeCloseTo(5.0, 1);
  });

  it("mean is null when forceAllMastered", () => {
    const cards: ReviewableCard[] = [masteredCard(1)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["difficulty"],
      forceAllMastered: true,
    });
    expect(snapshot.difficulty!.mean).toBeNull();
  });

  it("is null when not in include list", () => {
    const snapshot = computeDashboardSnapshot([newCard(1)], makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["mastery"],
    });
    expect(snapshot.difficulty).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// include option
// ---------------------------------------------------------------------------

describe("include option", () => {
  it("single axis: only requested axis is non-null", () => {
    const cards: ReviewableCard[] = [newCard(1)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["mastery"],
    });
    expect(snapshot.mastery).not.toBeNull();
    expect(snapshot.queue).toBeNull();
    expect(snapshot.dueForecast).toBeNull();
    expect(snapshot.struggling).toBeNull();
    expect(snapshot.projection).toBeNull();
    expect(snapshot.firstMasteryDays).toBeNull();
    expect(snapshot.difficulty).toBeNull();
  });

  it("multi-axis: only requested axes are non-null", () => {
    const cards: ReviewableCard[] = [newCard(1), masteredCard(2)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["mastery", "difficulty"],
    });
    expect(snapshot.mastery).not.toBeNull();
    expect(snapshot.difficulty).not.toBeNull();
    expect(snapshot.queue).toBeNull();
    expect(snapshot.dueForecast).toBeNull();
    expect(snapshot.struggling).toBeNull();
    expect(snapshot.projection).toBeNull();
    expect(snapshot.firstMasteryDays).toBeNull();
  });

  it("omitted include computes all axes", () => {
    const cards: ReviewableCard[] = [masteredCard(1), newCard(2)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY);
    expect(snapshot.mastery).not.toBeNull();
    expect(snapshot.queue).not.toBeNull();
    expect(snapshot.dueForecast).not.toBeNull();
    expect(snapshot.struggling).not.toBeNull();
    expect(snapshot.projection).not.toBeNull();
    expect(snapshot.difficulty).not.toBeNull();
    // firstMasteryDays may be null (no introduced non-mastered cards in this fixture)
    // but the axis was computed (it just returned null)
  });
});

// ---------------------------------------------------------------------------
// superuser forceAllMastered
// ---------------------------------------------------------------------------

describe("superuser forceAllMastered", () => {
  it("mastery shows all cards as mastered", () => {
    const cards: ReviewableCard[] = [newCard(1), learningCard(2), newCard(3)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["mastery"],
      forceAllMastered: true,
    });
    expect(snapshot.mastery!.mastered).toBe(snapshot.mastery!.totalCards);
    expect(snapshot.mastery!.locked).toBe(0);
    expect(snapshot.mastery!.learning).toBe(0);
    expect(snapshot.forceAllMastered).toBe(true);
  });

  it("struggling is empty when forceAllMastered", () => {
    const cards: ReviewableCard[] = [strugglingCard(1), strugglingCard(2)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["struggling"],
      forceAllMastered: true,
    });
    expect(snapshot.struggling).toEqual([]);
  });

  it("projection is complete when forceAllMastered", () => {
    const cards: ReviewableCard[] = [newCard(1), learningCard(2)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["projection"],
      forceAllMastered: true,
    });
    expect(snapshot.projection).toEqual({ kind: "complete" });
  });

  it("queue + forecast use real scheduling state (not forceAllMastered)", () => {
    // queue and forecast reflect real due state; forceAllMastered doesn't affect them.
    const cards: ReviewableCard[] = [newCard(1), newCard(2)];
    const settings = makeSettings();
    const snapshotReal = computeDashboardSnapshot(cards, settings, DEFAULT_LIMITS, TODAY, {
      include: ["queue", "forecast"],
      forceAllMastered: false,
    });
    const snapshotForced = computeDashboardSnapshot(cards, settings, DEFAULT_LIMITS, TODAY, {
      include: ["queue", "forecast"],
      forceAllMastered: true,
    });
    // Both should show the same queue total (2 new cards)
    expect(snapshotReal.queue!.totalCount).toBe(snapshotForced.queue!.totalCount);
    expect(snapshotReal.dueForecast![0].count).toBe(snapshotForced.dueForecast![0].count);
  });

  it("difficulty mean and buckets are empty when forceAllMastered", () => {
    const cards: ReviewableCard[] = [masteredCard(1)];
    const snapshot = computeDashboardSnapshot(cards, makeSettings(), DEFAULT_LIMITS, TODAY, {
      include: ["difficulty"],
      forceAllMastered: true,
    });
    expect(snapshot.difficulty!.mean).toBeNull();
    expect(snapshot.difficulty!.buckets.every((b) => b.count === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeQueueCount — shared badge helper (#1137)
// ---------------------------------------------------------------------------

describe("computeQueueCount", () => {
  it("returns zero counts when cards array is empty", () => {
    const result = computeQueueCount([], makeSettings(), DEFAULT_LIMITS, TODAY);
    expect(result).toEqual({
      newCount: 0,
      learningCount: 0,
      reviewCount: 0,
      totalCount: 0,
    });
  });

  it("counts new cards due today", () => {
    const cards: ReviewableCard[] = [newCard(1), newCard(2), newCard(3)];
    const settings = makeSettings();
    const result = computeQueueCount(cards, settings, DEFAULT_LIMITS, TODAY);
    // New cards are limited by DEFAULT_LIMITS; fixture has 3 new cards well within cap.
    expect(result.newCount).toBeGreaterThan(0);
    expect(result.totalCount).toBe(result.newCount + result.learningCount + result.reviewCount);
  });

  it("totalCount matches the snapshot queue axis for identical inputs", () => {
    const cards: ReviewableCard[] = [
      newCard(1),
      newCard(2),
      learningCard(10, "2026-05-18"),
    ];
    const settings = makeSettings();

    const countResult = computeQueueCount(cards, settings, DEFAULT_LIMITS, TODAY);
    const snapshot = computeDashboardSnapshot(cards, settings, DEFAULT_LIMITS, TODAY, {
      include: ["queue"],
    });

    // The badge helper and the Stats dashboard must agree on the total.
    expect(countResult.totalCount).toBe(snapshot.queue!.totalCount);
    expect(countResult.newCount).toBe(snapshot.queue!.newCount);
    expect(countResult.learningCount).toBe(snapshot.queue!.learningCount);
    expect(countResult.reviewCount).toBe(snapshot.queue!.reviewCount);
  });

  it("respects scope filter — excludes cards outside active scope", () => {
    const genIScope = { ...EMPTY_SCOPE, gens: [1] };
    const settings = makeSettings({ practiceScope: genIScope });
    const cards: ReviewableCard[] = [
      newCard(1),  // Gen I — included
      newCard(4),  // Gen I — included
      newCard(152), // Gen II — excluded by scope
    ];

    const result = computeQueueCount(cards, settings, DEFAULT_LIMITS, TODAY);
    // Only the two Gen I new cards should be in the queue.
    expect(result.totalCount).toBe(2);
  });

  it("respects card-type toggles — excludes disabled enrichment card types", () => {
    // Name and reverse are always on (#1234). Only enrichment types are toggled.
    // With evolution disabled and no evolution cards in the fixture, the result
    // should match queueTotal with the same settings.
    const settings = makeSettings({
      evolutionCardsEnabled: false,
    });
    const cards: ReviewableCard[] = [newCard(1), newCard(2)];
    const result = computeQueueCount(cards, settings, DEFAULT_LIMITS, TODAY);
    expect(result.totalCount).toBe(queueTotal(cards, settings));
  });

  it("returns QueueCounts with all four fields", () => {
    const result = computeQueueCount([newCard(1)], makeSettings(), DEFAULT_LIMITS, TODAY);
    expect(result).toHaveProperty("newCount");
    expect(result).toHaveProperty("learningCount");
    expect(result).toHaveProperty("reviewCount");
    expect(result).toHaveProperty("totalCount");
    expect(typeof result.totalCount).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// computeQueueCountFromEligible — lower-level helper (#1158)
// ---------------------------------------------------------------------------

describe("computeQueueCountFromEligible", () => {
  it("produces the same result as computeQueueCount given the same inputs", () => {
    const cards: ReviewableCard[] = [newCard(1), newCard(2), learningCard(10, "2026-05-18")];
    const settings = makeSettings();
    const eligibleCardIds = computeEligibleCardIds(cards, settings);

    const fromEligible = computeQueueCountFromEligible(cards, eligibleCardIds, DEFAULT_LIMITS, TODAY);
    const fromCount = computeQueueCount(cards, settings, DEFAULT_LIMITS, TODAY);

    expect(fromEligible).toEqual(fromCount);
  });

  it("respects a pre-filtered eligible set — excluding a card reduces the total", () => {
    const cards: ReviewableCard[] = [newCard(1), newCard(2), newCard(3)];
    const settings = makeSettings();
    const allEligible = computeEligibleCardIds(cards, settings);

    // Manually exclude one card from the eligible set.
    const subset = new Set(allEligible);
    const [removedId] = Array.from(subset);
    subset.delete(removedId);

    const full = computeQueueCountFromEligible(cards, allEligible, DEFAULT_LIMITS, TODAY);
    const partial = computeQueueCountFromEligible(cards, subset, DEFAULT_LIMITS, TODAY);

    expect(partial.totalCount).toBe(full.totalCount - 1);
  });
});
