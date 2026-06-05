/**
 * Streak protection via earned tokens (#1227, revised #1245).
 *
 * Tokens are scarce, earned currency that automatically preserve a streak
 * across a missed day. The rules:
 *
 * 1. Earn rate. The user earns one token after `EARN_INTERVAL_DAYS` of
 *    consecutive review days since the last token was earned (or since the
 *    feature first applied). A "review day" matches the existing streak
 *    counter - every day that is in the `streakDates` set qualifies.
 * 2. Cap. The balance is capped at `MAX_BALANCE`. Earning a token while the
 *    balance is already at the cap is a no-op (the counter still resets, so
 *    the next earn requires another `EARN_INTERVAL_DAYS` of reviews).
 * 3. Spend trigger. Automatic on app open when a consecutive run of missed
 *    days is found immediately before today, bounded by a still-alive day
 *    (review day or prior spend) before it. The spend is all-or-nothing:
 *    balance must be >= gapLength to bridge the whole run; if the gap is
 *    unsavable no tokens are spent and the balance is preserved. The
 *    walk-back is bounded by MAX_BALANCE so at most 3 days are scanned.
 *    Consecutive spends are permitted - scarcity (earn rate + balance cap)
 *    is the only gate (#1245, extended #1399).
 *
 * The full design is documented in #1227. These constants are tunable; if a
 * value feels wrong mid-implementation, surface it in a follow-up issue
 * rather than changing it unilaterally.
 */

import { isoDate } from "@/lib/utils/format-date";

/** Days of consecutive reviewing required to earn one token. */
export const EARN_INTERVAL_DAYS = 30;

/** Hard cap on the token balance. Once reached, further earns are no-ops. */
export const MAX_BALANCE = 3;

/** Maximum number of protection events stored in `protectionEvents`. */
export const MAX_PROTECTION_EVENTS = 10;

/**
 * A single protection event recorded in the history list.
 * - `"earned"` - a token was earned on this date (no spend that day).
 * - `"spent"` - a token was spent on this date (no earn that day).
 * - `"earned-and-spent"` - a token was earned AND spent in the same step
 *   (the silent same-day case the user may not have noticed).
 */
export type ProtectionEventKind = "earned" | "spent" | "earned-and-spent";

export type ProtectionEvent = {
  /** ISO date ("YYYY-MM-DD") in UTC. */
  date: string;
  kind: ProtectionEventKind;
};

/**
 * Persisted shape for streak protection state. Lives inside the
 * `user_settings.settings` JSONB blob, so it follows the user across devices
 * via the existing settings sync (LWW with key-level merge).
 */
export type StreakProtection = {
  /** Tokens currently held. Always 0..MAX_BALANCE. */
  balance: number;
  /**
   * ISO dates ("YYYY-MM-DD") on which a token was auto-spent to preserve the
   * streak. Sorted ascending. The list is the source of truth for the
   * user-visible spend history.
   */
  spendDates: string[];
  /**
   * Number of qualifying review days observed since the last token was earned
   * (or since the feature started tracking for this user). Resets to 0 when a
   * token is earned. Counts at most once per calendar day, gated by
   * `lastEarnCheckDate`.
   */
  daysSinceLastEarn: number;
  /**
   * ISO date of the most recent day the user's review activity contributed to
   * `daysSinceLastEarn`. Used to make the daily increment idempotent across
   * multiple grade events in the same day.
   */
  lastEarnCheckDate: string | null;
  /**
   * Capped history of protection events, newest last. At most
   * `MAX_PROTECTION_EVENTS` entries; the oldest is dropped when a new entry
   * would exceed the cap. Used to render the recent-protection list on the
   * Stats page and to determine whether the one-time earn-and-spend banner
   * should be shown.
   */
  protectionEvents: ProtectionEvent[];
  /**
   * The date of the most recent `earned-and-spent` event that the user has
   * already acknowledged (i.e. the one-time banner was shown). When this
   * matches the most recent `earned-and-spent` event's date, the banner is
   * suppressed.
   */
  lastAcknowledgedProtectionEventDate: string | null;
};

/** Sensible defaults for a brand-new user. */
export const DEFAULT_STREAK_PROTECTION: StreakProtection = {
  balance: 0,
  spendDates: [],
  daysSinceLastEarn: 0,
  lastEarnCheckDate: null,
  protectionEvents: [],
  lastAcknowledgedProtectionEventDate: null,
};

/**
 * Defensive parser for the persisted shape. Returns sensible defaults when
 * the payload is missing, malformed, or partially corrupted - never throws.
 * Keeps the same posture as the rest of `lib/settings/persistence.ts`.
 */
export function validateStreakProtection(value: unknown): StreakProtection {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_STREAK_PROTECTION };
  }
  const v = value as Record<string, unknown>;

  const balance =
    typeof v.balance === "number" &&
    Number.isInteger(v.balance) &&
    v.balance >= 0
      ? Math.min(v.balance, MAX_BALANCE)
      : 0;

  const spendDates: string[] = Array.isArray(v.spendDates)
    ? Array.from(
        new Set(
          v.spendDates.filter(
            (d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d),
          ),
        ),
      ).sort()
    : [];

  const daysSinceLastEarn =
    typeof v.daysSinceLastEarn === "number" &&
    Number.isInteger(v.daysSinceLastEarn) &&
    v.daysSinceLastEarn >= 0
      ? v.daysSinceLastEarn
      : 0;

  const lastEarnCheckDate =
    typeof v.lastEarnCheckDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v.lastEarnCheckDate)
      ? v.lastEarnCheckDate
      : null;

  const protectionEvents: ProtectionEvent[] = Array.isArray(v.protectionEvents)
    ? v.protectionEvents.reduce<ProtectionEvent[]>((acc, entry) => {
        if (
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as Record<string, unknown>).date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(
            (entry as Record<string, unknown>).date as string,
          ) &&
          (
            (entry as Record<string, unknown>).kind === "earned" ||
            (entry as Record<string, unknown>).kind === "spent" ||
            (entry as Record<string, unknown>).kind === "earned-and-spent"
          )
        ) {
          acc.push({
            date: (entry as Record<string, unknown>).date as string,
            kind: (entry as Record<string, unknown>).kind as ProtectionEventKind,
          });
        }
        return acc;
      }, [])
    : [];

  const lastAcknowledgedProtectionEventDate =
    typeof v.lastAcknowledgedProtectionEventDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v.lastAcknowledgedProtectionEventDate)
      ? v.lastAcknowledgedProtectionEventDate
      : null;

  return {
    balance,
    spendDates,
    daysSinceLastEarn,
    lastEarnCheckDate,
    protectionEvents,
    lastAcknowledgedProtectionEventDate,
  };
}

/**
 * Result of applying the protection rules for a given `today`. Pure - no
 * side effects. The caller decides when to persist the returned `protection`
 * and whether to dispatch any events.
 */
export type ProtectionStepResult = {
  /** New protection state after applying any earn/spend events. */
  protection: StreakProtection;
  /** True if a token was spent in this step (bridged a missed yesterday). */
  spent: boolean;
  /** True if a token was earned in this step (counter crossed the threshold). */
  earned: boolean;
};

/**
 * Advance the protection state for a fresh day. Three phases run in order:
 *
 * Phase 1 - Spend (pre-earn): if there is a consecutive run of missing days
 *     immediately before today, bounded by a still-alive day (a review day or
 *     a prior spend) before it, and the current balance >= gapLength, every
 *     missing day is bridged in one app-open by spending one token per day.
 *     This is all-or-nothing: if the gap is longer than the available balance
 *     the streak is unsavable, so no tokens are spent and the balance is
 *     preserved. The walk-back is bounded by MAX_BALANCE, so at most 3 days
 *     are ever inspected. One combined protection event is recorded, not one
 *     per day. (#1399). `spendSet` is updated immediately after so the earn
 *     leg sees the bridged days.
 *
 * Phase 2 - Earn: if today is a qualifying review day (present in
 *     `streakDates`), `daysSinceLastEarn` increments by one (guarded by
 *     `lastEarnCheckDate` so multiple grade events in the same day count
 *     once). When the counter reaches `EARN_INTERVAL_DAYS`, balance is
 *     incremented (clamped to `MAX_BALANCE`) and the counter resets to 0. If
 *     any day strictly between `lastEarnCheckDate` and `today` is neither a
 *     review day nor a spend day, the consecutive-review chain was broken - 
 *     the counter resets to 0 before incrementing for today, so the 30-day
 *     clock only counts *sustained* practice (#1227 scarcity invariant).
 *     Because `spendSet` was updated in Phase 1, bridged days are correctly
 *     seen here (#1399 ordering hazard).
 *
 * Phase 3 - Spend (post-earn): a second spend check runs only when the earn
 *     leg actually awarded a new token in Phase 2 AND no spend fired in
 *     Phase 1. This handles the combined earn-then-spend case: the user's
 *     balance was 0 (so Phase 1 couldn't spend), earn raised it to 1, and the
 *     newly-minted token can bridge a single-day gap in the same step. The
 *     same walk-back and all-or-nothing rules apply.
 *
 * `today` and the `streakDates` set use ISO date strings ("YYYY-MM-DD"),
 * matching the existing streak storage. The function never mutates its
 * inputs.
 */
export function applyProtectionStep(
  protection: StreakProtection,
  streakDates: readonly string[],
  today: string,
): ProtectionStepResult {
  const dateSet = new Set(streakDates);
  const spendSet = new Set(protection.spendDates);

  let next: StreakProtection = {
    ...protection,
    spendDates: [...protection.spendDates],
    protectionEvents: [...(protection.protectionEvents ?? [])],
  };
  let earned = false;
  let spent = false;

  // -------------------------------------------------------------------------
  // Shared walk-back helper (inline) - finds the consecutive missing days
  // immediately before today and the anchor that bounds the gap. Used by both
  // the pre-earn spend leg (Phase 1) and the post-earn spend leg (Phase 3).
  //
  // Returns { missingDays, foundAnchor } where missingDays is ordered newest-
  // first (yesterday, day-before, …). Walk limit: MAX_BALANCE missing-day
  // steps, plus one anchor-search step. A gap of more than MAX_BALANCE days
  // can never be bridged (balance cap), so the walk exits early.
  function findGap(
    liveSet: ReadonlySet<string>,
  ): { missingDays: string[]; foundAnchor: boolean } {
    const missing: string[] = [];
    let anchor = false;
    for (let i = 1; i <= MAX_BALANCE + 1; i++) {
      const day = offsetDate(today, -i);
      if (liveSet.has(day)) {
        anchor = true;
        break;
      }
      if (i <= MAX_BALANCE) {
        missing.push(day);
      }
      // i === MAX_BALANCE + 1 and still missing → gap unsavable; anchor stays false.
    }
    return { missingDays: missing, foundAnchor: anchor };
  }

  // -------------------------------------------------------------------------
  // Phase 1 - Spend (pre-earn).
  //
  // Walk backwards from yesterday collecting consecutive missing days until we
  // find a still-alive day (review or prior spend) that anchors the gap. The
  // check is all-or-nothing: balance must be >= gapLength to bridge; otherwise
  // no tokens are spent and the balance is preserved intact.
  {
    // Build a combined live-set (dateSet ∪ spendSet) for the walk.
    const liveSet = new Set<string>(dateSet);
    for (const d of spendSet) liveSet.add(d);

    const { missingDays, foundAnchor } = findGap(liveSet);
    const gapLength = missingDays.length;

    if (foundAnchor && gapLength >= 1 && next.balance >= gapLength) {
      // Bridge every missing day: add to spendDates, decrement balance.
      spent = true;
      const newSpendSet = new Set(next.spendDates);
      for (const day of missingDays) newSpendSet.add(day);
      const mergedDates = Array.from(newSpendSet).sort();
      next = {
        ...next,
        balance: next.balance - gapLength,
        spendDates: mergedDates,
      };
      // Rebuild spendSet so the earn leg (Phase 2) can see the bridged days.
      for (const day of missingDays) spendSet.add(day);
    }
  }

  // -------------------------------------------------------------------------
  // Phase 2 - Earn leg.
  //
  // Only counts when today is a qualifying review day and we have not already
  // counted today. The check fires daily - at most one increment per calendar
  // day, regardless of how many grade events fire.
  if (dateSet.has(today) && next.lastEarnCheckDate !== today) {
    // Reset the consecutive-review counter if the chain between
    // `lastEarnCheckDate` and `today` is broken - any interstitial day that
    // is neither a review day nor bridged by a spend means the user did not
    // sustain the streak, so the earn clock must start over. Token spends
    // legitimately bridge a missed day (the streak is preserved) so they
    // also preserve the earn counter. `spendSet` was updated in Phase 1 so
    // bridged days are correctly seen here (#1399 ordering hazard).
    if (
      next.lastEarnCheckDate !== null &&
      hasUnbridgedGap(next.lastEarnCheckDate, today, dateSet, spendSet)
    ) {
      next = { ...next, daysSinceLastEarn: 0 };
    }

    const incrementedDays = next.daysSinceLastEarn + 1;
    if (incrementedDays >= EARN_INTERVAL_DAYS) {
      const nextBalance = Math.min(next.balance + 1, MAX_BALANCE);
      earned = nextBalance > next.balance;
      next = {
        ...next,
        balance: nextBalance,
        daysSinceLastEarn: 0,
        lastEarnCheckDate: today,
      };
    } else {
      next = {
        ...next,
        daysSinceLastEarn: incrementedDays,
        lastEarnCheckDate: today,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Phase 3 - Spend (post-earn).
  //
  // Only runs when earn fired in Phase 2 AND no spend fired in Phase 1. This
  // handles the combined "earn-then-spend" case: balance was 0 (Phase 1
  // couldn't spend), earning raised it to 1, and the newly-minted token can
  // bridge a single-day gap in the same step. The same walk-back and
  // all-or-nothing rules apply. At this point spendSet still reflects Phase 1
  // results (no change since spend didn't fire), so re-use it.
  if (earned && !spent) {
    // Rebuild the live set to include the Phase 1 spendSet (unchanged) and
    // the current spendDates from `next` (also unchanged since Phase 1 didn't
    // spend). We build a fresh liveSet to be explicit about what's visible.
    const liveSet = new Set<string>(dateSet);
    for (const d of next.spendDates) liveSet.add(d);

    const { missingDays, foundAnchor } = findGap(liveSet);
    const gapLength = missingDays.length;

    if (foundAnchor && gapLength >= 1 && next.balance >= gapLength) {
      spent = true;
      const newSpendSet = new Set(next.spendDates);
      for (const day of missingDays) newSpendSet.add(day);
      const mergedDates = Array.from(newSpendSet).sort();
      next = {
        ...next,
        balance: next.balance - gapLength,
        spendDates: mergedDates,
      };
    }
  }

  // Append a protection event when at least one of earn/spend fired. Earn-
  // and-spend in the same step produces a single "earned-and-spent" entry so
  // the user sees one clear record instead of two. The list is capped at
  // MAX_PROTECTION_EVENTS; the oldest entry is dropped when the cap is hit.
  if (earned || spent) {
    const kind: ProtectionEventKind =
      earned && spent ? "earned-and-spent" : earned ? "earned" : "spent";
    const newEvent: ProtectionEvent = { date: today, kind };
    const updatedEvents = [...next.protectionEvents, newEvent];
    next = {
      ...next,
      protectionEvents:
        updatedEvents.length > MAX_PROTECTION_EVENTS
          ? updatedEvents.slice(updatedEvents.length - MAX_PROTECTION_EVENTS)
          : updatedEvents,
    };
  }

  return { protection: next, spent, earned };
}

/**
 * Compose `streakDates` with `spendDates` so a downstream `computeStreak`
 * call treats spent days as bridged. Returns a sorted, deduped ISO-string
 * array. Pure - no mutation of inputs.
 */
export function effectiveStreakDates(
  streakDates: readonly string[],
  spendDates: readonly string[],
): string[] {
  const merged = new Set<string>(streakDates);
  for (const d of spendDates) merged.add(d);
  return Array.from(merged).sort();
}

/**
 * Cheap "is today's spend already done?" helper. The caller uses this to
 * avoid running `applyProtectionStep` after every grade event on a day where
 * the spend already fired.
 */
export function hasSpendForYesterday(
  protection: StreakProtection,
  today: string,
): boolean {
  const yesterday = offsetDate(today, -1);
  return protection.spendDates.includes(yesterday);
}

function offsetDate(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/**
 * Returns true when at least one ISO date strictly between `from` and `to`
 * (exclusive at both ends) is neither in `dateSet` nor in `spendSet` - i.e.
 * the user missed a day that no token spend covered. Used to decide whether
 * the earn counter should reset before incrementing for `to`.
 *
 * Adjacent dates (`to = from + 1`) have no interstitial range and always
 * return false. If `to <= from` the range is empty and the function returns
 * false (a no-op guard against pathological inputs).
 */
function hasUnbridgedGap(
  from: string,
  to: string,
  dateSet: ReadonlySet<string>,
  spendSet: ReadonlySet<string>,
): boolean {
  let cursor = offsetDate(from, 1);
  while (cursor < to) {
    if (!dateSet.has(cursor) && !spendSet.has(cursor)) return true;
    cursor = offsetDate(cursor, 1);
  }
  return false;
}
