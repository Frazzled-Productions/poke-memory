import { describe, it, expect } from "vitest";
import {
  isMastered,
  classifyCard,
  computeStats,
  MASTERY_REPETITIONS,
  MASTERY_INTERVAL_DAYS,
} from "./derive";
import type { ReviewState } from "@/lib/srs/scheduler";
import type { NameReviewCard } from "@/lib/review/session";

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
    cardType: "name",
    state: state(overrides),
  };
}

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

  it("counts card meeting both thresholds as mastered", () => {
    const cards = [card(1, { lastReview: TODAY, reps:MASTERY_REPETITIONS, scheduledDays: MASTERY_INTERVAL_DAYS })];
    const result = computeStats(cards, TODAY);
    expect(result.mastered).toBe(1);
    expect(result.learning).toBe(0);
  });

  it("respects caller-supplied masteryRepetitions parameter", () => {
    const cards = [card(1, { lastReview: TODAY, reps:3, scheduledDays: MASTERY_INTERVAL_DAYS })];
    expect(computeStats(cards, TODAY, 10, 3).mastered).toBe(1);
    expect(computeStats(cards, TODAY, 10, 4).mastered).toBe(0);
  });

  it("totalCards reflects only name cards passed in — reverse cards filtered upstream do not inflate count", () => {
    // computeStats receives cards.filter(c => c.cardType === "name") from the
    // stats page, so reverse cards never reach it. This test documents that
    // expectation: passing only name cards keeps totalCards at the name-card count.
    const nameCards = [
      card(1, { lastReview: TODAY, reps:MASTERY_REPETITIONS, scheduledDays: MASTERY_INTERVAL_DAYS }),
      card(2),
    ];
    const result = computeStats(nameCards, TODAY);
    expect(result.totalCards).toBe(2);
    expect(result.mastered).toBe(1);
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
    const cards = [
      // monotype fire, locked
      { ...card(1), types: ["fire"] },
      // dual fire/flying, mastered
      {
        ...card(2, {
          lastReview: TODAY,
          reps: MASTERY_REPETITIONS,
          scheduledDays: MASTERY_INTERVAL_DAYS,
        }),
        types: ["fire", "flying"],
      },
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
});
