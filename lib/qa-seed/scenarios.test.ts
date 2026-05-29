/**
 * Unit tests for QA seed scenario builders (#1326).
 *
 * Tests run in the `node` vitest project (lib/**) — no DOM, no IDB.
 * All builders are pure functions; we only test the returned serialisable
 * payload shapes.
 */

import { describe, it, expect } from "vitest";
import {
  masteredState,
  learningState,
  newState,
  heavilyReviewedState,
  masteredPair,
  masteredReverseCard,
  masteredNameCard,
  buildFsrsLocaleMasteryScenario,
  buildOptimiserStressScenario,
  buildPastureProgressionScenario,
  buildScenario,
  SCENARIO_META,
  DEFAULT_SEED_LIMITS,
  type ScenarioKey,
} from "@/lib/qa-seed/scenarios";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";

// ---------------------------------------------------------------------------
// Primitive builders
// ---------------------------------------------------------------------------

describe("masteredState", () => {
  it("produces reps >= 4 and scheduledDays >= 28", () => {
    const s = masteredState({ firstSeen: "2026-03-01", lastReview: "2026-05-13" });
    expect(s.reps).toBeGreaterThanOrEqual(4);
    expect(s.scheduledDays).toBeGreaterThanOrEqual(28);
  });

  it("sets seenInPasture from opts", () => {
    const notSeen = masteredState({ firstSeen: "2026-03-01", lastReview: "2026-05-13", seenInPasture: false });
    expect(notSeen.seenInPasture).toBe(false);
    const seen = masteredState({ firstSeen: "2026-03-01", lastReview: "2026-05-13", seenInPasture: true });
    expect(seen.seenInPasture).toBe(true);
  });

  it("uses provided dueDate", () => {
    const s = masteredState({ firstSeen: "2026-03-01", lastReview: "2026-05-01", dueDate: "2026-08-01" });
    expect(s.dueDate).toBe("2026-08-01");
  });
});

describe("learningState", () => {
  it("produces reps < 4 (not yet mastered)", () => {
    const s = learningState({ firstSeen: "2026-05-20", reps: 2, scheduledDays: 5 });
    expect(s.reps).toBeLessThan(4);
    expect(s.firstSeen).toBe("2026-05-20");
  });

  it("defaults reps to 1 when not provided", () => {
    const s = learningState({ firstSeen: "2026-05-20" });
    expect(s.reps).toBe(1);
  });
});

describe("newState", () => {
  it("has reps=0, firstSeen=null, lastReview=null", () => {
    const s = newState();
    expect(s.reps).toBe(0);
    expect(s.firstSeen).toBeNull();
    expect(s.lastReview).toBeNull();
    expect(s.fsrsState).toBe("new");
  });
});

describe("heavilyReviewedState", () => {
  it("reflects provided reps and scheduledDays", () => {
    const s = heavilyReviewedState({
      firstSeen: "2025-12-01",
      lastReview: "2026-05-01",
      reps: 15,
      scheduledDays: 90,
    });
    expect(s.reps).toBe(15);
    expect(s.scheduledDays).toBe(90);
  });

  it("uses lapses when provided", () => {
    const s = heavilyReviewedState({
      firstSeen: "2025-12-01",
      lastReview: "2026-05-01",
      reps: 10,
      scheduledDays: 40,
      lapses: 2,
    });
    expect(s.lapses).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Card builders
// ---------------------------------------------------------------------------

describe("masteredNameCard", () => {
  it("produces a name card with the correct id and locale", () => {
    const card = masteredNameCard({ id: 25, name: "Pikachu", locale: "en" });
    expect(card.id).toBe(25);
    expect(card.cardType).toBe("name");
    expect(card.locale).toBe("en");
    expect(card.state.reps).toBeGreaterThanOrEqual(4);
  });
});

describe("masteredReverseCard", () => {
  it("produces a reverse card with id = REVERSE_ID_OFFSET + pokemonId", () => {
    const card = masteredReverseCard({ pokemonId: 10 });
    expect(card.id).toBe(REVERSE_ID_OFFSET + 10);
    expect(card.cardType).toBe("reverse");
    expect(card.pokemonId).toBe(10);
  });
});

describe("masteredPair", () => {
  it("returns both name and reverse card with matching ids", () => {
    const [name, reverse] = masteredPair({ id: 7, name: "Squirtle" });
    expect(name.id).toBe(7);
    expect(reverse.id).toBe(REVERSE_ID_OFFSET + 7);
    expect(name.state.reps).toBeGreaterThanOrEqual(4);
    expect(reverse.state.reps).toBeGreaterThanOrEqual(4);
  });

  it("propagates locale to both cards", () => {
    const [name, reverse] = masteredPair({ id: 1, name: "Bulbasaur", locale: "en" });
    expect(name.locale).toBe("en");
    expect(reverse.locale).toBe("en");
  });
});

// ---------------------------------------------------------------------------
// Scenario builders — shape and size checks
// ---------------------------------------------------------------------------

describe("buildFsrsLocaleMasteryScenario", () => {
  it("returns a payload with the expected session shape", () => {
    const payload = buildFsrsLocaleMasteryScenario();
    expect(payload.session).toBeDefined();
    expect(Array.isArray(payload.session.cards)).toBe(true);
    expect(payload.session.limits).toEqual(DEFAULT_SEED_LIMITS);
  });

  it("contains at least 30 mastered name cards", () => {
    const payload = buildFsrsLocaleMasteryScenario();
    const masteredNameCards = payload.session.cards.filter(
      (c) => c.cardType === "name" && c.state.reps >= 4 && c.state.scheduledDays >= 21,
    );
    expect(masteredNameCards.length).toBeGreaterThanOrEqual(30);
  });

  it("all name cards have locale='en'", () => {
    const payload = buildFsrsLocaleMasteryScenario();
    const nameCards = payload.session.cards.filter((c) => c.cardType === "name");
    for (const card of nameCards) {
      expect(card.locale).toBe("en");
    }
  });

  it("every mastered name card has a paired mastered reverse card", () => {
    const payload = buildFsrsLocaleMasteryScenario();
    const masteredIds = new Set(
      payload.session.cards
        .filter((c) => c.cardType === "name" && c.state.reps >= 4)
        .map((c) => c.id),
    );
    for (const id of masteredIds) {
      const reverseId = REVERSE_ID_OFFSET + id;
      const reverse = payload.session.cards.find((c) => c.id === reverseId);
      expect(reverse).toBeDefined();
      if (reverse) {
        expect(reverse.state.reps).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("contains some in-learning cards (not mastered)", () => {
    const payload = buildFsrsLocaleMasteryScenario();
    const learning = payload.session.cards.filter(
      (c) => c.cardType === "name" && c.state.reps < 4,
    );
    expect(learning.length).toBeGreaterThan(0);
  });
});

describe("buildOptimiserStressScenario", () => {
  it("returns a valid session payload", () => {
    const payload = buildOptimiserStressScenario();
    expect(payload.session.cards.length).toBeGreaterThan(0);
  });

  it("total reps across name cards exceed 200 (enough for optimiser)", () => {
    const payload = buildOptimiserStressScenario();
    const totalReps = payload.session.cards
      .filter((c) => c.cardType === "name")
      .reduce((sum, c) => sum + c.state.reps, 0);
    expect(totalReps).toBeGreaterThan(200);
  });

  it("contains at least 2 single-review cards", () => {
    const payload = buildOptimiserStressScenario();
    const singleReview = payload.session.cards.filter(
      (c) => c.cardType === "name" && c.state.reps === 1,
    );
    expect(singleReview.length).toBeGreaterThanOrEqual(2);
  });
});

describe("buildPastureProgressionScenario", () => {
  it("returns a valid session payload with mastered pairs", () => {
    const payload = buildPastureProgressionScenario();
    expect(payload.session.cards.length).toBeGreaterThan(0);

    const masteredNames = payload.session.cards.filter(
      (c) => c.cardType === "name" && c.state.reps >= 4,
    );
    expect(masteredNames.length).toBeGreaterThan(0);
  });

  it("covers multiple habitats", () => {
    const payload = buildPastureProgressionScenario();
    const habitats = new Set(
      payload.session.cards
        .filter((c) => c.cardType === "name" && "habitat" in c && c.habitat)
        .map((c) => (c as { habitat: string }).habitat),
    );
    expect(habitats.size).toBeGreaterThanOrEqual(4);
  });

  it("includes a mix of mastered and in-learning cards", () => {
    const payload = buildPastureProgressionScenario();
    const mastered = payload.session.cards.filter(
      (c) => c.cardType === "name" && c.state.reps >= 4,
    );
    const learning = payload.session.cards.filter(
      (c) => c.cardType === "name" && c.state.reps < 4 && c.state.reps > 0,
    );
    expect(mastered.length).toBeGreaterThan(0);
    expect(learning.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildScenario dispatch
// ---------------------------------------------------------------------------

describe("buildScenario", () => {
  it("dispatches to the correct builder for each ScenarioKey", () => {
    const keys: ScenarioKey[] = [
      "fsrs-locale-mastery",
      "optimiser-stress",
      "pasture-progression",
    ];
    for (const key of keys) {
      const payload = buildScenario(key);
      expect(payload.session.cards.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// SCENARIO_META completeness
// ---------------------------------------------------------------------------

describe("SCENARIO_META", () => {
  it("lists exactly three scenarios matching the required ACs", () => {
    expect(SCENARIO_META).toHaveLength(3);
    const keys = SCENARIO_META.map((m) => m.key);
    expect(keys).toContain("fsrs-locale-mastery");
    expect(keys).toContain("optimiser-stress");
    expect(keys).toContain("pasture-progression");
  });

  it("each entry has label and description", () => {
    for (const meta of SCENARIO_META) {
      expect(typeof meta.label).toBe("string");
      expect(meta.label.length).toBeGreaterThan(0);
      expect(typeof meta.description).toBe("string");
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Payload is serialisable (no circular references, no DOM objects)
// ---------------------------------------------------------------------------

describe("scenario payloads are JSON-serialisable", () => {
  const keys: ScenarioKey[] = [
    "fsrs-locale-mastery",
    "optimiser-stress",
    "pasture-progression",
  ];
  for (const key of keys) {
    it(`${key} round-trips through JSON.parse(JSON.stringify(...))`, () => {
      const payload = buildScenario(key);
      const serialised = JSON.stringify(payload.session);
      const parsed: unknown = JSON.parse(serialised);
      expect(parsed).toMatchObject({ cards: expect.any(Array) });
    });
  }
});
