/**
 * Cloud-seed dataset builders for QA.
 *
 * Each exported function returns a CloudDataset that the runner
 * (scripts/qa-seed-cloud.ts) pushes to the QA Supabase project via the
 * service-role client.
 *
 * FAITHFULNESS RULES (mirrors lib/qa-seed/scenarios.ts):
 *   - All FSRS states MUST be derived by replaying real grades through
 *     nextReview (lib/srs/scheduler.ts). Never hand-set FSRS literals.
 *   - Card identity (displayName, spriteUrl, ids) MUST come from the real
 *     SEED_POKEMON / SEED_EVOLUTION_CARDS data. Never use placeholders.
 *   - Rows must satisfy card_reviews_reject_regression_trigger on clean insert:
 *       first_seen and last_review must be non-null for graduated cards,
 *       fsrs_state must be reachable, reps/lapses must be monotonically valid.
 *
 * SAFETY: No Supabase calls here. Pure data construction only.
 */

import { initialReviewState, nextReview } from "@/lib/srs/scheduler";
import type { ReviewState } from "@/lib/srs/scheduler";
import { SEED_POKEMON, SEED_EVOLUTION_CARDS } from "@/lib/pokemon/seed";
import { Subject, appTypeToDbType } from "@/lib/cards/subjectKey";
import type { UserSettings } from "@/lib/settings/persistence";

// ---------------------------------------------------------------------------
// Cloud row types (matches card_reviews schema post migration 029)
// ---------------------------------------------------------------------------

export type CloudCardRow = {
  card_type: string;
  subject_key: string;
  locale: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  fsrs_state: "new" | "learning" | "review" | "relearning";
  due_date: string;
  last_review: string | null;
  first_seen: string | null;
  hidden_since: string | null;
  seen_in_pasture: boolean;
};

export type StreakDayRow = {
  review_date: string;
};

export type GradeLogRow = {
  occurred_at: number;
  entry_date: string;
  card_type: string;
  grade: number;
  subject_key: string | null;
  locale: string;
  learning_step: number | null;
  step_started_at: number | null;
};

export type CloudDataset = {
  /** Human-readable description of what this dataset exercises. */
  description: string;
  /** card_reviews rows to upsert (user_id injected by runner). */
  cardRows: CloudCardRow[];
  /** streak_days rows to upsert (user_id injected by runner). May be empty. */
  streakRows: StreakDayRow[];
  /** grade_log rows to upsert (user_id injected by runner). May be empty. */
  gradeLogRows: GradeLogRow[];
  /** user_settings JSONB patch to push via merge_user_settings. May be empty. */
  settingsPatch: Partial<UserSettings>;
};

// ---------------------------------------------------------------------------
// Deterministic time anchors (matches lib/qa-seed/scenarios.ts convention)
// ---------------------------------------------------------------------------

/** Fixed epoch for grade replays. Never use Date.now() inside replay loops. */
const T0 = new Date("2025-01-01T00:00:00Z");

function T(days: number): Date {
  return new Date(T0.getTime() + days * 86_400_000);
}

/** Returns "YYYY-MM-DD" for a Date in UTC. */
function isoDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Returns an ISO "YYYY-MM-DD" date string offset from today by `days`.
 * Used POST-replay to anchor due-dates relative to wall-clock "today".
 * NOT used inside replay loops.
 */
function relativeDate(days: number): string {
  return isoDateStr(new Date(Date.now() + days * 86_400_000));
}

// ---------------------------------------------------------------------------
// Grade-replay helpers (mirrors lib/qa-seed/scenarios.ts)
// ---------------------------------------------------------------------------

function deriveMasteredState(opts: {
  dueDaysFromNow?: number;
  lastReviewDaysFromNow?: number;
} = {}): ReviewState {
  let s = initialReviewState(T0);
  s = nextReview(s, 5, T0);
  s = nextReview(s, 5, T(5));
  s = nextReview(s, 5, T(20));

  return {
    ...s,
    dueDate: relativeDate(opts.dueDaysFromNow ?? 7),
    lastReview: relativeDate(opts.lastReviewDaysFromNow ?? -7),
    seenInPasture: true,
  };
}

function deriveDueSoonState(dueDaysFromNow = 3): ReviewState {
  let s = initialReviewState(T0);
  s = nextReview(s, 4, T0);
  s = nextReview(s, 4, T0);
  s = nextReview(s, 4, T0);
  s = nextReview(s, 4, T(2));

  return {
    ...s,
    dueDate: relativeDate(dueDaysFromNow),
    lastReview: relativeDate(-4),
  };
}

function deriveHighRepsState(reps: number): ReviewState {
  let s = initialReviewState(T0);
  s = nextReview(s, 5, T0);
  for (let i = 1; i < reps; i++) {
    s = nextReview(s, 5, T(i * 10));
  }
  return {
    ...s,
    dueDate: relativeDate(7),
    lastReview: relativeDate(-7),
    seenInPasture: reps >= 4,
  };
}

// ---------------------------------------------------------------------------
// Row factory helpers
// ---------------------------------------------------------------------------

const SEED_BY_ID = new Map(SEED_POKEMON.map((p) => [p.id, p]));
const EVO_BY_ENDPOINTS = new Map(
  SEED_EVOLUTION_CARDS.map((e) => [`${e.preEvoId}:${e.postEvoId}`, e]),
);

function stateToRow(
  state: ReviewState,
  cardType: "name" | "reverse" | "cry" | "evolution" | "reverse-evolution",
  subjectKey: string,
  locale: string,
): CloudCardRow {
  // The regression trigger requires:
  //   - graduated cards: first_seen != null && last_review != null
  //   - in-step cards (learningStep !== null): first_seen can differ
  // The cloud seeder only upserts graduated (sync-safe) cards to avoid
  // trigger rejection. In-step / learning-step cards are excluded.
  return {
    card_type: appTypeToDbType(cardType),
    subject_key: subjectKey,
    locale,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsedDays,
    scheduled_days: state.scheduledDays,
    reps: state.reps,
    lapses: state.lapses,
    fsrs_state: state.fsrsState,
    due_date: state.dueDate,
    last_review: state.lastReview,
    first_seen: state.firstSeen,
    hidden_since: state.hiddenSince,
    seen_in_pasture: state.seenInPasture,
  };
}

function nameRow(speciesId: number, state: ReviewState, locale = "en"): CloudCardRow {
  if (!SEED_BY_ID.has(speciesId)) {
    throw new Error(`qa-seed: no SeedPokemon for id=${speciesId}`);
  }
  return stateToRow(state, "name", Subject.forSpecies(speciesId), locale);
}

function reverseRow(speciesId: number, state: ReviewState, locale = "en"): CloudCardRow {
  if (!SEED_BY_ID.has(speciesId)) {
    throw new Error(`qa-seed: no SeedPokemon for id=${speciesId}`);
  }
  return stateToRow(state, "reverse", Subject.forSpecies(speciesId), locale);
}

function evoRow(preEvoId: number, postEvoId: number, state: ReviewState, locale = "en"): CloudCardRow {
  const key = `${preEvoId}:${postEvoId}`;
  if (!EVO_BY_ENDPOINTS.has(key)) {
    throw new Error(`qa-seed: no evolution edge for ${preEvoId}→${postEvoId}`);
  }
  return stateToRow(state, "evolution", Subject.forEdge(preEvoId, postEvoId), locale);
}

/** Build consecutive review-date strings ending today. */
function buildStreakRows(days: number): StreakDayRow[] {
  const rows: StreakDayRow[] = [];
  for (let i = days - 1; i >= 0; i--) {
    rows.push({ review_date: relativeDate(-i) });
  }
  return rows;
}

/** Build a grade-log entry (occurred_at is wall-clock-relative, unique within a single run via seqIndex). */
function gradeEntry(
  opts: {
    dayOffset: number;
    cardType: "name" | "reverse" | "cry" | "evolution" | "reverse-evolution";
    subjectKey: string;
    locale: string;
    grade: 1 | 2 | 4 | 5;
  },
  seqIndex = 0,
): GradeLogRow {
  const date = relativeDate(-opts.dayOffset);
  const occurred_at = Date.now() - opts.dayOffset * 86_400_000 + seqIndex * 1000;
  return {
    occurred_at,
    entry_date: date,
    card_type: appTypeToDbType(opts.cardType),
    grade: opts.grade,
    subject_key: opts.subjectKey,
    locale: opts.locale,
    learning_step: null,
    step_started_at: null,
  };
}

// ---------------------------------------------------------------------------
// Dataset: qa-fresh
// ---------------------------------------------------------------------------

/**
 * qa-fresh: signed-in user with zero card rows.
 * Exercises: first-sync / pull-empty flow.
 */
export function buildQaFresh(): CloudDataset {
  return {
    description: "Signed-in user with zero card rows. Exercises first-sync / pull-empty.",
    cardRows: [],
    streakRows: [],
    gradeLogRows: [],
    settingsPatch: {},
  };
}

// ---------------------------------------------------------------------------
// Dataset: qa-mastery
// ---------------------------------------------------------------------------

/**
 * qa-mastery: large near-complete mastered history + grade_log.
 * Exercises: optimiser, stats, payload size.
 * Seeds 200 mastered species (name + reverse) and 50 due-soon species.
 */
export function buildQaMastery(): CloudDataset {
  const cardRows: CloudCardRow[] = [];
  const gradeLogRows: GradeLogRow[] = [];

  // 200 mastered species: Gen-I through Gen-V (IDs 1–250 + 301–450).
  // All with en locale; name + reverse pair (Pasture requirement, #1234).
  const masteredIds: number[] = [];
  for (let i = 1; i <= 250; i++) {
    if (SEED_BY_ID.has(i)) masteredIds.push(i);
  }
  // Fill to 200 from higher IDs if Gen-I/II is short.
  for (let i = 301; masteredIds.length < 200 && i <= 500; i++) {
    if (SEED_BY_ID.has(i)) masteredIds.push(i);
  }

  let gradeSeq = 0;
  for (const id of masteredIds) {
    const state = deriveMasteredState({
      dueDaysFromNow: 7 + (id % 14),
      lastReviewDaysFromNow: -(7 + (id % 14)),
    });
    cardRows.push(nameRow(id, state));
    cardRows.push(reverseRow(id, state));

    // Grade-log entries: three Easy grades per card (matches replay).
    const subjectKey = Subject.forSpecies(id);
    for (const dayOffset of [365, 360, 345]) {
      gradeLogRows.push(
        gradeEntry({ dayOffset, cardType: "name", subjectKey, locale: "en", grade: 5 }, gradeSeq++),
      );
      gradeLogRows.push(
        gradeEntry({ dayOffset, cardType: "reverse", subjectKey, locale: "en", grade: 5 }, gradeSeq++),
      );
    }
  }

  // 50 due-soon species (IDs after the mastered set).
  const dueSoonIds: number[] = [];
  for (let i = 501; dueSoonIds.length < 50 && i <= 700; i++) {
    if (SEED_BY_ID.has(i)) dueSoonIds.push(i);
  }
  for (const id of dueSoonIds) {
    cardRows.push(nameRow(id, deriveDueSoonState(3 + (id % 7))));
    // Grade log: initial three Good grades (graduate) + one more.
    const subjectKey = Subject.forSpecies(id);
    for (const dayOffset of [30, 28, 26, 20]) {
      gradeLogRows.push(
        gradeEntry({ dayOffset, cardType: "name", subjectKey, locale: "en", grade: 4 }, gradeSeq++),
      );
    }
  }

  // Streak: 90 days of consecutive reviews.
  const streakRows = buildStreakRows(90);

  return {
    description:
      "~200 mastered species (name+reverse, en) + 50 due-soon + grade_log. " +
      "Exercises optimiser, stats, and payload size.",
    cardRows,
    streakRows,
    gradeLogRows,
    settingsPatch: {
      pokemonNameLocale: "en",
      learningLocales: ["en"],
    },
  };
}

// ---------------------------------------------------------------------------
// Dataset: qa-locale
// ---------------------------------------------------------------------------

/**
 * qa-locale: per-locale split - en mastered, ja fresh.
 * Exercises: locale-aware sync, per-locale FSRS rows.
 */
export function buildQaLocale(): CloudDataset {
  const cardRows: CloudCardRow[] = [];

  // 30 mastered en-locale species (name + reverse).
  const enMasteredIds = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    13, 16, 19, 25, 35, 39, 52, 54, 58, 63,
    66, 74, 79, 81, 84, 86, 90, 92, 95, 98,
  ];
  for (const id of enMasteredIds) {
    const state = deriveMasteredState({ dueDaysFromNow: 7, lastReviewDaysFromNow: -7 });
    cardRows.push(nameRow(id, state, "en"));
    cardRows.push(reverseRow(id, state, "en"));
  }

  // 10 due-soon en-locale.
  const enDueSoonIds = [100, 102, 109, 111, 114, 115, 116, 120, 122, 124];
  for (const id of enDueSoonIds) {
    cardRows.push(nameRow(id, deriveDueSoonState(), "en"));
  }

  // 5 mastered ja-locale species (name + reverse) - same species as en, independent FSRS.
  const jaMasteredIds = [1, 4, 7, 25, 39];
  for (const id of jaMasteredIds) {
    const state = deriveMasteredState({ dueDaysFromNow: 5, lastReviewDaysFromNow: -5 });
    cardRows.push(nameRow(id, state, "ja"));
    cardRows.push(reverseRow(id, state, "ja"));
  }
  // ja: 5 due-soon so a Japanese session is non-empty.
  const jaDueSoonIds = [43, 52, 63, 66, 74];
  for (const id of jaDueSoonIds) {
    cardRows.push(nameRow(id, deriveDueSoonState(), "ja"));
  }

  const streakRows = buildStreakRows(34);

  return {
    description:
      "Per-locale split: 30 mastered en + 10 due-soon en; 5 mastered ja + 5 due-soon ja. " +
      "Each locale's FSRS rows are independent. Exercises locale-aware sync.",
    cardRows,
    streakRows,
    gradeLogRows: [],
    settingsPatch: {
      pokemonNameLocale: "en",
      learningLocales: ["en", "ja"],
    },
  };
}

// ---------------------------------------------------------------------------
// Dataset: qa-streak
// ---------------------------------------------------------------------------

/**
 * qa-streak: streak_days history + protection tokens.
 * Exercises: streak sync legs, streak protection.
 */
export function buildQaStreak(): CloudDataset {
  const cardRows: CloudCardRow[] = [];

  // 15 mastered species so the account looks active.
  const masteredIds = [1, 4, 7, 10, 13, 16, 19, 23, 25, 27, 29, 32, 35, 37, 39];
  for (const id of masteredIds) {
    const state = deriveMasteredState({ dueDaysFromNow: 7, lastReviewDaysFromNow: -7 });
    cardRows.push(nameRow(id, state));
    cardRows.push(reverseRow(id, state));
  }

  // 60-day streak (two earned tokens at EARN_INTERVAL_DAYS=30).
  const streakRows = buildStreakRows(60);

  return {
    description:
      "60-day streak history + 15 mastered species. " +
      "Exercises streak_days sync leg and protection-token seeding.",
    cardRows,
    streakRows,
    gradeLogRows: [],
    settingsPatch: {
      pokemonNameLocale: "en",
      learningLocales: ["en"],
      streakProtection: {
        balance: 2,
        spendDates: [],
        daysSinceLastEarn: 10,
        lastEarnCheckDate: relativeDate(0),
        protectionEvents: [
          { date: relativeDate(-60), kind: "earned" },
          { date: relativeDate(-30), kind: "earned" },
        ],
        lastAcknowledgedProtectionEventDate: null,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Dataset: qa-conflict
// ---------------------------------------------------------------------------

/**
 * qa-conflict: pre-staged divergence to exercise pull-before-push merge logic
 * and the regression trigger.
 *
 * Strategy: seed a set of cards with relatively recent lastReview timestamps
 * and moderate reps. When another session pushes a lower-reps state for the
 * same card, the regression trigger fires, demonstrating the guard works.
 * The initial INSERT uses a valid graduated state, so no trigger rejection
 * occurs on seeding.
 */
export function buildQaConflict(): CloudDataset {
  const cardRows: CloudCardRow[] = [];
  const gradeLogRows: GradeLogRow[] = [];

  // 20 heavily-reviewed species (high reps) to give the cloud a head start.
  const highRepsIds = [
    1, 4, 7, 25, 39, 52, 63, 66, 74, 79,
    84, 90, 95, 100, 109, 111, 122, 127, 130, 131,
  ];

  let gradeSeq = 0;
  for (const id of highRepsIds) {
    const state = deriveHighRepsState(6); // reps=6, well above mastery
    cardRows.push(nameRow(id, state));

    // Grade log: 6 Easy grades at day offsets.
    const subjectKey = Subject.forSpecies(id);
    for (let g = 0; g < 6; g++) {
      gradeLogRows.push(
        gradeEntry({ dayOffset: 60 - g * 10, cardType: "name", subjectKey, locale: "en", grade: 5 }, gradeSeq++),
      );
    }
  }

  // 10 mastered evolution cards so the conflict scenario includes edge rows.
  const evoEdges: Array<[number, number]> = [
    [1, 2], [2, 3], [4, 5], [5, 6],
    [7, 8], [8, 9], [25, 26], [43, 44],
    [60, 61], [63, 64],
  ];
  for (const [preId, postId] of evoEdges) {
    if (!EVO_BY_ENDPOINTS.has(`${preId}:${postId}`)) continue;
    cardRows.push(evoRow(preId, postId, deriveMasteredState({ dueDaysFromNow: 14 })));
  }

  const streakRows = buildStreakRows(20);

  return {
    description:
      "20 high-reps species (reps=6) + 10 mastered evolution edges. " +
      "Cloud is ahead of any fresh local session. " +
      "Exercises pull-before-push merge and the regression trigger.",
    cardRows,
    streakRows,
    gradeLogRows,
    settingsPatch: {
      pokemonNameLocale: "en",
      learningLocales: ["en"],
    },
  };
}

// ---------------------------------------------------------------------------
// Dataset registry
// ---------------------------------------------------------------------------

export type DatasetName = "qa-fresh" | "qa-mastery" | "qa-locale" | "qa-streak" | "qa-conflict";

export const DATASET_BUILDERS: Record<DatasetName, () => CloudDataset> = {
  "qa-fresh": buildQaFresh,
  "qa-mastery": buildQaMastery,
  "qa-locale": buildQaLocale,
  "qa-streak": buildQaStreak,
  "qa-conflict": buildQaConflict,
};

export const ALL_DATASET_NAMES: DatasetName[] = [
  "qa-fresh",
  "qa-mastery",
  "qa-locale",
  "qa-streak",
  "qa-conflict",
];

/**
 * Datasets intentionally exempt from the name+reverse mastery-pairing invariant.
 * qa-fresh has no cards; qa-conflict seeds name-only rows for regression-trigger testing.
 * Shared by the dry-run validator and the test suite: single source of pairing-exemption policy.
 */
export const PAIRING_EXEMPT_DATASETS: DatasetName[] = ["qa-fresh", "qa-conflict"];

/** Default QA password (overridden by QA_SEED_PASSWORD env var). */
export const DEFAULT_QA_PASSWORD = "QaSeed2025!";
