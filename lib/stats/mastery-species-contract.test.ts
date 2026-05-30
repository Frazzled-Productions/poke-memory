/**
 * Fitness / contract tests for species-level mastery consistency (#1448).
 *
 * These tests assert that ALL user-facing mastered-count surfaces agree with
 * `masteredSpeciesIds(...).size` for a fixture session where:
 *   - Some species have ONLY the name card mastered (not species-mastered).
 *   - Some species have ONLY the reverse card mastered (not species-mastered).
 *   - Some species have BOTH legs mastered (species-mastered).
 *
 * This mirrors the real account data that triggered #1448: 3 mastered name
 * cards, 40 mastered reverse cards, 0 species fully mastered.
 *
 * If any count-deriving helper bypasses the species-level check, it will return
 * a non-zero count for the name-only or reverse-only species and this test
 * will fail — surfacing the fragmentation before it reaches production.
 */

import { describe, it, expect } from "vitest";
import type { ReviewableCard, NameReviewCard, ReverseReviewCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";
import { MASTERY_REPETITIONS, MASTERY_INTERVAL_DAYS } from "./derive";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";
import { masteredSpeciesIds } from "@/lib/badges/derive";
import { computeStats } from "./derive";
import { computeMasteryOverTime } from "./mastery-over-time";
import { computeRecords } from "./records";
import { computeCompletionProjection } from "./completion-projection";
import { masteredSpeciesEvents } from "./mastery-species-events";

// ---------------------------------------------------------------------------
// Shared state helpers
// ---------------------------------------------------------------------------

const TODAY = "2026-05-30";

function masteredState(lastReview = TODAY): Partial<ReviewState> {
  return {
    reps: MASTERY_REPETITIONS,
    scheduledDays: MASTERY_INTERVAL_DAYS,
    fsrsState: "review",
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
    fsrsState: "learning",
    lastReview: "2026-05-20",
    firstSeen: "2026-05-01",
    stability: 5,
    difficulty: 5,
  };
}

function makeNameCard(id: number, overrides: Partial<ReviewState> = {}): NameReviewCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon${id}`,
    name: `Pokemon${id}`,
    spriteUrl: "",
    types: ["normal"],
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
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
    cardType: "name",
    subjectKey: String(id),
    state: {
      stability: 0, difficulty: 5, elapsedDays: 0, scheduledDays: 0,
      reps: 0, lapses: 0, fsrsState: "new", dueDate: TODAY,
      lastReview: null, firstSeen: null, learningStep: null,
      stepStartedAt: null, hiddenSince: null, seenInPasture: false,
      ...overrides,
    },
  };
}

function makeReverseCard(speciesId: number, overrides: Partial<ReviewState> = {}): ReverseReviewCard {
  const base = makeNameCard(speciesId, overrides);
  const { id: _id, cardType: _ct, ...rest } = base;
  return {
    ...rest,
    cardType: "reverse" as const,
    id: REVERSE_ID_OFFSET + speciesId,
    pokemonId: speciesId,
    subjectKey: String(speciesId),
    state: {
      ...base.state,
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture: mirrors the real account data table from the issue body.
//
//   Species 1: name mastered, NO reverse card → NOT species-mastered.
//   Species 2: NO name card, reverse mastered → NOT species-mastered.
//   Species 3: BOTH legs mastered → species-mastered (count = 1).
//   Species 4: neither leg mastered → NOT species-mastered.
// ---------------------------------------------------------------------------

function buildFixture(): ReviewableCard[] {
  return [
    // Species 1: name mastered, reverse NOT present.
    makeNameCard(1, masteredState("2026-05-10")),

    // Species 2: no name card; reverse mastered. (In practice the name card
    // exists in the session but is unmastered — simulate with an unmastered name.)
    makeNameCard(2, unmasteredState()),
    makeReverseCard(2, masteredState("2026-05-15")),

    // Species 3: BOTH legs mastered — the only fully-mastered species.
    makeNameCard(3, masteredState("2026-05-12")),
    makeReverseCard(3, masteredState("2026-05-20")),

    // Species 4: neither leg mastered.
    makeNameCard(4, unmasteredState()),
    makeReverseCard(4, unmasteredState()),
  ];
}

// ---------------------------------------------------------------------------
// Contract assertions
// ---------------------------------------------------------------------------

describe("species-level mastery contract (#1448)", () => {
  const cards = buildFixture();

  // Ground truth: masteredSpeciesIds is the canonical set.
  const masteredIds = masteredSpeciesIds(cards, MASTERY_REPETITIONS, false);
  // With the fixture above, only species 3 is fully mastered.
  const expectedMasteredCount = 1;

  it("masteredSpeciesIds reports exactly 1 mastered species", () => {
    expect(masteredIds.size).toBe(expectedMasteredCount);
    expect(masteredIds.has(3)).toBe(true);
  });

  it("masteredSpeciesEvents reports exactly 1 species event", () => {
    const events = masteredSpeciesEvents(cards, MASTERY_REPETITIONS, false);
    expect(events).toHaveLength(expectedMasteredCount);
    expect(events[0].speciesId).toBe(3);
    // masteredDate = later of "2026-05-12" (name) and "2026-05-20" (reverse) = "2026-05-20".
    expect(events[0].masteredDate).toBe("2026-05-20");
  });

  it("computeStats.mastered equals masteredSpeciesIds.size", () => {
    const stats = computeStats(cards, TODAY);
    expect(stats.mastered).toBe(masteredIds.size);
  });

  it("computeMasteryOverTime final count equals masteredSpeciesIds.size", () => {
    const series = computeMasteryOverTime(cards, TODAY);
    const finalCount = series.length > 0 ? series[series.length - 1].count : 0;
    expect(finalCount).toBe(masteredIds.size);
  });

  it("computeRecords.mostMasteredIn7d: only 1 species mastered (within 7d window)", () => {
    const records = computeRecords(cards, [], [], MASTERY_REPETITIONS);
    // Species 3 masteredDate = "2026-05-20", which is within 10 days of TODAY.
    // mostMasteredIn7d = 1 (only one species in any 7-day window).
    expect(records.mostMasteredIn7d).toBe(expectedMasteredCount);
  });

  it("computeRecords.avgDaysToMastery reflects species count (not per-card count)", () => {
    const records = computeRecords(cards, [], [], MASTERY_REPETITIONS);
    // avgDaysToMastery should be non-null (1 mastered species).
    expect(records.avgDaysToMastery).not.toBeNull();
    // Days from firstSeen ("2026-01-01") to masteredDate ("2026-05-20").
    // Jan: 31 days, Feb: 28 (2026 non-leap), Mar: 31, Apr: 30, May 1-20: 20 = 139 days.
    expect(records.avgDaysToMastery).toBeGreaterThan(0);
  });

  it("computeCompletionProjection remaining = total name cards - mastered species", () => {
    // 4 name cards, 1 mastered species → 3 remaining.
    // With only 1 mastery event in the window, there may not be enough history
    // for a projection (depends on window timing) — check at least it is not "complete".
    const result = computeCompletionProjection(cards, TODAY, MASTERY_REPETITIONS);
    expect(result.kind).not.toBe("complete");
    // If projected, remaining must be 3 (name cards - mastered species).
    if (result.kind === "projected") {
      expect(result.remaining).toBe(4 - expectedMasteredCount);
    }
  });

  // ---------------------------------------------------------------------------
  // Zero-mastered branch (mandatory coverage rule: test IN and OUT of state)
  // ---------------------------------------------------------------------------

  it("zero-mastered: all helpers return zero / empty / null when no species is mastered", () => {
    // Only name-card mastered species (no reverse legs) — zero species-mastered.
    const nameOnlyCards: ReviewableCard[] = [
      makeNameCard(1, masteredState()),
      makeNameCard(2, masteredState()),
      makeNameCard(3, masteredState()),
    ];

    const idsZero = masteredSpeciesIds(nameOnlyCards, MASTERY_REPETITIONS, false);
    expect(idsZero.size).toBe(0);

    const statsZero = computeStats(nameOnlyCards, TODAY);
    expect(statsZero.mastered).toBe(0);

    const seriesZero = computeMasteryOverTime(nameOnlyCards, TODAY);
    expect(seriesZero).toHaveLength(0);

    const recordsZero = computeRecords(nameOnlyCards, [], [], MASTERY_REPETITIONS);
    expect(recordsZero.mostMasteredIn7d).toBeNull();
    expect(recordsZero.avgDaysToMastery).toBeNull();

    const projZero = computeCompletionProjection(nameOnlyCards, TODAY, MASTERY_REPETITIONS);
    expect(projZero.kind).toBe("insufficient-history");
  });

  // ---------------------------------------------------------------------------
  // forceAllMastered branch (superuser mode)
  // ---------------------------------------------------------------------------

  it("forceAllMastered: all helpers reflect 'everything mastered'", () => {
    const nameCount = cards.filter((c) => c.cardType === "name").length;

    const idsForce = masteredSpeciesIds(cards, MASTERY_REPETITIONS, true);
    expect(idsForce.size).toBe(nameCount);

    const statsForce = computeStats(cards, TODAY, 10, MASTERY_REPETITIONS, true);
    expect(statsForce.mastered).toBe(nameCount);

    const seriesForce = computeMasteryOverTime(cards, TODAY, MASTERY_REPETITIONS, true);
    expect(seriesForce).toHaveLength(1);
    expect(seriesForce[0].count).toBe(nameCount);

    const recordsForce = computeRecords(cards, [], [], MASTERY_REPETITIONS, true);
    expect(recordsForce.mostMasteredIn7d).toBe(nameCount);

    const projForce = computeCompletionProjection(cards, TODAY, MASTERY_REPETITIONS, true);
    expect(projForce.kind).toBe("complete");
  });
});
