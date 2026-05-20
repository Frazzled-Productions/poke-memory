/**
 * Unit tests for patchForecastTodayBar (#1117).
 *
 * Verifies that the today bar (index 0) in the due-forecast array matches
 * the Practice page queue total (new + learning + review) for three key
 * scenarios, and that future bars (indices 1–13) are left unchanged.
 *
 * The helper is a pure function so no mocks are needed; we supply minimal
 * card fixtures and pre-built DueForecastDay arrays.
 */

import { describe, it, expect } from "vitest";
import { patchForecastTodayBar } from "@/app/stats/page";
import {
  buildSessionQueues,
  DEFAULT_LIMITS,
  type ReviewableCard,
  type NameReviewCard,
} from "@/lib/review/session";
import {
  computeEligibleCardIds,
  EMPTY_SCOPE,
  type EligibilitySettings,
} from "@/lib/review/scope";
import type { DueForecastDay } from "@/lib/stats/derive";
import type { ReviewState } from "@/lib/srs/scheduler";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TODAY = "2026-05-20";

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

function nameCard(
  id: number,
  overrides: Partial<ReviewState> = {},
  extra: Partial<NameReviewCard> = {},
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
    ...extra,
  };
}

/** Build 14-entry forecast array, all counts set to a fixed default. */
function makeForecast(countOverride?: Partial<Record<number, number>>): readonly DueForecastDay[] {
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(TODAY);
    d.setUTCDate(d.getUTCDate() + i);
    return {
      date: d.toISOString().slice(0, 10),
      count: countOverride?.[i] ?? i * 2,
    };
  });
}

/** Default eligibility settings — all directions enabled, empty scope. */
function defaultSettings(): EligibilitySettings {
  return {
    nameCardsEnabled: true,
    evolutionCardsEnabled: true,
    reverseCardsEnabled: false,
    reverseEvolutionCardsEnabled: false,
    cryCardsEnabled: false,
    alternateFormsEnabled: false,
    practiceScope: EMPTY_SCOPE,
  };
}

/** Compute the queue total the same way the Practice page does. */
function queueTotal(
  cards: readonly ReviewableCard[],
  settings: EligibilitySettings,
): number {
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
// Scenario 1 — default settings (all directions on, empty scope)
// ---------------------------------------------------------------------------

describe("patchForecastTodayBar — default settings", () => {
  it("today bar matches buildSessionQueues total for new + review cards", () => {
    const cards: ReviewableCard[] = [
      // new card (never reviewed)
      nameCard(1),
      nameCard(2),
      nameCard(3),
      // review due today (introduced, not reviewed today)
      nameCard(10, { lastReview: "2026-05-18", dueDate: TODAY }),
      nameCard(11, { lastReview: "2026-05-17", dueDate: TODAY }),
      // reviewed already today — excluded
      nameCard(20, { lastReview: TODAY, dueDate: TODAY }),
    ];
    const settings = defaultSettings();
    const forecast = makeForecast({ 0: 99 }); // seed with wrong value
    const patched = patchForecastTodayBar(forecast, cards, settings, DEFAULT_LIMITS, TODAY);

    expect(patched[0].count).toBe(queueTotal(cards, settings));
  });

  it("future bars are not changed", () => {
    const cards: ReviewableCard[] = [nameCard(1)];
    const forecast = makeForecast();
    const patched = patchForecastTodayBar(forecast, cards, defaultSettings(), DEFAULT_LIMITS, TODAY);

    // Indices 1–13 must remain exactly as provided.
    for (let i = 1; i < 14; i++) {
      expect(patched[i]).toStrictEqual(forecast[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — scope-filtered (Gen I only)
// ---------------------------------------------------------------------------

describe("patchForecastTodayBar — scope-filtered", () => {
  it("today bar excludes cards outside the active scope", () => {
    const genIScope = { ...EMPTY_SCOPE, gens: [1] };
    const settings: EligibilitySettings = { ...defaultSettings(), practiceScope: genIScope };

    const cards: ReviewableCard[] = [
      // Gen I (id 1 → species 1 → Gen I) — eligible
      nameCard(1),
      nameCard(4),
      // Gen II-ish (ids outside Gen I range 1–151) — excluded by scope
      nameCard(152, { lastReview: "2026-05-18", dueDate: TODAY }),
      nameCard(153, { lastReview: "2026-05-18", dueDate: TODAY }),
    ];

    const forecast = makeForecast({ 0: 999 });
    const patched = patchForecastTodayBar(forecast, cards, settings, DEFAULT_LIMITS, TODAY);

    const expected = queueTotal(cards, settings);
    expect(patched[0].count).toBe(expected);
    // Sanity-check: only the Gen I new cards (1, 4) should be in the queue.
    expect(expected).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — alternate-forms enabled
// ---------------------------------------------------------------------------

describe("patchForecastTodayBar — alternate-forms-on", () => {
  it("today bar includes form cards when alternateFormsEnabled is true", () => {
    const settings: EligibilitySettings = {
      ...defaultSettings(),
      alternateFormsEnabled: true,
    };

    const cards: ReviewableCard[] = [
      // default form — always eligible
      nameCard(1),
      // alternate form — eligible only when alternateFormsEnabled is true
      nameCard(10100, {}, {
        id: 10100,
        speciesId: 26,
        isDefaultForm: false,
        formCategory: "regional",
        formSlug: "alola",
        displayName: "Alolan Raichu",
        name: "raichu-alola",
      }),
    ];

    const forecastFormsOff = makeForecast({ 0: 999 });
    const patchedFormsOff = patchForecastTodayBar(
      forecastFormsOff,
      cards,
      { ...settings, alternateFormsEnabled: false },
      DEFAULT_LIMITS,
      TODAY,
    );
    const forecastFormsOn = makeForecast({ 0: 999 });
    const patchedFormsOn = patchForecastTodayBar(
      forecastFormsOn,
      cards,
      settings,
      DEFAULT_LIMITS,
      TODAY,
    );

    // With forms off, only card 1 (default form) is included.
    expect(patchedFormsOff[0].count).toBe(1);
    // With forms on, both cards are included.
    expect(patchedFormsOn[0].count).toBe(2);
    // Both match their respective queueTotals.
    expect(patchedFormsOff[0].count).toBe(
      queueTotal(cards, { ...settings, alternateFormsEnabled: false }),
    );
    expect(patchedFormsOn[0].count).toBe(queueTotal(cards, settings));
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("patchForecastTodayBar — edge cases", () => {
  it("returns the original forecast unchanged when the array is empty", () => {
    const forecast: readonly DueForecastDay[] = [];
    const result = patchForecastTodayBar(forecast, [], defaultSettings(), DEFAULT_LIMITS, TODAY);
    expect(result).toBe(forecast);
  });

  it("today date string on patched entry is preserved", () => {
    const cards: ReviewableCard[] = [nameCard(1)];
    const forecast = makeForecast();
    const patched = patchForecastTodayBar(forecast, cards, defaultSettings(), DEFAULT_LIMITS, TODAY);
    expect(patched[0].date).toBe(TODAY);
  });
});
