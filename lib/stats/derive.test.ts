import { describe, it, expect } from "vitest";
import {
  isMastered,
  classifyCard,
  computeStats,
  generationOf,
  generationOfPokemonId,
  GEN_RANGES,
  MASTERY_REPETITIONS,
  MASTERY_INTERVAL_DAYS,
  STRUGGLING_MIN_REPS,
  STRUGGLING_DIFFICULTY_CUTOFF,
} from "./derive";
import type { ReviewState } from "@/lib/srs/scheduler";
import type { NameReviewCard, ReverseReviewCard, ReviewableCard } from "@/lib/review/session";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";

const TODAY = "2026-05-10";

function state(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    stability: 0,
    difficulty: 0,
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

function card(id: number, overrides: Partial<ReviewState> = {}): NameReviewCard {
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
    spriteUrl: "",
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
    state: state(overrides),
  };
}

/**
 * Build a form card where the pokemon ID (id) differs from the species ID
 * (speciesId). Mirrors the shape of Alolan/Galarian form entries once the
 * seed re-run lands.
 */
function formCard(
  id: number,
  speciesId: number,
  overrides: Partial<ReviewState> = {},
): NameReviewCard {
  return {
    ...card(id, overrides),
    id,
    speciesId,
    isDefaultForm: false,
    formCategory: "regional",
    formSlug: "alola",
    displayName: `Form of Pokemon ${speciesId}`,
  };
}

/**
 * Build a minimal reverse card for the given pokemon ID. The reverse-card ID
 * is REVERSE_ID_OFFSET + pokemonId, matching the convention in the seed and
 * the mastery lookup in computeStats.
 */
function reverseCard(
  pokemonId: number,
  overrides: Partial<ReviewState> = {},
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
    spriteUrl: "",
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
    state: state(overrides),
  };
}

/** A reverse card that passes the mastery gate: reps >= threshold, scheduledDays >= 21. */
function masteredReverse(pokemonId: number): ReverseReviewCard {
  return reverseCard(pokemonId, {
    lastReview: TODAY,
    reps: MASTERY_REPETITIONS,
    scheduledDays: MASTERY_INTERVAL_DAYS,
  });
}

// ---------------------------------------------------------------------------
// generationOf / generationOfPokemonId
// ---------------------------------------------------------------------------

describe("generationOf", () => {
  it("returns 1 for species 1 (Bulbasaur)", () => {
    expect(generationOf(1)).toBe(1);
  });

  it("returns correct gen for boundary species IDs", () => {
    for (const range of GEN_RANGES) {
      expect(generationOf(range.first)).toBe(range.gen);
      expect(generationOf(range.last)).toBe(range.gen);
    }
  });

  it("returns 0 for species IDs outside 1..1025 (e.g. form IDs 10001+)", () => {
    expect(generationOf(10100)).toBe(0); // Alolan Raichu's raw pokemon ID
    expect(generationOf(0)).toBe(0);
    expect(generationOf(1026)).toBe(0);
  });
});

describe("generationOfPokemonId", () => {
  it("resolves a default-form pokemon ID via the seed", () => {
    // Species 1 (Bulbasaur) is in Gen I
    expect(generationOfPokemonId(1)).toBe(1);
  });

  it("returns 0 for a pokemon ID not in the seed", () => {
    // 99999 is well outside any real PokéAPI ID range (default species 1..1025,
    // alternate forms 10001..10277). The seed never contains this ID.
    expect(generationOfPokemonId(99999)).toBe(0);
  });

  it("returns 0 for negative or zero IDs", () => {
    expect(generationOfPokemonId(0)).toBe(0);
    expect(generationOfPokemonId(-1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isMastered
// ---------------------------------------------------------------------------

describe("isMastered", () => {
  it("returns false for never-reviewed card", () => {
    expect(isMastered(state())).toBe(false);
  });

  it("returns false when reps met but interval below threshold", () => {
    expect(isMastered(state({ reps:MASTERY_REPETITIONS, scheduledDays: MASTERY_INTERVAL_DAYS - 1 }))).toBe(false);
  });

  it("returns false when interval met but reps below threshold", () => {
    expect(isMastered(state({ reps:MASTERY_REPETITIONS - 1, scheduledDays: MASTERY_INTERVAL_DAYS }))).toBe(false);
  });

  it("returns true when both reps and interval meet thresholds exactly", () => {
    expect(isMastered(state({ reps:MASTERY_REPETITIONS, scheduledDays: MASTERY_INTERVAL_DAYS }))).toBe(true);
  });

  it("returns true when both exceed thresholds", () => {
    expect(isMastered(state({ reps:5, scheduledDays: 60 }))).toBe(true);
  });

  it("respects a custom masteryRepetitions parameter", () => {
    const s = state({ reps:5, scheduledDays: MASTERY_INTERVAL_DAYS });
    expect(isMastered(s, 5)).toBe(true);
    expect(isMastered(s, 6)).toBe(false);
  });

  it("cards with high reps but interval < 21 are NOT mastered (regressions from old single-threshold gate)", () => {
    expect(isMastered(state({ reps:10, scheduledDays: 20 }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyCard
// ---------------------------------------------------------------------------

describe("classifyCard", () => {
  it("classifies never-reviewed card as locked", () => {
    expect(classifyCard(card(1))).toBe("locked");
  });

  it("classifies card reviewed once but below mastery as learning", () => {
    expect(classifyCard(card(1, { lastReview: TODAY, reps:1, scheduledDays: 1 }))).toBe("learning");
  });

  it("classifies card with high reps but low interval as learning", () => {
    expect(classifyCard(card(1, { lastReview: TODAY, reps:MASTERY_REPETITIONS, scheduledDays: MASTERY_INTERVAL_DAYS - 1 }))).toBe("learning");
  });

  it("classifies card meeting both thresholds as mastered", () => {
    expect(classifyCard(card(1, { lastReview: TODAY, reps:MASTERY_REPETITIONS, scheduledDays: MASTERY_INTERVAL_DAYS }))).toBe("mastered");
  });

  it("respects custom masteryRepetitions", () => {
    const c = card(1, { lastReview: TODAY, reps:3, scheduledDays: MASTERY_INTERVAL_DAYS });
    expect(classifyCard(c, 3)).toBe("mastered");
    expect(classifyCard(c, 4)).toBe("learning");
  });
});

// ---------------------------------------------------------------------------
// computeStats — mastery boundary
// ---------------------------------------------------------------------------

describe("computeStats mastery boundary", () => {
  it("does not count card with reps >= threshold but interval < 21 as mastered", () => {
    const cards = [card(1, { lastReview: TODAY, reps:MASTERY_REPETITIONS, scheduledDays: MASTERY_INTERVAL_DAYS - 1 })];
    const result = computeStats(cards, TODAY);
    expect(result.mastered).toBe(0);
    expect(result.learning).toBe(1);
  });

  it("counts card meeting both thresholds as mastered when paired reverse card is also mastered", () => {
    // Since #1234, species mastery requires BOTH name AND reverse cards to
    // pass the FSRS gate. Pass the full mixed array with a paired reverse card.
    const cards: ReviewableCard[] = [
      card(1, { lastReview: TODAY, reps: MASTERY_REPETITIONS, scheduledDays: MASTERY_INTERVAL_DAYS }),
      masteredReverse(1),
    ];
    const result = computeStats(cards, TODAY);
    expect(result.mastered).toBe(1);
    expect(result.learning).toBe(0);
  });

  it("does not count name card as mastered when paired reverse card is absent", () => {
    // Without a mastered reverse card the species is not species-mastered.
    const cards: ReviewableCard[] = [
      card(1, { lastReview: TODAY, reps: MASTERY_REPETITIONS, scheduledDays: MASTERY_INTERVAL_DAYS }),
    ];
    const result = computeStats(cards, TODAY);
    expect(result.mastered).toBe(0);
    expect(result.learning).toBe(1);  // introduced but not species-mastered
  });

  it("respects caller-supplied masteryRepetitions parameter", () => {
    const cards: ReviewableCard[] = [
      card(1, { lastReview: TODAY, reps: 3, scheduledDays: MASTERY_INTERVAL_DAYS }),
      masteredReverse(1),
    ];
    expect(computeStats(cards, TODAY, 10, 3).mastered).toBe(1);
    expect(computeStats(cards, TODAY, 10, 4).mastered).toBe(0);
  });

  it("totalCards reflects only name cards in the mixed array", () => {
    // computeStats accepts the full mixed array and counts only name cards
    // for totalCards. Reverse cards are excluded from the species count.
    const cards: ReviewableCard[] = [
      card(1, { lastReview: TODAY, reps: MASTERY_REPETITIONS, scheduledDays: MASTERY_INTERVAL_DAYS }),
      masteredReverse(1),
      card(2),
    ];
    const result = computeStats(cards, TODAY);
    expect(result.totalCards).toBe(2);  // 2 name cards, not 3 total
    expect(result.mastered).toBe(1);    // species 1 has both legs mastered
  });
});

// ---------------------------------------------------------------------------
// dueForecast
// ---------------------------------------------------------------------------

describe("computeStats.dueForecast", () => {
  it("emits 14 entries starting today", () => {
    const result = computeStats([card(1)], TODAY);
    expect(result.dueForecast).toHaveLength(14);
    expect(result.dueForecast[0].date).toBe(TODAY);
    expect(result.dueForecast[1].date).toBe("2026-05-11");
    expect(result.dueForecast[13].date).toBe("2026-05-23");
  });

  it("counts introduced cards due today (dueDate <= today, lastReview !== today)", () => {
    const cards = [
      // due today, not reviewed today → counts
      card(1, { lastReview: "2026-05-08", dueDate: TODAY }),
      // overdue, not reviewed today → still counts (dueDate <= today)
      card(2, { lastReview: "2026-05-05", dueDate: "2026-05-09" }),
      // reviewed today → excluded
      card(3, { lastReview: TODAY, dueDate: TODAY }),
      // never reviewed → excluded (those go in new queue)
      card(4, { lastReview: null, dueDate: TODAY }),
    ];
    const result = computeStats(cards, TODAY);
    expect(result.dueForecast[0].count).toBe(2);
  });

  it("counts cards on future days by exact dueDate match", () => {
    const cards = [
      card(1, { lastReview: TODAY, dueDate: "2026-05-11" }),
      card(2, { lastReview: TODAY, dueDate: "2026-05-11" }),
      card(3, { lastReview: TODAY, dueDate: "2026-05-14" }),
      // outside window — ignored
      card(4, { lastReview: TODAY, dueDate: "2026-05-24" }),
    ];
    const result = computeStats(cards, TODAY);
    expect(result.dueForecast[1].count).toBe(2); // 2026-05-11
    expect(result.dueForecast[4].count).toBe(1); // 2026-05-14
    expect(result.dueForecast[2].count).toBe(0);
    // Day 14 outside window
    const totalInWindow = result.dueForecast.reduce((s, d) => s + d.count, 0);
    expect(totalInWindow).toBe(3);
  });

  it("perType covers all 18 types and double-counts dual-type cards", () => {
    const cards: ReviewableCard[] = [
      // monotype fire, locked
      { ...card(1), types: ["fire"] },
      // dual fire/flying, species-mastered (name + paired reverse both mastered)
      {
        ...card(2, {
          lastReview: TODAY,
          reps: MASTERY_REPETITIONS,
          scheduledDays: MASTERY_INTERVAL_DAYS,
        }),
        types: ["fire", "flying"],
      },
      masteredReverse(2),
      // unknown type — silently ignored
      { ...card(3), types: ["mystery"] },
    ];
    const result = computeStats(cards, TODAY);
    expect(result.perType).toHaveLength(18);

    const fire = result.perType.find((t) => t.type === "fire")!;
    expect(fire.total).toBe(2);
    expect(fire.mastered).toBe(1);

    const flying = result.perType.find((t) => t.type === "flying")!;
    expect(flying.total).toBe(1);
    expect(flying.mastered).toBe(1);

    const water = result.perType.find((t) => t.type === "water")!;
    expect(water.total).toBe(0);
    expect(water.mastered).toBe(0);
  });

  it("never-reviewed cards (lastReview null) are excluded from every forecast day", () => {
    const cards = [
      card(1, { lastReview: null, dueDate: TODAY }),
      card(2, { lastReview: null, dueDate: "2026-05-11" }),
    ];
    const result = computeStats(cards, TODAY);
    expect(result.dueForecast.every((d) => d.count === 0)).toBe(true);
  });

  it("counts cards due on UTC today even when called with UTC today (not a local-tz behind-UTC date)", () => {
    // Regression guard for issue #834. Card dueDate values are stored as UTC
    // by the FSRS scheduler. Callers must pass UTC today so the forecast window
    // aligns with the queue builder. This test demonstrates the correct
    // behaviour: a card due on "UTC today" is counted in forecastCounts[0]
    // when `today` is also UTC today. If the caller mistakenly passed a
    // behind-UTC local date (e.g. "2026-05-09" when UTC is "2026-05-10"), the
    // card's dueDate (2026-05-10) > localToday (2026-05-09) and the card would
    // appear in forecastCounts[1] instead — matching the bug report.
    const UTC_TODAY = "2026-05-10";
    const LOCAL_TODAY_BEHIND_UTC = "2026-05-09"; // e.g. user in UTC−8 late at night
    const cardsDue = [
      card(1, { lastReview: "2026-05-08", dueDate: UTC_TODAY }),
      card(2, { lastReview: "2026-05-08", dueDate: UTC_TODAY }),
    ];

    // Correct: called with UTC today — both cards counted in day 0.
    const utcResult = computeStats(cardsDue, UTC_TODAY);
    expect(utcResult.dueForecast[0].count).toBe(2);
    expect(utcResult.dueForecast[1].count).toBe(0);

    // Wrong (bug): called with behind-UTC local date — cards "miss" today bar
    // and fall into day 1 instead, producing an empty today bar despite the
    // Practice screen showing them as reviews due.
    const localResult = computeStats(cardsDue, LOCAL_TODAY_BEHIND_UTC);
    expect(localResult.dueForecast[0].count).toBe(0); // today bar empty — the bug
    expect(localResult.dueForecast[1].count).toBe(2); // shows up tomorrow instead
  });
});

// ---------------------------------------------------------------------------
// computeStats — superuser pretendAllMastered
// ---------------------------------------------------------------------------

describe("computeStats with forceAllMastered", () => {
  // Picking IDs in different generations so the per-gen tally exercises both
  // present and absent generations.
  const cards = [
    card(1,   { lastReview: null }),             // gen 1, never seen
    card(2,   { lastReview: null }),             // gen 1, never seen
    card(200, { reps: 1, scheduledDays: 1, lastReview: "2026-05-09" }), // gen 2, learning
  ];

  it("reports everything mastered, nothing learning, nothing locked", () => {
    const result = computeStats(cards, TODAY, 10, MASTERY_REPETITIONS, true);
    expect(result.totalCards).toBe(3);
    expect(result.introduced).toBe(3);
    expect(result.mastered).toBe(3);
    expect(result.learning).toBe(0);
    expect(result.locked).toBe(0);
  });

  it("per-generation tallies treat every card as introduced and mastered", () => {
    const result = computeStats(cards, TODAY, 10, MASTERY_REPETITIONS, true);
    const gen1 = result.perGeneration.find((g) => g.gen === 1)!;
    expect(gen1.total).toBe(2);
    expect(gen1.introduced).toBe(2);
    expect(gen1.mastered).toBe(2);
    const gen2 = result.perGeneration.find((g) => g.gen === 2)!;
    expect(gen2.total).toBe(1);
    expect(gen2.introduced).toBe(1);
    expect(gen2.mastered).toBe(1);
    // Generations with zero cards stay zero — the overlay only inflates
    // mastered up to each generation's own total.
    const gen9 = result.perGeneration.find((g) => g.gen === 9)!;
    expect(gen9.total).toBe(0);
    expect(gen9.mastered).toBe(0);
  });

  it("per-type tallies treat every type bucket's total as mastered", () => {
    const result = computeStats(cards, TODAY, 10, MASTERY_REPETITIONS, true);
    const normal = result.perType.find((t) => t.type === "normal")!;
    expect(normal.total).toBe(3);
    expect(normal.mastered).toBe(3);
    expect(normal.introduced).toBe(3);
  });

  it("struggling list is empty under forceAllMastered", () => {
    const result = computeStats(cards, TODAY, 10, MASTERY_REPETITIONS, true);
    expect(result.struggling).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeStats — alternate-form generation bucketing
// ---------------------------------------------------------------------------

describe("computeStats form-card generation bucketing", () => {
  it("buckets a form card into its species' generation via speciesId", () => {
    // Simulates Alolan Raichu: raw id=10100 (hypothetical form id),
    // speciesId=26 (Raichu, Gen I). The form should land in Gen I, not gen 0.
    // Pair with a mastered reverse card so the species counts as mastered (#1234).
    const alolanRaichu = formCard(10100, 26, {
      lastReview: TODAY,
      reps: MASTERY_REPETITIONS,
      scheduledDays: MASTERY_INTERVAL_DAYS,
    });
    // The reverse card ID uses the pokemon's own id (10100), not speciesId.
    const alolanRaichuReverse = reverseCard(10100, {
      lastReview: TODAY,
      reps: MASTERY_REPETITIONS,
      scheduledDays: MASTERY_INTERVAL_DAYS,
    });
    const result = computeStats([alolanRaichu, alolanRaichuReverse], TODAY);
    const gen1 = result.perGeneration.find((g) => g.gen === 1)!;
    expect(gen1.total).toBe(1);
    expect(gen1.mastered).toBe(1);
    // No card should end up in gen 0 (out-of-range bucket, not in perGeneration)
    const allGenTotals = result.perGeneration.reduce((s, g) => s + g.total, 0);
    expect(allGenTotals).toBe(1);
  });

  it("a base-species and its form card both count in the same generation", () => {
    // Raichu (speciesId=26, Gen I) + Alolan Raichu (id=10100, speciesId=26, Gen I)
    // Raichu is species-mastered (name+reverse both mastered).
    // Alolan Raichu is only name-introduced but not species-mastered (no reverse card).
    const raichu = card(26, {
      lastReview: TODAY,
      reps: MASTERY_REPETITIONS,
      scheduledDays: MASTERY_INTERVAL_DAYS,
    });
    const alolanRaichu = formCard(10100, 26, {
      lastReview: TODAY,
      reps: 1,
      scheduledDays: 5,
    });
    // Pair a mastered reverse card with Raichu (id=26) so species 26 counts as mastered.
    const raichuReverse = masteredReverse(26);
    const result = computeStats([raichu, alolanRaichu, raichuReverse], TODAY);
    const gen1 = result.perGeneration.find((g) => g.gen === 1)!;
    expect(gen1.total).toBe(2);    // both name cards
    expect(gen1.mastered).toBe(1); // only Raichu species-mastered (has paired reverse)
    expect(gen1.introduced).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// computeStats — struggling-card gate (#736)
// ---------------------------------------------------------------------------

describe("computeStats struggling gate", () => {
  // Helper: a card below MIN_REPS (1 graduated review), non-struggling difficulty.
  const belowMinReps = () =>
    card(1, {
      lastReview: TODAY,
      reps: STRUGGLING_MIN_REPS - 1,
      lapses: 0,
      difficulty: 5,
    });

  // Helper: a card meeting MIN_REPS but with no struggle signal.
  const enoughRepsNoStruggle = () =>
    card(2, {
      lastReview: TODAY,
      reps: STRUGGLING_MIN_REPS,
      lapses: 0,
      difficulty: STRUGGLING_DIFFICULTY_CUTOFF - 1,
    });

  // Helper: a card meeting MIN_REPS with a lapse (struggle via lapses).
  const enoughRepsLapsed = () =>
    card(3, {
      lastReview: TODAY,
      reps: STRUGGLING_MIN_REPS,
      lapses: 1,
      difficulty: 5,
    });

  // Helper: a card meeting MIN_REPS with high difficulty but no lapse.
  const enoughRepsHighDifficulty = () =>
    card(4, {
      lastReview: TODAY,
      reps: STRUGGLING_MIN_REPS,
      lapses: 0,
      difficulty: STRUGGLING_DIFFICULTY_CUTOFF,
    });

  it("excludes a card below STRUGGLING_MIN_REPS even when difficulty is high", () => {
    const cards = [
      card(1, {
        lastReview: TODAY,
        reps: STRUGGLING_MIN_REPS - 1,
        lapses: 1,
        difficulty: STRUGGLING_DIFFICULTY_CUTOFF + 1,
      }),
    ];
    const result = computeStats(cards, TODAY);
    expect(result.struggling).toHaveLength(0);
  });

  it("excludes a card with reps >= MIN_REPS but no struggle signal (lapses = 0, difficulty below cutoff)", () => {
    const result = computeStats([enoughRepsNoStruggle()], TODAY);
    expect(result.struggling).toHaveLength(0);
  });

  it("includes a card with reps >= MIN_REPS and lapses > 0 regardless of difficulty", () => {
    const result = computeStats([enoughRepsLapsed()], TODAY);
    expect(result.struggling).toHaveLength(1);
    expect(result.struggling[0].id).toBe(3);
  });

  it("includes a card with reps >= MIN_REPS and difficulty >= STRUGGLING_DIFFICULTY_CUTOFF even when lapses = 0", () => {
    const result = computeStats([enoughRepsHighDifficulty()], TODAY);
    expect(result.struggling).toHaveLength(1);
    expect(result.struggling[0].id).toBe(4);
  });

  it("is empty when no card qualifies (all below MIN_REPS or no struggle signal)", () => {
    const result = computeStats([belowMinReps(), enoughRepsNoStruggle()], TODAY);
    expect(result.struggling).toHaveLength(0);
  });

  it("includes only qualifying cards from a mixed set", () => {
    const cards = [
      belowMinReps(),          // excluded: below MIN_REPS
      enoughRepsNoStruggle(),  // excluded: no struggle signal
      enoughRepsLapsed(),      // included: lapses > 0
      enoughRepsHighDifficulty(), // included: high difficulty
    ];
    const result = computeStats(cards, TODAY);
    expect(result.struggling).toHaveLength(2);
    const ids = result.struggling.map((c) => c.id).sort();
    expect(ids).toEqual([3, 4]);
  });

  it("sorts qualifying cards by difficulty descending", () => {
    const cards = [
      card(10, {
        lastReview: TODAY,
        reps: STRUGGLING_MIN_REPS,
        lapses: 1,
        difficulty: 6,
      }),
      card(11, {
        lastReview: TODAY,
        reps: STRUGGLING_MIN_REPS,
        lapses: 1,
        difficulty: 8,
      }),
      card(12, {
        lastReview: TODAY,
        reps: STRUGGLING_MIN_REPS,
        lapses: 1,
        difficulty: 7,
      }),
    ];
    const result = computeStats(cards, TODAY);
    expect(result.struggling.map((c) => c.id)).toEqual([11, 12, 10]);
  });

  it("respects the strugglingLimit cap", () => {
    const cards = Array.from({ length: 15 }, (_, i) =>
      card(i + 100, {
        lastReview: TODAY,
        reps: STRUGGLING_MIN_REPS,
        lapses: 1,
        difficulty: 8,
      }),
    );
    // Default limit is 10
    const result = computeStats(cards, TODAY);
    expect(result.struggling).toHaveLength(10);
  });
});
