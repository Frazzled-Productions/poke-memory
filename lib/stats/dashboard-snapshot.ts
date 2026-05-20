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
} from "@/lib/stats/derive";
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

  // `computeStats` is required for mastery, struggling, and forecast axes.
  // Compute it whenever any of those axes is wanted.
  const needsStats =
    wants("mastery") || wants("struggling") || wants("forecast");

  let statsResult: StatsResult | null = null;
  if (needsStats) {
    statsResult = computeStats(
      nameCards,
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
    const eligibleCardIds = computeEligibleCardIds(cards, settings);
    const { newQueue, learningCardIds, reviewQueue } = buildSessionQueues(
      cards,
      limits,
      today,
      eligibleCardIds,
    );
    const todayCount =
      newQueue.length + learningCardIds.length + reviewQueue.length;

    if (wants("queue")) {
      queue = {
        newCount: newQueue.length,
        learningCount: learningCardIds.length,
        reviewCount: reviewQueue.length,
        totalCount: todayCount,
      };
    }

    if (wants("forecast")) {
      // Replace the today bar with the exact queue total. Future bars
      // (indices 1–13) come from computeStats unchanged — they are exact
      // dueDate matches and don't depend on eligibility settings.
      // statsResult is always non-null here: needsStats = wants("mastery") ||
      // wants("struggling") || wants("forecast"), so forecast implies computed.
      const forecast = statsResult!.dueForecast;
      // computeStats always returns 14 entries (DUE_FORECAST_DAYS), so
      // forecast.length > 0 is unconditionally true — spread directly.
      dueForecast = [{ ...forecast[0], count: todayCount }, ...forecast.slice(1)];
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
