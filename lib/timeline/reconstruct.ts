/**
 * Collection timeline reconstruction.
 *
 * Two directions:
 *   Past - replays grade_log entries through the FSRS scheduler to
 *            reconstruct per-card state at any historical point in time,
 *            deriving firstSeen and mastery-crossing dates.
 *   Future - projects each card's current stability forward to find the day
 *            its FSRS retrievability is expected to drop below retentionTarget
 *            if never reviewed again (the "forgetting horizon").
 *
 * SRS-expert verdict (inline, issue #853):
 *   Replaying historical grades through current per-user weights is a known
 *   approximation. Weights change after each optimizer run, so reconstructed
 *   stability/scheduledDays values diverge from historical truth for graduated
 *   cards. The divergence is acceptable here because: (a) weights stabilise
 *   quickly after a few sessions, (b) the visualisation is celebratory rather
 *   than an authoritative audit, and (c) the issue explicitly blesses this
 *   approach. The mastery-crossing timestamp is the key output - small errors
 *   in reconstructed stability do not change the week-level granularity the UI
 *   displays. Legacy grade_log entries that lack subjectKey are skipped; their
 *   absence makes the past replay slightly optimistic (fewer cards appear
 *   introduced), which is better than guessing a wrong card assignment.
 */

import { nextReview, initialReviewState, type ReviewState, type Grade } from "@/lib/srs/scheduler";
import { isMastered, MASTERY_REPETITIONS, MASTERY_INTERVAL_DAYS } from "@/lib/stats/derive";
import type { GradeLogEntry } from "@/lib/gradelog/persistence";
import type { AppLocale } from "@/i18n/locales";
import { isoDate } from "@/lib/utils/format-date";
import { computeDecayFactor, generatorParameters } from "ts-fsrs";

// Compute FSRS power-law decay/factor once from the default parameters.
// `computeDecayFactor` expects the raw weights array (p.w), not the full
// params object. The result is stable for a given set of weights; per-user
// optimised weights are not exposed here because the timeline reconstruction
// uses default weights throughout (see the SRS-expert verdict in the module
// docstring above).
const { decay: FSRS_DECAY, factor: FSRS_FACTOR } = computeDecayFactor(
  generatorParameters().w,
);

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/**
 * One point on the past-direction timeline. At `atMs` (epoch ms), the
 * collection had `introduced` species seen for the first time and
 * `mastered` species crossing the mastery threshold.
 */
export type CollectionSnapshot = {
  atMs: number;
  introduced: number;
  mastered: number;
};

/**
 * The full reconstructed timeline, split into past and future halves,
 * plus metadata needed by the scrubber.
 */
export type CollectionTimeline = {
  /**
   * Snapshots sorted chronologically. Includes the "now" snapshot at index
   * `nowIndex`. Each snapshot accumulates state from the beginning of the
   * log up to that point.
   */
  past: readonly CollectionSnapshot[];
  /**
   * Future snapshots: cards that will drop below retentionTarget at each
   * future day, if never reviewed again.
   * `atMs` is midnight UTC of the day the card is projected to forget.
   * `introduced` and `mastered` represent the count of cards that still
   * retain above threshold on that day (counting backward from now).
   */
  future: readonly CollectionSnapshot[];
  /**
   * Epoch ms of the "now" anchor - the boundary between past and future.
   */
  nowMs: number;
  /**
   * Total number of species in the full collection (the denominator).
   */
  totalSpecies: number;
};

// ---------------------------------------------------------------------------
// Past direction
// ---------------------------------------------------------------------------

/**
 * Group grade_log entries by their subjectKey + cardType composite.
 * Entries without a subjectKey are skipped (legacy log, pre-#462).
 */
function groupByCard(
  log: readonly GradeLogEntry[],
): Map<string, GradeLogEntry[]> {
  const byCard = new Map<string, GradeLogEntry[]>();
  for (const entry of log) {
    if (!entry.subjectKey) continue;
    const key = `${entry.cardType}:${entry.subjectKey}`;
    let arr = byCard.get(key);
    if (arr === undefined) {
      arr = [];
      byCard.set(key, arr);
    }
    arr.push(entry);
  }
  // Sort each card's entries chronologically by occurredAt.
  for (const arr of byCard.values()) {
    arr.sort((a, b) => a.occurredAt - b.occurredAt);
  }
  return byCard;
}

/**
 * Map from species subjectKey to the epoch-ms timestamps of:
 *   firstSeen      - when this species was first graded (for any card type)
 *   masteredAtMs   - when it FIRST crossed the mastery threshold (null if
 *                    never mastered in the log). Never revoked by a later
 *                    lapse (#1448) - this is what the aggregate past
 *                    timeline uses, so a species that lapses still counts
 *                    towards "mastered" at every checkpoint after its first
 *                    crossing.
 *   lastMasteredAtMs - when it MOST RECENTLY crossed the mastery threshold
 *                    (null if never mastered in the log). Updates again
 *                    after a lapse-then-remaster cycle, unlike masteredAtMs.
 *                    Added for #1956 (per-species mastery date on the
 *                    Pokédex detail page): a badge that is true NOW should
 *                    carry the date of the run that made it true now, not
 *                    silently omit an intervening lapse.
 */
type SpeciesEvent = {
  firstSeenMs: number;
  masteredAtMs: number | null;
  lastMasteredAtMs: number | null;
};

const VALID_GRADES = new Set([1, 2, 4, 5]);

/**
 * Reconstruct per-species firstSeen and masteryAt timestamps by replaying
 * the grade log through the FSRS scheduler.
 *
 * Only "name" card types are used to drive the `introduced` and `mastered`
 * counts that the timeline displays - evolution/reverse/cry cards contribute
 * to the replay but do not create a separate species entry.
 *
 * @param log         Full grade log, any order (will be sorted internally).
 * @param options     Optional FSRS weight/retention overrides (ignored in
 *                    replay - we use defaults, matching the approximation
 *                    blessed in the SRS-expert verdict above).
 */
function replayLog(
  log: readonly GradeLogEntry[],
): Map<string, SpeciesEvent> {
  // Per-card state keyed by "cardType:subjectKey".
  const cardStates = new Map<string, ReviewState>();
  // Per-species output keyed by subjectKey (numeric species ID string).
  const speciesEvents = new Map<string, SpeciesEvent>();

  // Track per-species, per-leg CURRENT mastery (not just first crossing) so
  // we can detect every name+reverse transition into species-level mastery,
  // including a re-crossing after a lapse (#1956). Species mastery requires
  // BOTH legs currently mastered (#1448/#1234).
  const nameLegMastered = new Map<string, boolean>();
  const reverseLegMastered = new Map<string, boolean>();
  // Species-level "currently mastered" from the previous entry, used to spot
  // a false → true transition (a crossing) as we replay chronologically.
  const speciesCurrentlyMastered = new Map<string, boolean>();

  const byCard = groupByCard(log);

  // Collect all grade events (subjectKey present) sorted chronologically.
  const allEntries: GradeLogEntry[] = [];
  for (const arr of byCard.values()) {
    allEntries.push(...arr);
  }
  allEntries.sort((a, b) => a.occurredAt - b.occurredAt);

  for (const entry of allEntries) {
    if (!entry.subjectKey) continue;
    if (!VALID_GRADES.has(entry.grade)) continue;

    const cardKey = `${entry.cardType}:${entry.subjectKey}`;
    const now = new Date(entry.occurredAt);

    let state = cardStates.get(cardKey);
    if (state === undefined) {
      state = initialReviewState(now);
    }

    let nextState: ReviewState;
    try {
      nextState = nextReview(state, entry.grade as Grade, now);
    } catch {
      // Invalid grade or scheduler error - skip entry, preserve existing state.
      continue;
    }

    cardStates.set(cardKey, nextState);

    const speciesKey = entry.subjectKey;
    const nowMastered = isMastered(nextState);

    if (entry.cardType === "name") {
      // Track firstSeen for the species (from the name card).
      const existing = speciesEvents.get(speciesKey);
      const firstSeenMs = existing?.firstSeenMs ?? entry.occurredAt;
      if (existing === undefined) {
        speciesEvents.set(speciesKey, {
          firstSeenMs,
          masteredAtMs: null,
          lastMasteredAtMs: null,
        });
      }
      nameLegMastered.set(speciesKey, nowMastered);
    } else if (entry.cardType === "reverse") {
      // Defensive: species event absent (e.g. log begins with reverse
      // entries after a local reset + cloud pull). Create it now.
      if (!speciesEvents.has(speciesKey)) {
        speciesEvents.set(speciesKey, {
          firstSeenMs: entry.occurredAt,
          masteredAtMs: null,
          lastMasteredAtMs: null,
        });
      }
      reverseLegMastered.set(speciesKey, nowMastered);
    } else {
      // Evolution and other card types don't map 1:1 to a species
      // introduction; they contribute to per-card FSRS state tracking but
      // not to species-level mastery legs.
      continue;
    }

    // Species-level mastery requires BOTH legs currently mastered
    // (#1448/#1234). Detect a false → true transition (a crossing) at this
    // entry's timestamp - this fires again after a lapse-then-remaster
    // cycle, which is exactly what `lastMasteredAtMs` needs to track (#1956).
    const speciesNowMastered =
      (nameLegMastered.get(speciesKey) ?? false) &&
      (reverseLegMastered.get(speciesKey) ?? false);
    const wasSpeciesMastered = speciesCurrentlyMastered.get(speciesKey) ?? false;

    if (speciesNowMastered && !wasSpeciesMastered) {
      const ev = speciesEvents.get(speciesKey);
      if (ev !== undefined) {
        speciesEvents.set(speciesKey, {
          firstSeenMs: ev.firstSeenMs,
          masteredAtMs: ev.masteredAtMs ?? entry.occurredAt,
          lastMasteredAtMs: entry.occurredAt,
        });
      }
    }
    speciesCurrentlyMastered.set(speciesKey, speciesNowMastered);
  }

  return speciesEvents;
}

/**
 * How many days of history to render at daily resolution.
 * Beyond this window, the past timeline falls back to weekly snapshots.
 * At one entry per day, 90 days = 90 entries; older history adds at most
 * ~52 more per year of weekly entries, keeping the total array manageable.
 */
const DAILY_RESOLUTION_DAYS = 90;

/**
 * Build the past half of the timeline: a sorted list of snapshots from the
 * first grade ever recorded up to now.
 *
 * Resolution strategy:
 *   - The most recent `DAILY_RESOLUTION_DAYS` days are sampled daily (one
 *     snapshot per midnight UTC), giving day-by-day fidelity for new users.
 *   - Older history is sampled weekly (Sunday midnight UTC) to keep the total
 *     snapshot count bounded.
 *   - `nowMs` is always the final entry so the scrubber "now" anchor is exact.
 */
function buildPastTimeline(
  speciesEvents: Map<string, SpeciesEvent>,
  nowMs: number,
): CollectionSnapshot[] {
  if (speciesEvents.size === 0) return [];

  // Safety: if no species events have been recorded yet (e.g. only evolution
  // card types in the log, or all entries lack subjectKey), return empty.
  const hasAnyIntroduced = [...speciesEvents.values()].some(
    (ev) => ev.firstSeenMs <= nowMs,
  );
  if (!hasAnyIntroduced) return [];

  // Find the earliest firstSeen.
  let minMs = nowMs;
  for (const ev of speciesEvents.values()) {
    if (ev.firstSeenMs < minMs) minMs = ev.firstSeenMs;
  }

  // Boundary between the weekly (old) and daily (recent) regions.
  // Snap to midnight UTC so checkpoints are always aligned to day boundaries.
  const dailyBoundaryMs = nowMs - DAILY_RESOLUTION_DAYS * 86_400_000;
  // Snap to the start of the boundary day (midnight UTC).
  const dailyStartMs = dailyBoundaryMs - (dailyBoundaryMs % 86_400_000);

  const checkpoints: number[] = [];

  // --- Weekly region: from the earliest firstSeen up to the daily boundary ---
  if (minMs < dailyStartMs) {
    // Snap minMs back to the previous Sunday midnight UTC.
    const minDate = new Date(minMs);
    const dayOfWeek = minDate.getUTCDay(); // 0 = Sunday
    const weeklyStartMs = minMs - dayOfWeek * 86_400_000 - (minMs % 86_400_000);

    for (let t = weeklyStartMs; t < dailyStartMs; t += 7 * 86_400_000) {
      checkpoints.push(t);
    }
  }

  // --- Daily region: one checkpoint per midnight UTC for the recent window ---
  // Anchor on the start of the current day so daily entries align to UTC dates.
  const todayMidnightMs = nowMs - (nowMs % 86_400_000);
  const dailyRegionStart = Math.max(minMs - (minMs % 86_400_000), dailyStartMs);
  for (let t = dailyRegionStart; t <= todayMidnightMs; t += 86_400_000) {
    checkpoints.push(t);
  }

  // Ensure nowMs is the final entry (exact "now" anchor for the scrubber).
  if (checkpoints.length === 0 || checkpoints[checkpoints.length - 1] < nowMs) {
    checkpoints.push(nowMs);
  }

  return checkpoints.map((atMs) => {
    let introduced = 0;
    let mastered = 0;
    for (const ev of speciesEvents.values()) {
      if (ev.firstSeenMs <= atMs) {
        introduced++;
        if (ev.masteredAtMs !== null && ev.masteredAtMs <= atMs) {
          mastered++;
        }
      }
    }
    return { atMs, introduced, mastered };
  });
}

// ---------------------------------------------------------------------------
// Future direction (forgetting horizon)
// ---------------------------------------------------------------------------

/**
 * FSRS power-law retrievability: R(t, S) = (1 + FACTOR * t / S)^DECAY
 * where t = elapsed days, S = stability, DECAY < 0, FACTOR > 0.
 *
 * Invert for t when R(t, S) = retentionTarget:
 *   retentionTarget = (1 + FACTOR * t / S)^DECAY
 *   retentionTarget^(1/DECAY) = 1 + FACTOR * t / S
 *   t = (retentionTarget^(1/DECAY) - 1) / FACTOR * S
 *
 * This matches ts-fsrs's own `calculate_interval_modifier` formula.
 * Note: retentionTarget >= 1 returns Infinity (not 0) - the caller
 * uses !isFinite to skip those entries.
 */
function daysUntilForgetting(stability: number, retentionTarget: number): number {
  if (stability <= 0) return 0;
  if (retentionTarget <= 0 || retentionTarget >= 1) return Infinity;
  return (Math.pow(retentionTarget, 1 / FSRS_DECAY) - 1) / FSRS_FACTOR * stability;
}

/**
 * One entry representing a card's forgetting projection.
 */
type CardForgettingEvent = {
  speciesKey: string;
  forgetMs: number; // epoch ms when retrievability drops below target
};

/**
 * Build the future half of the timeline: daily snapshots for up to
 * `horizonDays` days into the future, showing how many cards still retain
 * above retentionTarget on each day.
 *
 * `currentCards` is a map from speciesKey to current ReviewState for name
 * cards. Cards with no stability (never reviewed / in learning) are
 * excluded from the forgetting horizon.
 *
 * @param forceAllMastered  Superuser flag - when true, treat all species as
 *                          currently mastered (stability set to a high value).
 */
function buildFutureTimeline(
  currentCards: Map<string, ReviewState>,
  retentionTarget: number,
  nowMs: number,
  horizonDays = 180,
  forceAllMastered = false,
): CollectionSnapshot[] {
  const events: CardForgettingEvent[] = [];
  // A stability value that puts forgetting well beyond the maximum 365-day
  // horizon - used when forceAllMastered is on to make all cards appear
  // retained for the full future window.
  const FAKE_MASTERY_STABILITY = 9_999; // days

  for (const [speciesKey, state] of currentCards) {
    const stability = forceAllMastered ? FAKE_MASTERY_STABILITY : state.stability;
    // Skip cards that have never been reviewed (no stability to project from),
    // unless forceAllMastered is on (in which case we use synthetic stability).
    if (!forceAllMastered && state.lastReview === null) continue;
    if (stability <= 0) continue;

    const daysToForget = daysUntilForgetting(stability, retentionTarget);
    if (!isFinite(daysToForget)) continue;

    // Anchor on the last-review date, because FSRS retrievability is a function
    // of elapsed time since lastReview (not since dueDate). dueDate is already
    // lastReview + daysToForget, so anchoring on dueDate would double-count the
    // interval and overstate retention by a full scheduling cycle (F19).
    // If lastReview is available, derive its epoch directly; otherwise fall back
    // to deriving it from dueDate - scheduledDays.
    const dueDateMs = new Date(state.dueDate + "T00:00:00Z").getTime();
    const lastReviewMs = state.lastReview
      ? new Date(state.lastReview + "T00:00:00Z").getTime()
      : dueDateMs - (state.scheduledDays ?? 0) * 86_400_000;
    const forgetMs = lastReviewMs + daysToForget * 86_400_000;

    // Include cards that will be forgotten within the horizon AND cards that
    // are already forgotten (forgetMs <= nowMs): clamp those to nowMs so they
    // contribute as "forgotten at day 0" (F19 - "already overdue → forgotten at
    // day 0"). Exclude cards whose forgetting horizon is beyond the display
    // window (they stay retained throughout).
    if (forgetMs <= nowMs + horizonDays * 86_400_000) {
      // Clamp already-forgotten cards to nowMs so they count as forgotten from
      // day 0 in the future projection. Cards with forgetMs > nowMs are stored
      // as-is (they will be forgotten at their actual projected time).
      events.push({ speciesKey, forgetMs: forgetMs <= nowMs ? nowMs : forgetMs });
    }
  }

  // Count how many name-card species are actually projectable.
  const reviewedCards = [...currentCards.values()].filter((s) =>
    forceAllMastered ? true : (s.lastReview !== null && s.stability > 0),
  );
  if (reviewedCards.length === 0) return [];

  const trackedCount = reviewedCards.length;

  const snapshots: CollectionSnapshot[] = [];
  for (let day = 0; day <= horizonDays; day++) {
    const atMs = nowMs + day * 86_400_000;
    const forgotten = events.filter((e) => e.forgetMs <= atMs).length;
    snapshots.push({
      atMs,
      introduced: trackedCount - forgotten,
      mastered: trackedCount - forgotten,
    });
  }

  return snapshots;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type BuildTimelineOptions = {
  /** Grade log from loadGradeLog(). */
  log: readonly GradeLogEntry[];
  /**
   * Current per-card name ReviewStates, keyed by subjectKey (species ID string).
   * Used only for the future (forgetting) direction.
   */
  currentNameCards: Map<string, ReviewState>;
  /**
   * Total number of species in the seed (used as `totalSpecies` denominator).
   */
  totalSpecies: number;
  /**
   * FSRS request_retention from user settings.
   */
  retentionTarget?: number;
  /**
   * Epoch ms of "now". Defaults to Date.now().
   */
  nowMs?: number;
  /**
   * How many days forward to project the forgetting horizon. Defaults to 180.
   */
  horizonDays?: number;
  /**
   * Superuser pretendAllMastered flag. When true, the past direction shows
   * all species as mastered from time 0, and the future direction uses a
   * high synthetic stability for all cards.
   */
  forceAllMastered?: boolean;
  /**
   * Active pokemonNameLocale. REQUIRED (#1851 type-system forcing): the
   * replay filters grade-log entries to this locale before grouping. A
   * species enrolled in two locales has two independent cards with the SAME
   * subjectKey, so an unfiltered replay interleaved both locales' grades
   * into one FSRS stream - stability accrued double, mastery crossings fired
   * early, and the scrubber's Now snapshot disagreed with the locale-scoped
   * live counters on the same page.
   */
  locale: AppLocale;
};

/**
 * Build the full past+future collection timeline.
 *
 * The past direction reconstructs per-species firstSeen and masteredAt
 * timestamps by replaying the grade log through the FSRS scheduler.
 * The future direction projects each card's current stability forward to
 * find the day FSRS retrievability is expected to drop below retentionTarget.
 *
 * Note: when `nowMs` is omitted the function falls back to `Date.now()`, so
 * it is not strictly pure - callers that require deterministic output should
 * always provide an explicit `nowMs`.
 *
 * Returns a `CollectionTimeline` value object ready for the scrubber UI.
 */
export function buildCollectionTimeline(
  opts: BuildTimelineOptions,
): CollectionTimeline {
  const {
    log,
    currentNameCards,
    totalSpecies,
    retentionTarget = 0.9,
    nowMs = Date.now(),
    horizonDays = 180,
    forceAllMastered = false,
    locale,
  } = opts;

  // Per-locale isolation (#1851 / #1562): entries from other locales belong
  // to different cards that merely share a subjectKey. Legacy entries without
  // a locale field read as "en", matching every other consumer.
  const localeLog = log.filter((entry) => (entry.locale ?? "en") === locale);

  let speciesEvents: Map<string, SpeciesEvent>;

  if (forceAllMastered) {
    // Under the superuser flag, synthesise events so all species appear
    // introduced and mastered at the earliest point of the past timeline.
    // Place syntheticMs BEFORE the first checkpoint (nowMs - DAILY_RESOLUTION_DAYS)
    // so every snapshot in the daily range counts all species, giving a flat
    // 100% line across the full slider (F59 - nowMs-1 landed after midnight,
    // causing the midnight checkpoint to see 0/0).
    const syntheticMs = nowMs - DAILY_RESOLUTION_DAYS * 86_400_000 - 1;
    speciesEvents = new Map();
    for (const key of currentNameCards.keys()) {
      speciesEvents.set(key, {
        firstSeenMs: syntheticMs,
        masteredAtMs: syntheticMs,
        lastMasteredAtMs: syntheticMs,
      });
    }
  } else {
    speciesEvents = replayLog(localeLog);
  }

  const past = buildPastTimeline(speciesEvents, nowMs);
  const future = buildFutureTimeline(
    currentNameCards,
    retentionTarget,
    nowMs,
    horizonDays,
    forceAllMastered,
  );

  return { past, future, nowMs, totalSpecies };
}

/**
 * Given a scrubber position in [-1, 1] and a CollectionTimeline, return
 * the CollectionSnapshot for that position.
 *
 * position === 0 → the "now" snapshot (last past entry).
 * position < 0  → a past snapshot (maps onto past[]).
 * position > 0  → a future snapshot (maps onto future[]).
 *
 * This is a pure lookup function - the scrubber UI calls it on every drag event.
 */
export function snapshotAtPosition(
  timeline: CollectionTimeline,
  position: number,
): CollectionSnapshot {
  const nowSnapshot: CollectionSnapshot = timeline.past.length > 0
    ? timeline.past[timeline.past.length - 1]
    : { atMs: timeline.nowMs, introduced: 0, mastered: 0 };

  if (position <= 0) {
    if (timeline.past.length === 0) return nowSnapshot;
    const idx = Math.round((position + 1) * (timeline.past.length - 1));
    const clamped = Math.max(0, Math.min(timeline.past.length - 1, idx));
    return timeline.past[clamped];
  }

  // Future direction.
  if (timeline.future.length === 0) return nowSnapshot;
  const idx = Math.round(position * (timeline.future.length - 1));
  const clamped = Math.max(0, Math.min(timeline.future.length - 1, idx));
  return timeline.future[clamped];
}

// ---------------------------------------------------------------------------
// Per-species mastery dates (#1956, rescoped: derive, don't store)
// ---------------------------------------------------------------------------

export type SpeciesMasteryDatesOptions = {
  /** Grade log from loadGradeLog(). */
  log: readonly GradeLogEntry[];
  /** Active pokemonNameLocale - see the locale-isolation note on `locale`
   * in `BuildTimelineOptions` above; the same reasoning applies here. */
  locale: AppLocale;
  /**
   * Superuser pretendAllMastered flag. The flag fakes CURRENT mastery
   * without altering grade-log history, so there is no real crossing to
   * report while it is on - this returns an empty map rather than
   * fabricating a date, and the caller's date-less "Mastered" badge (driven
   * independently by the flag) still renders correctly.
   */
  forceAllMastered?: boolean;
};

/**
 * Reconstruct, for every species with a recoverable mastery crossing in the
 * grade log, the epoch-ms timestamp of its MOST RECENT crossing (deliberately
 * not the first) - a species that lapsed and was re-mastered reports the date
 * of the run that made the badge true NOW, rather than silently carrying the
 * date of an earlier run that the badge no longer reflects (#1956).
 *
 * Reuses the SAME replay pass as `buildCollectionTimeline`'s past direction
 * (`replayLog`) rather than running a second, parallel replay - see the
 * SRS-expert verdict in the module docstring above for the accuracy bar this
 * inherits: default FSRS weights (not per-user optimised), month-level
 * granularity only, legacy entries without `subjectKey` skipped.
 *
 * Guest users lose grade-log entries older than 365 days (`pruneGradeLog`) -
 * a species mastered further back than that has no recoverable crossing and
 * is simply absent from the returned map. Callers must degrade gracefully to
 * the existing date-less "Mastered" badge in that case, never fabricate or
 * guess a date.
 *
 * @returns Map from numeric species ID to a "YYYY-MM-DD" UTC date string
 *          (the day of the most recent crossing - render at month
 *          granularity only, per the accuracy bar above).
 */
export function buildSpeciesMasteryDates(
  opts: SpeciesMasteryDatesOptions,
): Map<number, string> {
  const { log, locale, forceAllMastered = false } = opts;
  const result = new Map<number, string>();

  if (forceAllMastered) return result;

  // Per-locale isolation (#1851/#1562) - see the matching note in
  // `buildCollectionTimeline`.
  const localeLog = log.filter((entry) => (entry.locale ?? "en") === locale);
  const speciesEvents = replayLog(localeLog);

  for (const [speciesKey, ev] of speciesEvents) {
    if (ev.lastMasteredAtMs === null) continue;
    const speciesId = Number(speciesKey);
    if (!Number.isFinite(speciesId)) continue;
    result.set(speciesId, isoDate(new Date(ev.lastMasteredAtMs)));
  }

  return result;
}

// Re-export for consumers that need to check mastery in their own context.
export { MASTERY_REPETITIONS, MASTERY_INTERVAL_DAYS };
export type { SpeciesEvent };
