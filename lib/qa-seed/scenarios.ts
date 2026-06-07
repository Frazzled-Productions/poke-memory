/**
 * QA seed scenario registry.
 *
 * Each scenario is a named, deterministic data payload that gets written to
 * IndexedDB (and localStorage settings where relevant) so a fresh-visitor
 * preview can exercise data-dependent behaviour without grinding through the
 * new-card queue.
 *
 * IMPORTANT: scenario payloads are LOCAL-ONLY. They write to the same IDB
 * store that the app reads, so they are indistinguishable from real progress - 
 * but the sync write-guard on SuperuserContext suppresses all cloud writes
 * while any superuser flag is on (including qaSeedMode). Seeded data can
 * therefore never reach Supabase.
 *
 * To add a new scenario: add an entry to SCENARIOS and implement a builder
 * function that returns a SeedPayload. Keep builders pure (no side effects);
 * the save step lives in applySeedScenario.
 *
 * FAITHFULNESS RULE: all FSRS states MUST be derived by replaying real grades
 * through nextReview (lib/srs/scheduler.ts) - never hand-set FSRS literals.
 * Card identity (name, spriteUrl, id) MUST come from the real SEED_POKEMON /
 * SEED_EVOLUTION_CARDS data - never placeholders. This ensures seeded data
 * obeys the same invariants as real data (#1421).
 */

import type { ReviewState } from "@/lib/srs/scheduler";
import { initialReviewState, nextReview } from "@/lib/srs/scheduler";
import type { StreakProtection } from "@/lib/streak/tokens";
import type { AppLocale } from "@/i18n/locales";
import type { LabsFlags } from "@/lib/labs/flags";
import type { SeedPokemon, EvolutionCard } from "@/lib/pokemon/seed";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed-constants";
import { getSeedIfLoaded } from "@/lib/pokemon/seed-async";

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

/**
 * Minimal reverse-card shape accepted by lib/review/persistence.ts parseSession.
 *
 * The validator requires `name` and `spriteUrl` (same as name cards). `pokemonId`
 * must be the original species ID; `id` must be REVERSE_ID_OFFSET (2_000_000) +
 * pokemonId. hydrateSession then backfills all SeedPokemon fields on load.
 */
type SeededReverseCard = {
  cardType: "reverse";
  id: number;        // REVERSE_ID_OFFSET + pokemonId
  pokemonId: number; // original species ID
  locale: string;
  name: string;
  spriteUrl: string;
  subjectKey: string;
  state: SeededState;
};

type SeededCard = SeededNameCard | SeededEvolutionCard | SeededReverseCard;

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
  /**
   * Enrolled learning locales to write into settings (#1562). Lets a scenario
   * stage a multi-language state so the language switcher shows more than one
   * option and per-locale practice can be exercised. Omit to leave untouched.
   */
  learningLocales?: AppLocale[];
  /**
   * Active Pokémon-name locale to write into settings (#1562). Defaults via the
   * `pokemonNameLocale` mirror when omitted; set explicitly to start a scenario
   * in a specific language. Omit to leave untouched.
   */
  activePokemonNameLocale?: AppLocale;
  /**
   * Consecutive review days, ending today, to seed into streak storage.
   * Omit (or 0) to leave streak storage untouched. applySeedScenario expands
   * this into the actual "YYYY-MM-DD" date array relative to today.
   */
  streakDays?: number;
  /**
   * Streak-protection state (token balance + history) to merge into settings.
   * Omit to leave the user's existing protection state untouched.
   */
  streakProtection?: StreakProtection;
  /**
   * Per-locale mastered-species count to warm the `KEY_MASTERED_COUNT_BY_LOCALE`
   * cache that `useProfileStatus` reads. Without this the ProfileStatusBar shows
   * 0 mastered on non-Practice pages until ReviewSession (Practice) warms the
   * cache. Must equal `filterMastered(...).length` for the seeded cards - the
   * parity test in scenarios.test.ts enforces that.
   */
  masteredCountByLocale?: Partial<Record<AppLocale, number>>;
  /**
   * Labs flags to merge into settings when the scenario is applied (#1562).
   * Use this to enable preview features (e.g. `languages: true`) so the
   * scenario can exercise gated surfaces without requiring the user to
   * manually enable them in Settings > Labs. Omit to leave untouched.
   */
  labsFlags?: Partial<LabsFlags>;
};

export type Scenario = {
  slug: string;
  label: string;
  description: string;
  build: () => SeedPayload;
};

// ─── Deterministic time anchors ───────────────────────────────────────────────

/**
 * Fixed epoch for grade replays. NEVER use Date.now() inside a replay loop.
 * Using a fixed past date keeps scenarios deterministic across runs.
 */
const T0 = new Date("2025-01-01T00:00:00Z");

/**
 * Returns a Date that is `days` days after T0.
 * Used to pass `now` to nextReview calls in the replay sequence.
 */
function T(days: number): Date {
  return new Date(T0.getTime() + days * 86_400_000);
}

/**
 * Returns an ISO "YYYY-MM-DD" date string offset from today by `days` days.
 * Positive = future (scheduled ahead), negative = past (overdue).
 * Used only POST-replay to anchor due-dates relative to wall-clock "today",
 * NOT inside the grade replay loops.
 */
function relativeDate(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

// ─── Real-data lookups ────────────────────────────────────────────────────────

// The seed data is fetched at runtime (Stage 3, #1677) rather than bundled, so
// these lookups are built lazily from the loaded snapshot on first use. Callers
// (scenario `build()` functions) must ensure the seed has loaded first - the
// QaSeedSection awaits `loadSeed()` before applying a scenario.
let _seedById: Map<number, SeedPokemon> | null = null;
let _evoByEndpoints: Map<string, EvolutionCard> | null = null;

function requireSeed() {
  const seed = getSeedIfLoaded();
  if (seed === null) {
    throw new Error(
      "QA seed scenarios require the Pokémon seed to be loaded first (call loadSeed()).",
    );
  }
  return seed;
}

/** Map of pokemonId → SeedPokemon for O(1) lookups. */
function seedById(): Map<number, SeedPokemon> {
  if (_seedById === null) {
    _seedById = new Map(requireSeed().seedPokemon.map((p) => [p.id, p]));
  }
  return _seedById;
}

/** Map of (preEvoId, postEvoId) → EvolutionCard to look up edges by endpoint IDs. */
function evoByEndpoints(): Map<string, EvolutionCard> {
  if (_evoByEndpoints === null) {
    _evoByEndpoints = new Map(
      requireSeed().seedEvolutionCards.map((e) => [
        `${e.preEvoId}:${e.postEvoId}`,
        e,
      ]),
    );
  }
  return _evoByEndpoints;
}

// ─── Grade-replay helpers ─────────────────────────────────────────────────────

/**
 * Derives a MASTERED ReviewState by replaying three Easy grades through the
 * real scheduler. Three Easy grades on T0, T(5), and T(20) give:
 *   reps=3, scheduledDays>=21, fsrsState="review"
 *
 * srs-expert prescription:
 *   s = initialReviewState(T0)
 *   s = nextReview(s, 5, T0)     // A2: Easy on brand-new → graduate via FSRS
 *   s = nextReview(s, 5, T(5))   // A4: graduated + Easy → FSRS update, reps=2
 *   s = nextReview(s, 5, T(20))  // A4: reps=3, scheduledDays>=21
 *
 * Post-replay: override dueDate and lastReview to anchors relative to today so
 * the card appears in the correct queue bucket when the scenario is applied.
 * firstSeen is kept at T0's date (a historical timestamp).
 */
function deriveMasteredState(opts: {
  /** Days from today to set the due date (positive = future, 0 = today). Default: +7 */
  dueDaysFromNow?: number;
  /** Days from today to set lastReview (negative = past). Default: -7 */
  lastReviewDaysFromNow?: number;
} = {}): SeededState {
  let s = initialReviewState(T0);
  s = nextReview(s, 5, T0);
  s = nextReview(s, 5, T(5));
  s = nextReview(s, 5, T(20));

  // Post-replay: shift due-date and lastReview to wall-clock anchors so the
  // card appears in the correct queue bucket when the scenario is applied.
  // firstSeen remains the historical T0 date - it is set during the first replay.
  const dueDate = relativeDate(opts.dueDaysFromNow ?? 7);
  const lastReview = relativeDate(opts.lastReviewDaysFromNow ?? -7);

  return {
    ...s,
    dueDate,
    lastReview,
    seenInPasture: true,
  };
}

/**
 * Derives a DUE-SOON ReviewState by replaying three Good grades (to graduate)
 * then one more Good at T(2) through the real scheduler.
 *
 * srs-expert prescription:
 *   s = initialReviewState(T0)
 *   s = nextReview(s, 4, T0)   // A1: enters learning step 0
 *   s = nextReview(s, 4, T0)   // B3: advances to step 1
 *   s = nextReview(s, 4, T0)   // B3 graduate: scheduledDays=1, reps=1
 *   s = nextReview(s, 4, T(2)) // A4: reps=2, scheduledDays=11 (real FSRS output; in [1,21))
 *
 * Results in: reps>=1, scheduledDays in [1,21), fsrsState="review".
 * Post-replay: override dueDate/lastReview to wall-clock anchors.
 */
function deriveDueSoonState(opts: {
  /** Days from today to set the due date. Default: +3 */
  dueDaysFromNow?: number;
} = {}): SeededState {
  let s = initialReviewState(T0);
  s = nextReview(s, 4, T0);   // enter learning
  s = nextReview(s, 4, T0);   // advance step
  s = nextReview(s, 4, T0);   // graduate
  s = nextReview(s, 4, T(2)); // first scheduled review

  const dueDate = relativeDate(opts.dueDaysFromNow ?? 3);
  const lastReview = relativeDate(-4);

  return {
    ...s,
    dueDate,
    lastReview,
  };
}

/**
 * Derives an IN-LEARNING ReviewState by replaying a single Again grade through
 * the real scheduler.
 *
 * srs-expert prescription:
 *   s = initialReviewState(T0)
 *   s = nextReview(s, 1, T0)  // A1: learningStep=0, reps=0, scheduledDays=0
 *
 * Keep lastReview=null (new-card learning vs relearning).
 * Post-replay: override stepStartedAt so the step timer is live on load.
 * firstSeen is set during the replay from T0's date.
 */
function deriveLearningState(): SeededState {
  let s = initialReviewState(T0);
  s = nextReview(s, 1, T0); // A1: enter step 0

  // Override stepStartedAt post-replay so the step countdown is live.
  // This is the ONLY legitimate use of Date.now() in seed scenarios.
  return {
    ...s,
    stepStartedAt: Date.now() - 60_000,
  };
}

/**
 * Derives a "graduated but not yet mastered" ReviewState by replaying
 * several Good grades. Produces reps>=1, scheduledDays in [1,21).
 * A variant of deriveDueSoonState that takes an explicit reps count and
 * scheduled days target for fine-grained control.
 *
 * Replay: 3 Good grades to graduate, then `extraGoodGrades` additional
 * Good reviews at sequential days. Results in reps = 1 + extraGoodGrades.
 */
function deriveGraduatedState(opts: {
  extraGoodGrades?: number;
  dueDaysFromNow?: number;
  lastReviewDaysFromNow?: number;
} = {}): SeededState {
  const extraGrades = opts.extraGoodGrades ?? 1;
  let s = initialReviewState(T0);
  s = nextReview(s, 4, T0);  // enter learning
  s = nextReview(s, 4, T0);  // advance step
  s = nextReview(s, 4, T0);  // graduate, reps=1

  for (let i = 0; i < extraGrades; i++) {
    // Each review a few days after the previous - picks up consecutive reps.
    s = nextReview(s, 4, T(2 + i * 5));
  }

  const dueDate = relativeDate(opts.dueDaysFromNow ?? s.scheduledDays);
  const lastReview = relativeDate(opts.lastReviewDaysFromNow ?? -s.scheduledDays);

  return {
    ...s,
    dueDate,
    lastReview,
  };
}

/**
 * Derives a high-reps ReviewState by replaying `reps` Easy grades through the
 * scheduler. Used for the optimiser-stress scenario which needs many review
 * entries per card. reps=1 is just one Easy on a fresh card.
 */
function deriveHighRepsState(reps: number, scheduledDayOffset = 0): SeededState {
  let s = initialReviewState(T0);
  // First Easy from fresh state graduates immediately.
  s = nextReview(s, 5, T0);
  // Subsequent Easy grades at increasing day offsets.
  for (let i = 1; i < reps; i++) {
    s = nextReview(s, 5, T(i * 10));
  }

  const dueDate = relativeDate(7 + scheduledDayOffset);
  const lastReview = relativeDate(-7);

  return {
    ...s,
    dueDate,
    lastReview,
    seenInPasture: reps >= 4,
  };
}

// ─── Card factories ───────────────────────────────────────────────────────────

const DEFAULT_LIMITS: DailyLimits = {
  name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  evolution: { maxNewPerDay: 5, maxReviewsPerDay: 100 },
  reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
};

// ─── Believable streak + protection-token state ────────────────────────────────

/**
 * Consecutive review days seeded for the "populated" mastery scenarios. A run
 * of 34 days alone earns one protection token (EARN_INTERVAL_DAYS = 30), and
 * the months-old card history (firstSeen T0) makes a standing balance of 2
 * faithful - so the seeded streak and token balance are internally consistent
 * with real data, not a state real usage could not reach (#1421 faithfulness).
 */
const BELIEVABLE_STREAK_DAYS = 34;

/**
 * A faithful streak-protection state for an active, months-old learner: two
 * tokens earned over the account's life, none spent, partway toward the next.
 * Seeded alongside `BELIEVABLE_STREAK_DAYS` so the profile status bar renders
 * a fully populated streak / token / mastery trio when a scenario is applied.
 *
 * Before this, applied scenarios left streak at 0 and tokens at 0, so the
 * token chip was unreachable in-app for QA without hand-editing localStorage.
 */
function believableStreakProtection(): StreakProtection {
  return {
    balance: 2,
    spendDates: [],
    daysSinceLastEarn: 12,
    // Today, so the once-per-day earn increment is already accounted for and
    // mounting StreakBadge does not mutate the seeded counter.
    lastEarnCheckDate: relativeDate(0),
    protectionEvents: [
      { date: relativeDate(-80), kind: "earned" },
      { date: relativeDate(-44), kind: "earned" },
    ],
    lastAcknowledgedProtectionEventDate: null,
  };
}

/**
 * Builds a name card from real SEED_POKEMON data.
 * name and spriteUrl come from the actual seed - no placeholders.
 */
function nameCard(id: number, state: SeededState, locale = "en"): SeededNameCard {
  const pokemon = seedById().get(id);
  if (!pokemon) {
    throw new Error(`QA seed: no SeedPokemon found for id=${id}`);
  }
  return {
    cardType: "name",
    id,
    locale,
    name: pokemon.displayName,
    spriteUrl: pokemon.spriteUrl,
    subjectKey: `species:${id}`,
    state,
  };
}

/**
 * Builds a reverse card from real SEED_POKEMON data.
 * id = REVERSE_ID_OFFSET + pokemonId - matching hydrateSession.
 * name/spriteUrl come from the actual seed; hydrateSession also backfills
 * all SeedPokemon fields on load.
 *
 * Since #1234, the Pasture requires BOTH the name card AND the paired reverse
 * card to be mastered before a species appears.
 */
function reverseCard(id: number, state: SeededState, locale = "en"): SeededReverseCard {
  const pokemon = seedById().get(id);
  if (!pokemon) {
    throw new Error(`QA seed: no SeedPokemon found for id=${id}`);
  }
  return {
    cardType: "reverse",
    id: REVERSE_ID_OFFSET + id,
    pokemonId: id,
    locale,
    name: pokemon.displayName,
    spriteUrl: pokemon.spriteUrl,
    subjectKey: `species:${id}`,
    state,
  };
}

/**
 * Builds an evolution card from real SEED_EVOLUTION_CARDS data.
 * Looks up the edge by (preEvoId, postEvoId) so the edgeId matches the real seed.
 */
function evolutionCard(preEvoId: number, postEvoId: number, state: SeededState): SeededEvolutionCard {
  const edge = evoByEndpoints().get(`${preEvoId}:${postEvoId}`);
  if (!edge) {
    throw new Error(`QA seed: no evolution edge found for ${preEvoId}→${postEvoId}`);
  }
  return {
    cardType: "evolution",
    id: edge.id,
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
 * Injects ~30 mastered name cards (locale: 'en') + ~10 due-soon + a few
 * in-learning, PLUS a smaller independent Japanese set (locale: 'ja'), and
 * enrols both languages (`learningLocales: ['en', 'ja']`). Starts in English
 * (`activePokemonNameLocale: 'en'`).
 *
 * This stages the multi-language practice state (#1562): the language switcher
 * in the status bar shows English + 日本語, and switching to Japanese reveals a
 * SEPARATE, smaller mastered set with its own due/new queue - proving FSRS
 * progress is tracked per `(id, locale)`. The en and ja cards for the same
 * species (e.g. 1, 4, 7, 25, 39) coexist without colliding because the session
 * now filters by the active locale (#1562 fixed the #1394 id-collision class).
 */
function buildFsrsLocaleMastery(): SeedPayload {
  const cards: SeededCard[] = [];

  // 30 mastered Gen-I species (en locale).
  // Since #1234, the Pasture requires both name AND reverse mastered - seed both.
  const masteredIds = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    13, 16, 19, 25, 35, 39, 52, 54, 58, 63,
    66, 74, 79, 81, 84, 86, 90, 92, 95, 98,
  ];
  for (const id of masteredIds) {
    const state = deriveMasteredState({
      dueDaysFromNow: 7,
      lastReviewDaysFromNow: -7,
    });
    cards.push(nameCard(id, state, "en"));
    cards.push(reverseCard(id, state, "en"));
  }

  // 10 due-soon (en locale)
  const dueSoonIds = [100, 102, 109, 111, 114, 115, 116, 120, 122, 124];
  for (const id of dueSoonIds) {
    cards.push(nameCard(id, deriveDueSoonState(), "en"));
  }

  // 5 in-learning (en locale)
  const learningIds = [127, 128, 129, 130, 131];
  for (const id of learningIds) {
    cards.push(nameCard(id, deriveLearningState(), "en"));
  }

  // A handful of mastered evolution cards
  cards.push(evolutionCard(1, 2, deriveMasteredState({ dueDaysFromNow: 21 })));
  cards.push(evolutionCard(4, 5, deriveMasteredState({ dueDaysFromNow: 21 })));
  cards.push(evolutionCard(7, 8, deriveMasteredState({ dueDaysFromNow: 21 })));

  // Independent Japanese set (#1562). Smaller than the English set so the
  // per-locale difference is obvious when switching languages. Same species ids
  // as part of the en set, but locale 'ja' → a separate FSRS row each.
  // 5 mastered (name + reverse, matching the #1234 Pasture rule).
  const jaMasteredIds = [1, 4, 7, 25, 39];
  for (const id of jaMasteredIds) {
    const state = deriveMasteredState({
      dueDaysFromNow: 5,
      lastReviewDaysFromNow: -5,
    });
    cards.push(nameCard(id, state, "ja"));
    cards.push(reverseCard(id, state, "ja"));
  }
  // 5 due-soon (ja locale) so a Japanese practice session is non-empty.
  const jaDueSoonIds = [43, 52, 63, 66, 74];
  for (const id of jaDueSoonIds) {
    cards.push(nameCard(id, deriveDueSoonState(), "ja"));
  }

  return {
    session: { cards, limits: DEFAULT_LIMITS },
    pokemonNameLocale: "en",
    learningLocales: ["en", "ja"],
    activePokemonNameLocale: "en",
    streakDays: BELIEVABLE_STREAK_DAYS,
    streakProtection: believableStreakProtection(),
    // Both name + reverse mastered for each id → filterMastered counts them all.
    masteredCountByLocale: { en: masteredIds.length, ja: jaMasteredIds.length },
  };
}

/**
 * `optimiser-stress`
 *
 * ~220 grades across ~20 cards (derived via high-reps graduated states +
 * 2 single-review cards). Provides enough grade history for the FSRS
 * optimiser endpoint to compute weights instead of returning a 500.
 *
 * The grade-log is not seeded here (it lives in a separate IDB key that
 * the Settings component writes via lib/qa-seed/apply.ts). Cards with high
 * reps proxy the grade volume.
 */
function buildOptimiserStress(): SeedPayload {
  const cards: SeededCard[] = [];

  // 20 heavily-reviewed cards - each with many reps derived from real grades.
  const stressIds = [
    1, 4, 7, 25, 39, 52, 63, 66, 74, 79,
    84, 90, 95, 100, 109, 111, 122, 127, 130, 131,
  ];

  for (let i = 0; i < stressIds.length; i++) {
    const id = stressIds[i];
    const reps = 8 + (i % 5); // 8..12 reps
    cards.push(nameCard(id, deriveHighRepsState(reps, i % 14)));
  }

  // 2 single-review cards (reps=1: one Easy from a fresh card).
  // These cards have a dueDate 7 days from now and lastReview 7 days ago (deltaT=7),
  // so they are not a deltaT=0 edge case. They provide minimal-history data points
  // alongside the high-reps set to stress the optimiser endpoint.
  cards.push(nameCard(2, deriveHighRepsState(1)));
  cards.push(nameCard(3, deriveHighRepsState(1)));

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
 * Mix: 40 mastered (en), 20 due-soon, 15 in-learning, rest locked (absent
 * from the session - hydrateSession adds them as new cards on next practice
 * load).
 *
 * Sets `pokemonNameLocale: "en"` so the 40 en-locale mastered cards show
 * correctly. Switching to Japanese in Settings shows 0 mastered (the en cards
 * do not match the ja locale) - demonstrating that mastery is stored per
 * locale (the per-locale FSRS rows introduced in #1259). We do NOT seed
 * ja-locale duplicates of the same species: the local review session keys
 * cards by numeric `id`, so an en+ja pair for one species collides and breaks
 * Practice (#1394 mini-batch regression).
 *
 * The Gen-I species used (IDs 1–92) all have non-null PokéAPI habitats, so
 * the Pasture spreads across multiple biomes (grassland, forest, mountain,
 * waters-edge, etc.) instead of everything landing in Wildlands.
 */
function buildPastureProgression(): SeedPayload {
  const cards: SeededCard[] = [];

  // 40 mastered Gen-I species (locale: en) - spreads across multiple biomes.
  // Since #1234, the Pasture requires both name AND reverse mastered - seed both.
  const masteredIds = [
    1, 4, 7, 10, 13, 16, 19, 21, 23, 25,
    27, 29, 32, 35, 37, 39, 41, 43, 46, 48,
    50, 52, 54, 56, 58, 60, 63, 66, 69, 72,
    74, 77, 79, 81, 83, 84, 86, 88, 90, 92,
  ];
  for (const id of masteredIds) {
    const offsetDays = ((id % 14) + 1); // vary the due-dates
    const state = deriveMasteredState({
      dueDaysFromNow: offsetDays,
      lastReviewDaysFromNow: -offsetDays,
    });
    cards.push(nameCard(id, state, "en"));
    cards.push(reverseCard(id, state, "en"));
  }

  // NOTE: this scenario stays deliberately single-locale (en only) to give a
  // clean "switch to Japanese → 0 mastered" demonstration of per-locale storage
  // (#1259). Multi-locale coexistence (en + ja for one species) is exercised by
  // the `fsrs-locale-mastery` scenario instead, which is safe since #1562 made
  // the review session filter by active locale (closing the #1394 id-collision
  // class). Keeping the two demos separate keeps each one's assertion crisp.

  // Convergence-priority slab (#1764): species with one advanced leg and one new
  // candidate leg. These exercise the queue-bias that introduces the missing leg
  // first when a species is already partway there, so desynced accounts converge.
  //
  // 10 species with name card advanced (graduated), reverse card absent (new candidate).
  // 5 species with reverse card advanced (graduated), name card absent (new candidate).
  // IDs in Gen II (152+) to avoid collision with the Gen-I masteredIds above.
  const desyncedNameAdvancedIds = [152, 155, 158, 161, 164, 167, 170, 175, 180, 185];
  for (const id of desyncedNameAdvancedIds) {
    // Name is graduated/advanced; reverse is deliberately NOT seeded (new candidate).
    cards.push(nameCard(id, deriveDueSoonState({ dueDaysFromNow: 3 + (id % 5) }), "en"));
  }

  const desyncedReverseAdvancedIds = [190, 193, 196, 199, 200];
  for (const id of desyncedReverseAdvancedIds) {
    // Reverse is graduated/advanced; name card is new (never reviewed) representing
    // a species where the user learnt the reverse leg first. The name card must be
    // present to satisfy the pairing invariant (#1234) even though it is locked.
    cards.push(reverseCard(id, deriveDueSoonState({ dueDaysFromNow: 2 + (id % 4) }), "en"));
    cards.push(nameCard(id, initialReviewState(T0), "en"));
  }

  // 20 graduated / due-soon (in progress, not yet mastered)
  const dueSoonIds = [
    95, 96, 98, 99, 100, 102, 104, 107, 109, 111,
    114, 115, 116, 118, 120, 122, 124, 126, 128, 130,
  ];
  for (const id of dueSoonIds) {
    cards.push(nameCard(id, deriveDueSoonState({
      dueDaysFromNow: (id % 6) + 1,
    })));
  }

  // 15 in-learning
  const learningIds = [
    131, 133, 138, 140, 141, 142, 143, 144, 145, 146,
    147, 148, 149, 150, 151,
  ];
  for (const id of learningIds) {
    cards.push(nameCard(id, deriveLearningState()));
  }

  // A few mastered evolution cards to populate the Pasture evo column
  const masteredEdges: Array<[number, number]> = [
    [1, 2],
    [2, 3],
    [4, 5],
    [5, 6],
    [7, 8],
    [8, 9],
    [25, 26], // Pikachu → Raichu
  ];
  for (const [preEvoId, postEvoId] of masteredEdges) {
    cards.push(evolutionCard(preEvoId, postEvoId, deriveMasteredState({ dueDaysFromNow: 21 })));
  }

  return {
    session: { cards, limits: DEFAULT_LIMITS },
    // Set en so the 40 en-locale mastered cards show by default. Switch to
    // Japanese in Settings > Pokémon name language to see 0 mastered (the en
    // cards do not match the ja locale) - confirming per-locale FSRS storage
    // (#1259).
    pokemonNameLocale: "en",
    streakDays: BELIEVABLE_STREAK_DAYS,
    streakProtection: believableStreakProtection(),
    // 40 species with both name + reverse mastered → filterMastered counts 40.
    masteredCountByLocale: { en: masteredIds.length },
  };
}

/**
 * `mastery-gaps`
 *
 * Exercises two features that need specific in-between states:
 *
 * (a) "Next arrivals" strip on the Pasture (#1316): requires reviewed-but-unmastered
 *     name cards - i.e. name cards that have been seen at least once but have not
 *     yet reached stability >= MASTERY_STABILITY_DAYS. The strip ranks them by
 *     closest to mastery so QA can confirm real species appear rather than the
 *     "all reviewed Pokémon already in your Pasture" empty state.
 *
 * (b) "Close to mastery" on Journey (#1312): requires species where the NAME card
 *     IS mastered (stability >= MASTERY_STABILITY_DAYS) but the matched REVERSE card
 *     has NOT yet reached that bar. Without this shape the list is empty.
 *
 * Mix:
 * - 15 fully mastered pairs (name + reverse both mastered) → Pasture is populated
 * - 10 "name mastered, reverse near-miss" pairs → Close to mastery list
 *   - 5 with a partially-reviewed reverse (scheduledDays 5–15)
 *   - 5 with an unseen reverse (no reps yet)
 * - 10 reviewed-but-unmastered name-only cards (reps 1–2, scheduledDays 5–10) → Next arrivals
 * - 5 in-learning name-only cards → new queue
 */
function buildMasteryGaps(): SeedPayload {
  const cards: SeededCard[] = [];

  // ── (1) 15 fully mastered pairs (Pasture is visibly populated) ──────────────
  const fullMasteredIds = [
    1, 4, 7, 10, 13, 16, 19, 23, 25, 27,
    29, 32, 35, 37, 39,
  ];
  for (const id of fullMasteredIds) {
    const offsetDays = ((id % 7) + 1);
    const state = deriveMasteredState({
      dueDaysFromNow: offsetDays,
      lastReviewDaysFromNow: -offsetDays,
    });
    cards.push(nameCard(id, state));
    cards.push(reverseCard(id, state));
  }

  // ── (2) 10 "name mastered, reverse not" pairs → Close to mastery ────────────
  //
  // Five with a partially-reviewed reverse card (shows progress bar > 0):
  const nearMissPartialIds = [41, 43, 46, 48, 50];
  for (const id of nearMissPartialIds) {
    // Name card: fully mastered.
    cards.push(nameCard(id, deriveMasteredState()));
    // Reverse card: graduated but deliberately below the mastery gate. Cap the
    // replay at a single extra Good review so reps stays at 2 (< MASTERY_REPETITIONS
    // = 3); this keeps the reverse un-mastered regardless of its scheduledDays, so
    // the pair stays in the Close-to-mastery list instead of graduating into the
    // fully-mastered pool. (Two extra Goods would reach reps=3, scheduledDays=30,
    // which crosses the gate and silently drops the pair from the list. See the
    // #1421 review.) Display variety still comes from the per-id dueDate anchors.
    cards.push(reverseCard(id, deriveGraduatedState({
      extraGoodGrades: 1,
      dueDaysFromNow: 5 + (id % 11),
      lastReviewDaysFromNow: -(5 + (id % 11)),
    })));
  }

  // Five with an unseen reverse card (no reverse seeded at all - it is "new"):
  const nearMissUnseenIds = [52, 54, 56, 58, 60];
  for (const id of nearMissUnseenIds) {
    // Name card: fully mastered.
    cards.push(nameCard(id, deriveMasteredState()));
    // No reverse card seeded - hydrateSession treats it as new, and
    // deriveCloseToMastery reports reverseIntroduced: false for the row.
  }

  // ── (3) 10 reviewed-but-unmastered name cards → Next arrivals strip ─────────
  //
  // These are name-only cards (no reverse seeded), so they satisfy nextArrivals:
  // - firstSeen is set (seen at least once)
  // - NOT mastered (reps < 3 or scheduledDays < 21)
  // - reverse is NOT mastered (no reverse card at all)
  const nextArrivalsIds = [63, 66, 69, 72, 74, 77, 79, 81, 83, 84];
  for (let i = 0; i < nextArrivalsIds.length; i++) {
    const id = nextArrivalsIds[i];
    // Vary reps and scheduledDays so the strip shows a ranked list, not all ties.
    const extraGrades = i % 2; // 0 or 1 extra grade (reps=1 or reps=2)
    cards.push(nameCard(id, deriveGraduatedState({
      extraGoodGrades: extraGrades,
      dueDaysFromNow: 3 + (i % 8),
      lastReviewDaysFromNow: -(3 + (i % 8)),
    })));
  }

  // ── (4) 5 in-learning name cards ─────────────────────────────────────────────
  const learningIds = [86, 88, 90, 92, 95];
  for (const id of learningIds) {
    cards.push(nameCard(id, deriveLearningState()));
  }

  return {
    session: { cards, limits: DEFAULT_LIMITS },
    // Set en so the mastered cards match the default locale; switching to
    // Japanese in Settings shows 0 mastered, confirming per-locale FSRS storage.
    pokemonNameLocale: "en",
    streakDays: BELIEVABLE_STREAK_DAYS,
    streakProtection: believableStreakProtection(),
    // 15 fully mastered (name + reverse) pairs; the near-miss pairs have an
    // un-mastered reverse so filterMastered excludes them.
    masteredCountByLocale: { en: fullMasteredIds.length },
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
      "40 mastered (en) + 20 in-progress + 15 in-learning species. " +
      "Visit the Pasture to see multiple biomes populated. Switch Pokémon name language to Japanese " +
      "to see 0 mastered, confirming per-locale FSRS storage.",
    build: buildPastureProgression,
  },
  {
    slug: "mastery-gaps",
    label: "Mastery gaps",
    description:
      "15 fully mastered pairs (en), 10 name-mastered/reverse-pending pairs, " +
      "10 reviewed-but-unmastered names, and 5 in-learning. " +
      "Visit Pasture to verify the Next arrivals strip, and Journey to verify Close to mastery. " +
      "Switch to Japanese to see 0 mastered, confirming per-locale FSRS storage.",
    build: buildMasteryGaps,
  },
];

export const SCENARIO_BY_SLUG: Map<string, Scenario> = new Map(
  SCENARIOS.map((s) => [s.slug, s]),
);

