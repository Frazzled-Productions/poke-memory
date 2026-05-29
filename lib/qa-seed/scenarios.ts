/**
 * QA seed scenario registry.
 *
 * Each scenario is a named, deterministic data payload that gets written to
 * IndexedDB (and localStorage settings where relevant) so a fresh-visitor
 * preview can exercise data-dependent behaviour without grinding through the
 * new-card queue.
 *
 * IMPORTANT: scenario payloads are LOCAL-ONLY. They write to the same IDB
 * store that the app reads, so they are indistinguishable from real progress —
 * but the sync write-guard on SuperuserContext suppresses all cloud writes
 * while any superuser flag is on (including qaSeedMode). Seeded data can
 * therefore never reach Supabase.
 *
 * To add a new scenario: add an entry to SCENARIOS and implement a builder
 * function that returns a SeedPayload. Keep builders pure (no side effects);
 * the save step lives in applySeedScenario.
 */

import type { ReviewState } from "@/lib/srs/scheduler";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A partial ReviewState suitable for seeding. All required fields must be present. */
type SeededState = ReviewState;

/** Minimal serialised card shape accepted by lib/review/persistence.ts parseSession. */
type SeededNameCard = {
  cardType: "name";
  id: number;
  locale: string;
  name: string;
  spriteUrl: string;
  subjectKey: string;
  state: SeededState;
};

type SeededEvolutionCard = {
  cardType: "evolution";
  id: number;
  preEvoId: number;
  postEvoId: number;
  locale: string;
  subjectKey: string;
  state: SeededState;
};

type SeededCard = SeededNameCard | SeededEvolutionCard;

type DailyLimits = {
  name: { maxNewPerDay: number; maxReviewsPerDay: number };
  evolution: { maxNewPerDay: number; maxReviewsPerDay: number };
  reverse: { maxNewPerDay: number; maxReviewsPerDay: number };
  cry: { maxNewPerDay: number; maxReviewsPerDay: number };
};

/**
 * Payload written to IndexedDB when a scenario is applied.
 * All fields are optional; only the provided keys are written.
 */
export type SeedPayload = {
  /** Serialised SavedSession (cards + limits). Written to KEY_REVIEW_SESSION. */
  session?: { cards: SeededCard[]; limits: DailyLimits };
  /** pokemonNameLocale to write into settings. null = do not touch settings. */
  pokemonNameLocale?: "en" | "ja" | "zh-Hans" | "zh-Hant" | null;
};

export type Scenario = {
  slug: string;
  label: string;
  description: string;
  build: () => SeedPayload;
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Returns an ISO "YYYY-MM-DD" date string offset from today by `days` days.
 * Positive = future (scheduled ahead), negative = past (overdue).
 */
function relativeDate(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const TODAY = relativeDate(0);
const PAST_30 = relativeDate(-30);
const PAST_15 = relativeDate(-15);
const PAST_7 = relativeDate(-7);
const FUTURE_3 = relativeDate(3);
const FUTURE_7 = relativeDate(7);
const FUTURE_21 = relativeDate(21);

const DEFAULT_LIMITS: DailyLimits = {
  name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  evolution: { maxNewPerDay: 5, maxReviewsPerDay: 100 },
  reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
};

/** Returns a mastered ReviewState (reps >= 3, scheduledDays >= 21). */
function masteredState(opts: {
  dueDate?: string;
  lastReview?: string;
  firstSeen?: string;
  scheduledDays?: number;
} = {}): SeededState {
  return {
    stability: 50,
    difficulty: 4.5,
    elapsedDays: 21,
    scheduledDays: opts.scheduledDays ?? 28,
    reps: 4,
    lapses: 0,
    fsrsState: "review",
    dueDate: opts.dueDate ?? FUTURE_7,
    lastReview: opts.lastReview ?? PAST_7,
    firstSeen: opts.firstSeen ?? PAST_30,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: true,
  };
}

/** Returns an in-learning ReviewState (reps = 0, stepIndex = 0). */
function learningState(opts: {
  dueDate?: string;
  firstSeen?: string;
} = {}): SeededState {
  return {
    stability: 0,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    fsrsState: "learning",
    dueDate: opts.dueDate ?? TODAY,
    lastReview: null,
    firstSeen: opts.firstSeen ?? PAST_7,
    learningStep: 0,
    stepStartedAt: Date.now() - 60_000,
    hiddenSince: null,
    seenInPasture: false,
  };
}

/** Returns a due-soon ReviewState (graduated, reps >= 1, scheduledDays < 21). */
function dueSoonState(opts: {
  dueDate?: string;
  lastReview?: string;
  firstSeen?: string;
} = {}): SeededState {
  return {
    stability: 10,
    difficulty: 5,
    elapsedDays: 4,
    scheduledDays: 5,
    reps: 2,
    lapses: 0,
    fsrsState: "review",
    dueDate: opts.dueDate ?? FUTURE_3,
    lastReview: opts.lastReview ?? PAST_7,
    firstSeen: opts.firstSeen ?? PAST_15,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  };
}

function nameCard(id: number, state: SeededState, locale = "en"): SeededNameCard {
  return {
    cardType: "name",
    id,
    locale,
    // The app's hydrateSession backfills name/spriteUrl from SEED_POKEMON on
    // load; these strings are placeholders so the persistence validator passes.
    name: `pokemon-${id}`,
    spriteUrl: `/sprites/pokemon/${id}.png`,
    subjectKey: `species:${id}`,
    state,
  };
}

function evolutionCard(preEvoId: number, postEvoId: number, edgeId: number, state: SeededState): SeededEvolutionCard {
  return {
    cardType: "evolution",
    id: edgeId,
    preEvoId,
    postEvoId,
    locale: "en",
    subjectKey: `edge:${preEvoId}:${postEvoId}`,
    state,
  };
}

// ─── Scenario builders ────────────────────────────────────────────────────────

/**
 * `fsrs-locale-mastery`
 *
 * Injects ~30 mastered name cards (locale: 'en') + ~10 due-soon cards +
 * a few in-learning cards. Sets pokemonNameLocale to 'en'.
 *
 * After applying this scenario, switching Settings > Pokémon name language
 * to Japanese should show 0 mastered cards in the Pasture immediately,
 * because the mastered cards are all locale='en' and the locale-reset rule
 * treats locale mismatches as "new".
 */
function buildFsrsLocaleMastery(): SeedPayload {
  const cards: SeededCard[] = [];

  // 30 mastered Gen-I species (en locale)
  const masteredIds = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    13, 16, 19, 25, 35, 39, 52, 54, 58, 63,
    66, 74, 79, 81, 84, 86, 90, 92, 95, 98,
  ];
  for (const id of masteredIds) {
    cards.push(
      nameCard(id, masteredState({
        dueDate: FUTURE_7,
        lastReview: PAST_7,
        firstSeen: PAST_30,
      }), "en"),
    );
  }

  // 10 due-soon (en locale)
  const dueSoonIds = [100, 102, 109, 111, 114, 115, 116, 120, 122, 124];
  for (const id of dueSoonIds) {
    cards.push(nameCard(id, dueSoonState(), "en"));
  }

  // 5 in-learning (en locale)
  const learningIds = [127, 128, 129, 130, 131];
  for (const id of learningIds) {
    cards.push(nameCard(id, learningState(), "en"));
  }

  // A handful of mastered evolution cards
  cards.push(evolutionCard(1, 2, 1500001, masteredState({ dueDate: FUTURE_21 })));
  cards.push(evolutionCard(4, 5, 1500003, masteredState({ dueDate: FUTURE_21 })));
  cards.push(evolutionCard(7, 8, 1500005, masteredState({ dueDate: FUTURE_21 })));

  return {
    session: { cards, limits: DEFAULT_LIMITS },
    pokemonNameLocale: "en",
  };
}

/**
 * `optimiser-stress`
 *
 * ~220 grades across ~20 cards (simulated via high-reps graduated states +
 * 2 single-review cards). Provides enough grade history for the FSRS
 * optimiser endpoint to compute weights instead of returning a 500.
 *
 * The grade-log is not seeded here (it lives in a separate IDB key that
 * the Settings component writes via lib/qa-seed/apply.ts). Cards with high
 * reps proxy the grade volume.
 */
function buildOptimiserStress(): SeedPayload {
  const cards: SeededCard[] = [];

  // 20 heavily-reviewed cards — each with many reps
  const stressIds = [
    1, 4, 7, 25, 39, 52, 63, 66, 74, 79,
    84, 90, 95, 100, 109, 111, 122, 127, 130, 131,
  ];

  for (let i = 0; i < stressIds.length; i++) {
    const id = stressIds[i];
    const reps = 8 + (i % 5); // 8..12 reps
    const scheduledDays = 28 + (i % 14); // 28..41 days
    cards.push(nameCard(id, {
      stability: 60,
      difficulty: 4 + (i % 3) * 0.5, // 4.0..5.0
      elapsedDays: scheduledDays,
      scheduledDays,
      reps,
      lapses: i % 4 === 0 ? 1 : 0,
      fsrsState: "review",
      dueDate: FUTURE_7,
      lastReview: PAST_7,
      firstSeen: PAST_30,
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: reps >= 4,
    }));
  }

  // 2 single-review cards (the deltaT=0 scenario that caused the #1304 500)
  cards.push(nameCard(2, {
    stability: 2,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 1,
    reps: 1,
    lapses: 0,
    fsrsState: "review",
    dueDate: TODAY,
    lastReview: TODAY,
    firstSeen: TODAY,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  }));
  cards.push(nameCard(3, {
    stability: 2,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 1,
    reps: 1,
    lapses: 0,
    fsrsState: "review",
    dueDate: TODAY,
    lastReview: TODAY,
    firstSeen: TODAY,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  }));

  return {
    session: { cards, limits: DEFAULT_LIMITS },
    pokemonNameLocale: null,
  };
}

/**
 * `pasture-progression`
 *
 * A believable mix of locked / in-progress / mastered species. This gives
 * the Pasture page a genuinely populated view without the `pretendAllMastered`
 * flag, and lets QA verify the Pasture visual layout with real data.
 *
 * Mix: 40 mastered, 20 due-soon (graduated but not yet mastered),
 * 15 in-learning, rest locked (absent from the session entirely — hydrateSession
 * adds them as new cards on next practice load).
 */
function buildPastureProgression(): SeedPayload {
  const cards: SeededCard[] = [];

  // 40 mastered Gen-I species — the Pasture should be nicely populated
  const masteredIds = [
    1, 4, 7, 10, 13, 16, 19, 21, 23, 25,
    27, 29, 32, 35, 37, 39, 41, 43, 46, 48,
    50, 52, 54, 56, 58, 60, 63, 66, 69, 72,
    74, 77, 79, 81, 83, 84, 86, 88, 90, 92,
  ];
  for (const id of masteredIds) {
    const offsetDays = ((id % 14) + 1); // vary the due-dates
    cards.push(nameCard(id, masteredState({
      dueDate: relativeDate(offsetDays),
      lastReview: relativeDate(-offsetDays),
      firstSeen: PAST_30,
    })));
  }

  // 20 graduated / due-soon (in progress, not yet mastered)
  const dueSoonIds = [
    95, 96, 98, 99, 100, 102, 104, 107, 109, 111,
    114, 115, 116, 118, 120, 122, 124, 126, 128, 130,
  ];
  for (const id of dueSoonIds) {
    cards.push(nameCard(id, dueSoonState({
      dueDate: relativeDate((id % 6) + 1),
    })));
  }

  // 15 in-learning
  const learningIds = [
    131, 133, 138, 140, 141, 142, 143, 144, 145, 146,
    147, 148, 149, 150, 151,
  ];
  for (const id of learningIds) {
    cards.push(nameCard(id, learningState()));
  }

  // A few mastered evolution cards to populate the Pasture evo column
  const masteredEdges: Array<[number, number, number]> = [
    [1, 2, 1500001],
    [2, 3, 1500002],
    [4, 5, 1500003],
    [5, 6, 1500004],
    [7, 8, 1500005],
    [8, 9, 1500006],
    [25, 26, 1500015], // Pikachu → Raichu
  ];
  for (const [preEvoId, postEvoId, edgeId] of masteredEdges) {
    cards.push(evolutionCard(preEvoId, postEvoId, edgeId, masteredState({ dueDate: FUTURE_21 })));
  }

  return {
    session: { cards, limits: DEFAULT_LIMITS },
    pokemonNameLocale: null,
  };
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const SCENARIOS: Scenario[] = [
  {
    slug: "fsrs-locale-mastery",
    label: "FSRS locale mastery",
    description:
      "30 mastered cards (locale: en) + 10 due-soon + 5 in-learning. " +
      "Switch the Pokémon name language to Japanese to verify locale-aware mastery reset.",
    build: buildFsrsLocaleMastery,
  },
  {
    slug: "optimiser-stress",
    label: "Optimiser stress",
    description:
      "20 heavily-reviewed cards + 2 single-review cards. " +
      "Run the FSRS optimiser from Settings to verify it returns weights instead of a 500 error.",
    build: buildOptimiserStress,
  },
  {
    slug: "pasture-progression",
    label: "Pasture progression",
    description:
      "40 mastered + 20 in-progress + 15 in-learning species. " +
      "Visit the Pasture to see a realistically populated view without the pretend-all-mastered flag.",
    build: buildPastureProgression,
  },
];

export const SCENARIO_BY_SLUG: Map<string, Scenario> = new Map(
  SCENARIOS.map((s) => [s.slug, s]),
);
