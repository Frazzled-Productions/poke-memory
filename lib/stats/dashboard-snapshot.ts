/**
 * computeDashboardSnapshot — single source of truth for derived card/session data.
 *
 * Introduced in #1121 to eliminate the `patchForecastTodayBar` page-layer
 * workaround and unify the Stats and Journey pages behind one derivation call.
 *
 * The function is PURE: no hooks, no globals, no I/O. Deterministic given the
 * same inputs. Safe to call inside `useMemo`.
 *
 * `include` controls which axes are computed. Axes not in the list are set to
 * `null` without computing. Omitting `include` computes everything.
 */

import type { ReviewableCard, NameReviewCard, DailyLimits } from "@/lib/review/session";
import { buildSessionQueues } from "@/lib/review/session";
import {
  computeEligibleCardIds,
  type EligibilitySettings,
} from "@/lib/review/scope";
import {
  computeStats,
  type StatsResult,
  type StrugglingCard,
  type DueForecastDay,
  type GenerationStats,
  type TypeStats,
  DUE_FORECAST_DAYS,
} from "@/lib/stats/derive";
import { addDaysToIsoDate } from "@/lib/utils/dates";
import {
  computeCompletionProjection,
  type CompletionProjection,
} from "@/lib/stats/completion-projection";
import {
  computeDifficultyHistogram,
  meanDifficulty,
  type DifficultyBucket,
} from "@/lib/stats/difficulty-histogram";
import {
  projectTimeToFirstMastery,
} from "@/lib/srs/timeToMastery";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SnapshotAxis =
  | "queue"
  | "forecast"
  | "mastery"
  | "struggling"
  | "projection"
  | "firstMastery"
  | "difficulty";

export type QueueCounts = {
  newCount: number;
  learningCount: number;
  reviewCount: number;
  totalCount: number;
};

export type MasterySnapshot = {
  totalCards: number;
  introduced: number;
  learning: number;
  mastered: number;
  locked: number;
  perGeneration: readonly GenerationStats[];
  perType: readonly TypeStats[];
};

export type DifficultySnapshot = {
  buckets: readonly DifficultyBucket[];
  mean: number | null;
};

export type DashboardSnapshot = {
  /** UTC YYYY-MM-DD string passed by the caller. */
  today: string;
  /** Whether `forceAllMastered` was on when this snapshot was computed. */
  forceAllMastered: boolean;
  /** Queue breakdown (new / learning / review) — null when axis excluded. */
  queue: QueueCounts | null;
  /**
   * 14-entry due-forecast array, today first. Day 0 count is the exact queue
   * total from `buildSessionQueues` (matching the Practice page). Days 1–13
   * are exact dueDate matches on future dates. Null when axis excluded.
   */
  dueForecast: readonly DueForecastDay[] | null;
  /** Mastery counts + per-gen + per-type breakdown — null when axis excluded. */
  mastery: MasterySnapshot | null;
  /** Introduced cards that pass the struggling gates — null when axis excluded. */
  struggling: readonly StrugglingCard[] | null;
  /** Completion projection — null when axis excluded. */
  projection: CompletionProjection | null;
  /**
   * Projected days to first mastery — null when axis excluded, or when no
   * introduced-but-not-yet-mastered cards exist, or when `forceAllMastered`.
   */
  firstMasteryDays: number | null;
  /** Difficulty histogram + mean — null when axis excluded. */
  difficulty: DifficultySnapshot | null;
};

export type DashboardSnapshotOptions = {
  /**
   * Axes to compute. When omitted, all axes are computed. When specified, axes
   * not in the list are skipped (set to null) for performance.
   */
  include?: SnapshotAxis[];
  /** Passed to `computeStats` — defaults to 10. */
  strugglingLimit?: number;
  /** Mastery-repetitions threshold — defaults to MASTERY_REPETITIONS (3). */
  masteryRepetitions?: number;
  /**
   * Superuser `pretendAllMastered` flag. Flows into every helper that accepts
   * it. When true, the snapshot reflects "everything mastered" state without
   * mutating persisted data.
   */
  forceAllMastered?: boolean;
  /**
   * FSRS retention target, passed to `projectTimeToFirstMastery`.
   * Defaults to 0.9.
   */
  retentionTarget?: number;
  /**
   * Reference timestamp for the `firstMastery` axis. Defaults to `new Date()`
   * (the real current moment) when omitted, which matches the behaviour of the
   * pre-refactor Stats-page code that passed `new Date()` directly.
   *
   * Passing an explicit value (e.g. midnight UTC) anchors the projection to a
   * fixed point, which improves test determinism but shifts the result by up to
   * ~12 hours depending on when the user grades. Omit this parameter for
   * production call sites so the projection always counts from the real moment.
   */
  now?: Date;
};

// ---------------------------------------------------------------------------
// computeQueueCountFromEligible
// ---------------------------------------------------------------------------

/**
 * Lower-level queue-count helper used when the caller already holds a
 * pre-computed `eligibleCardIds` set. Avoids a redundant
 * `computeEligibleCardIds` pass when the snapshot path shares the result
 * across the queue and forecast axes (#1158).
 *
 * Pure — no I/O, no DOM access, no hooks.
 *
 * @param cards          Full card array from the saved session.
 * @param eligibleCardIds Pre-computed set from `computeEligibleCardIds`.
 * @param limits         Per-type daily new/review limits.
 * @param today          UTC `YYYY-MM-DD` date string.
 * @returns              `QueueCounts` with new / learning / review breakdowns
 *                       and a convenience `totalCount` field.
 */
export function computeQueueCountFromEligible(
  cards: readonly ReviewableCard[],
  eligibleCardIds: ReadonlySet<number>,
  limits: DailyLimits,
  today: string,
): QueueCounts {
  const { newQueue, learningCardIds, reviewQueue } = buildSessionQueues(
    cards,
    limits,
    today,
    eligibleCardIds,
  );
  return {
    newCount: newQueue.length,
    learningCount: learningCardIds.length,
    reviewCount: reviewQueue.length,
    totalCount: newQueue.length + learningCardIds.length + reviewQueue.length,
  };
}

// ---------------------------------------------------------------------------
// computeQueueCount
// ---------------------------------------------------------------------------

/**
 * Compute the total number of cards due today for a given session, applying
 * the same eligibility gate and daily caps as `buildSessionQueues` (which the
 * Practice page uses). This is the single shared helper for badge surfaces —
 * `usePwaBadge`, `useDocumentTitleBadge`, and the Stats dashboard's `queue`
 * axis all delegate here so they can never disagree on the count.
 *
 * Pure — no I/O, no DOM access, no hooks.
 *
 * @param cards    Full card array from the saved session.
 * @param settings Eligibility settings (card-type toggles + practice scope).
 * @param limits   Per-type daily new/review limits.
 * @param today    UTC `YYYY-MM-DD` date string. Caller owns timezone resolution.
 * @returns        `QueueCounts` with new / learning / review breakdowns and
 *                 a convenience `totalCount` field.
 */
export function computeQueueCount(
  cards: readonly ReviewableCard[],
  settings: EligibilitySettings,
  limits: DailyLimits,
  today: string,
): QueueCounts {
  const eligibleCardIds = computeEligibleCardIds(cards, settings);
  return computeQueueCountFromEligible(cards, eligibleCardIds, limits, today);
}

// ---------------------------------------------------------------------------
// computeDashboardSnapshot
// ---------------------------------------------------------------------------

/**
 * Derive all dashboard stats from the full card array plus scheduling
 * parameters. Pure — no I/O, no side effects.
 *
 * @param cards     Full mixed-type card array from the session.
 * @param settings  Eligibility settings (card-type toggles + practice scope).
 * @param limits    Daily new/review limits — used for queue + forecast axes.
 * @param today     UTC YYYY-MM-DD string. Caller owns timezone resolution.
 * @param options   Optional axis selection and per-helper overrides.
 */
export function computeDashboardSnapshot(
  cards: readonly ReviewableCard[],
  settings: EligibilitySettings,
  limits: DailyLimits,
  today: string,
  options: DashboardSnapshotOptions = {},
): DashboardSnapshot {
  const {
    include,
    strugglingLimit = 10,
    masteryRepetitions,
    forceAllMastered = false,
    retentionTarget = 0.9,
    now = new Date(),
  } = options;

  function wants(axis: SnapshotAxis): boolean {
    return include === undefined || include.includes(axis);
  }

  // Split name cards once — `computeStats` and several other helpers operate
  // only on name cards. This is O(n) and the cheapest shared work.
  const nameCards = cards.filter(
    (c): c is NameReviewCard => c.cardType === "name",
  );

  // `computeStats` is required for mastery and struggling axes.
  // The forecast axis now builds its future bars directly from the full card
  // set (all card types), so it no longer depends on computeStats.
  //
  // Pass the full mixed card array so computeStats can build the
  // mastered-reverse species set and apply the both-legs-required mastery
  // rule introduced in #1234. It filters to name cards internally.
  const needsStats =
    wants("mastery") || wants("struggling");

  let statsResult: StatsResult | null = null;
  if (needsStats) {
    statsResult = computeStats(
      cards,
      today,
      strugglingLimit,
      masteryRepetitions,
      forceAllMastered,
    );
  }

  // Queue + forecast axes both need eligible card IDs and session queues.
  const needsQueue = wants("queue") || wants("forecast");

  let queue: QueueCounts | null = null;
  let dueForecast: readonly DueForecastDay[] | null = null;

  if (needsQueue) {
    // Compute eligible card IDs once and share between the queue (via
    // computeQueueCountFromEligible) and the forecast future-bar loop. Both
    // axes gate on the same eligibility predicate, so running
    // computeEligibleCardIds once avoids a redundant O(n) pass over the full
    // card collection (#1149). The helper keeps the queue-assembly logic in one
    // place and is reused by computeQueueCount too (#1158).
    const eligibleCardIds = computeEligibleCardIds(cards, settings);
    const counts = computeQueueCountFromEligible(cards, eligibleCardIds, limits, today);

    if (wants("queue")) {
      queue = counts;
    }

    if (wants("forecast")) {
      // Build a 14-entry forecast that covers all active card types.
      //
      // Day 0 ("today"): the exact queue total from the session queues above,
      // which already applies the full eligibility gate (card-type toggles +
      // scope + daily caps) for all card types. This was introduced in #1121.
      //
      // Days 1–13 ("future"): a count of eligible cards whose dueDate exactly
      // matches that future date. New cards (lastReview === null) are excluded
      // — they enter the queue on the day they are introduced, not on their
      // default dueDate. Cards are filtered through the same eligibility gate
      // (eligible card IDs) as the queue so disabled card types and out-of-scope
      // cards are absent from the future bars too. This fixes #1138, where the
      // future bars only reflected name cards.
      //
      // Pre-compute the 13 future date strings (indices 1–13) so the card loop
      // can do a single Map lookup per card.
      const futureDates: string[] = [];
      for (let i = 1; i < DUE_FORECAST_DAYS; i++) {
        futureDates.push(addDaysToIsoDate(today, i));
      }
      const futureDateIndex = new Map<string, number>();
      futureDates.forEach((d, i) => futureDateIndex.set(d, i + 1)); // offset by 1 (index 0 = today)

      // eligibleCardIds already computed above — reused here.
      const futureCounts = new Array<number>(DUE_FORECAST_DAYS).fill(0);

      for (const card of cards) {
        // Exclude ineligible cards (disabled card type, out-of-scope, etc.).
        if (!eligibleCardIds.has(card.id)) continue;
        // Exclude never-reviewed cards — they are new-card candidates, not
        // scheduled reviews, and are accounted for in the today bar via the queue.
        if (card.state.lastReview === null) continue;
        // Map the card's dueDate to a future bar index (1–13). Dates outside
        // the window or equal to today are ignored here (today is bar 0).
        const idx = futureDateIndex.get(card.state.dueDate);
        if (idx !== undefined) {
          futureCounts[idx]++;
        }
      }

      // Build the DueForecastDay array. Bar 0 uses the queue total (all card
      // types, caps applied); bars 1–13 use the eligibility-gated future counts.
      const forecastDates = [today, ...futureDates];
      dueForecast = forecastDates.map((date, i) => ({
        date,
        count: i === 0 ? counts.totalCount : futureCounts[i],
      }));
    }
  }

  // Mastery axis — pulled from statsResult.
  let mastery: MasterySnapshot | null = null;
  if (wants("mastery") && statsResult !== null) {
    mastery = {
      totalCards: statsResult.totalCards,
      introduced: statsResult.introduced,
      learning: statsResult.learning,
      mastered: statsResult.mastered,
      locked: statsResult.locked,
      perGeneration: statsResult.perGeneration,
      perType: statsResult.perType,
    };
  }

  // Struggling axis — pulled from statsResult.
  let struggling: readonly StrugglingCard[] | null = null;
  if (wants("struggling") && statsResult !== null) {
    struggling = statsResult.struggling;
  }

  // Projection axis.
  let projection: CompletionProjection | null = null;
  if (wants("projection")) {
    projection = computeCompletionProjection(
      nameCards,
      today,
      masteryRepetitions ?? 3,
      forceAllMastered,
    );
  }

  // First-mastery axis. Only relevant when introduced > 0 and mastered === 0.
  // The helper itself returns null for forceAllMastered.
  let firstMasteryDays: number | null = null;
  if (wants("firstMastery")) {
    // We need to know introduced/mastered counts to gate this axis.
    // If statsResult is already computed, reuse it. Otherwise do a minimal check.
    let introduced = 0;
    let mastered = 0;
    if (statsResult !== null) {
      introduced = statsResult.introduced;
      mastered = statsResult.mastered;
    } else {
      // Compute a minimal pass for the gate check.
      for (const card of nameCards) {
        if (card.state.lastReview !== null) {
          introduced++;
          if (
            card.state.reps >= (masteryRepetitions ?? 3) &&
            card.state.scheduledDays >= 21
          ) {
            mastered++;
          }
        }
      }
    }
    if (!forceAllMastered && introduced > 0 && mastered === 0) {
      firstMasteryDays =
        projectTimeToFirstMastery(
          nameCards,
          now,
          masteryRepetitions,
          forceAllMastered,
          { retentionTarget },
        ).days;
    }
  }

  // Difficulty axis — operates on the FULL cards array (all card types),
  // not just name cards. This distinction is intentional (plan spec).
  let difficulty: DifficultySnapshot | null = null;
  if (wants("difficulty")) {
    difficulty = {
      buckets: computeDifficultyHistogram(cards, forceAllMastered),
      mean: meanDifficulty(cards, forceAllMastered),
    };
  }

  return {
    today,
    forceAllMastered,
    queue,
    dueForecast,
    mastery,
    struggling,
    projection,
    firstMasteryDays,
    difficulty,
  };
}
