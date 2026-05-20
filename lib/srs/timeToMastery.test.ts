import { describe, it, expect } from "vitest";
import { projectTimeToFirstMastery } from "./timeToMastery";
import type { ReviewState } from "@/lib/srs/scheduler";
import type { NameReviewCard } from "@/lib/review/session";

const NOW = new Date("2026-05-20T12:00:00Z");

function makeState(overrides: Partial<ReviewState>): ReviewState {
  return {
    stability: 0,
    difficulty: 0,
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

function makeCard(id: number, state: ReviewState): NameReviewCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon${id}`,
    name: `Pokemon${id}`,
    spriteUrl: `/sprites/pokemon/${id}.png`,
    types: ["normal"],
    stats: {
      hp: 45,
      attack: 49,
      defense: 49,
      specialAttack: 65,
      specialDefense: 65,
      speed: 45,
    },
    flavorText: "",
    flavorTexts: [""],
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
    cardType: "name",
    subjectKey: String(id),
    state,
  };
}

describe("projectTimeToFirstMastery", () => {
  it("returns null when there are no cards", () => {
    expect(projectTimeToFirstMastery([], NOW).days).toBeNull();
  });

  it("returns null when no card is introduced (all locked)", () => {
    const cards = [
      makeCard(1, makeState({})),
      makeCard(2, makeState({})),
    ];
    expect(projectTimeToFirstMastery(cards, NOW).days).toBeNull();
  });

  it("returns null when all introduced cards are already mastered", () => {
    const mastered = makeState({
      reps: 5,
      scheduledDays: 30,
      fsrsState: "review",
      lastReview: "2026-05-19",
      firstSeen: "2026-04-01",
      stability: 30,
      difficulty: 5,
    });
    expect(
      projectTimeToFirstMastery([makeCard(1, mastered)], NOW).days,
    ).toBeNull();
  });

  it("returns null when the superuser pretendAllMastered flag is on", () => {
    const introduced = makeState({
      reps: 1,
      scheduledDays: 1,
      fsrsState: "review",
      lastReview: "2026-05-20",
      firstSeen: "2026-05-20",
      stability: 1,
      difficulty: 5,
    });
    expect(
      projectTimeToFirstMastery([makeCard(1, introduced)], NOW, 3, true).days,
    ).toBeNull();
  });

  it("projects a finite, reasonable number of days for one freshly-graduated card", () => {
    const introduced = makeState({
      reps: 1,
      scheduledDays: 1,
      fsrsState: "review",
      lastReview: "2026-05-20",
      firstSeen: "2026-05-20",
      stability: 1,
      difficulty: 5,
    });
    const result = projectTimeToFirstMastery([makeCard(1, introduced)], NOW);
    expect(result.days).not.toBeNull();
    // FSRS under "always Good" needs reps >= 3 AND scheduledDays >= 21.
    // From scheduledDays=1, three more Good grades take the user past the
    // 21-day floor; the exact count depends on FSRS parameters but is
    // bounded between roughly two and twelve weeks.
    expect(result.days!).toBeGreaterThanOrEqual(14);
    expect(result.days!).toBeLessThanOrEqual(120);
  });

  it("picks the card with the shortest projected time when multiple are introduced", () => {
    // A card that has been reviewed more successfully (higher stability,
    // larger scheduledDays) should reach mastery sooner than a struggling
    // one with low stability and a recent lapse.
    const close = makeState({
      reps: 2,
      scheduledDays: 14,
      fsrsState: "review",
      lastReview: "2026-05-19",
      firstSeen: "2026-05-01",
      stability: 14,
      difficulty: 4,
    });
    const far = makeState({
      reps: 1,
      scheduledDays: 1,
      fsrsState: "review",
      lastReview: "2026-05-20",
      firstSeen: "2026-05-20",
      stability: 1,
      difficulty: 7,
      lapses: 1,
    });
    const closeAlone = projectTimeToFirstMastery(
      [makeCard(1, close)],
      NOW,
    );
    const farAlone = projectTimeToFirstMastery([makeCard(2, far)], NOW);
    const both = projectTimeToFirstMastery(
      [makeCard(1, close), makeCard(2, far)],
      NOW,
    );

    expect(closeAlone.days).not.toBeNull();
    expect(farAlone.days).not.toBeNull();
    expect(both.days).toBe(Math.min(closeAlone.days!, farAlone.days!));
  });

  it("skips cards in a brand-new learning step (lastReview === null) because they are not yet introduced", () => {
    // A card the user has touched once but not graduated is not "introduced"
    // by the stats definition (`lastReview !== null`). The hint hides when
    // introduced === 0, so the projection must mirror that contract.
    const inStep = makeState({
      learningStep: 0,
      stepStartedAt: NOW.getTime(),
      firstSeen: "2026-05-20",
    });
    expect(
      projectTimeToFirstMastery([makeCard(1, inStep)], NOW).days,
    ).toBeNull();
  });

  it("returns at least 1 day even when the simulation lands sub-1-day from now", () => {
    // A card already at reps=3 and scheduledDays=20 is one Good grade away
    // from mastery. The simulated clock advances by `scheduledDays` (20 days),
    // so the result will be at least 20. The floor exists to defend against
    // a pathological zero-interval state.
    const almost = makeState({
      reps: 3,
      scheduledDays: 20,
      fsrsState: "review",
      lastReview: "2026-05-19",
      firstSeen: "2026-04-01",
      stability: 20,
      difficulty: 4,
    });
    const result = projectTimeToFirstMastery([makeCard(1, almost)], NOW);
    expect(result.days).not.toBeNull();
    expect(result.days!).toBeGreaterThanOrEqual(1);
  });
});
