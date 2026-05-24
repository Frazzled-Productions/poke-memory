/**
 * Streak protection via earned tokens (#1227).
 *
 * Tokens are scarce, earned currency that automatically preserve a streak
 * across a missed day. The rules:
 *
 * 1. Earn rate. The user earns one token after `EARN_INTERVAL_DAYS` of
 *    consecutive review days since the last token was earned (or since the
 *    feature first applied). A "review day" matches the existing streak
 *    counter — every day that is in the `streakDates` set qualifies.
 * 2. Cap. The balance is capped at `MAX_BALANCE`. Earning a token while the
 *    balance is already at the cap is a no-op (the counter still resets, so
 *    the next earn requires another `EARN_INTERVAL_DAYS` of reviews).
 * 3. Consecutive-use limit. A token cannot be spent on day N if a token was
 *    already spent on day N-1. Two spends in a row are never permitted —
 *    "life happens" must not blur into "I'm not really doing this".
 * 4. Spend trigger. Automatic on a missed day, iff balance >= 1 AND yesterday
 *    was not itself a spend day AND the streak was alive before the gap. The
 *    spend bridges exactly one missed day. If the user does not have a token,
 *    the streak resets as before.
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
   * streak. Sorted ascending. The list is the source of truth for both the
   * consecutive-use guard and the user-visible spend history.
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
};

/** Sensible defaults for a brand-new user. */
export const DEFAULT_STREAK_PROTECTION: StreakProtection = {
  balance: 0,
  spendDates: [],
  daysSinceLastEarn: 0,
  lastEarnCheckDate: null,
};

/**
 * Defensive parser for the persisted shape. Returns sensible defaults when
 * the payload is missing, malformed, or partially corrupted — never throws.
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

  return { balance, spendDates, daysSinceLastEarn, lastEarnCheckDate };
}

/**
 * Result of applying the protection rules for a given `today`. Pure — no
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
 * Advance the protection state for a fresh day. Two side-channel events
 * happen here:
 *
 *   - Earn: if today is a qualifying review day (present in `streakDates`),
 *     `daysSinceLastEarn` increments by one (guarded by `lastEarnCheckDate`
 *     so multiple grade events in the same day count once). When the counter
 *     reaches `EARN_INTERVAL_DAYS`, balance is incremented (clamped to
 *     `MAX_BALANCE`) and the counter resets to 0.
 *
 *   - Spend: if today is NOT a review day (yet) but the streak would otherwise
 *     have broken because yesterday is missing, and the day before yesterday
 *     IS in `streakDates` or `spendDates`, and balance >= 1, and yesterday is
 *     not preceded by another spend (consecutive-use guard), a token is spent
 *     to bridge yesterday. `spendDates` gains `yesterday` and `balance`
 *     decrements.
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

  let next: StreakProtection = { ...protection, spendDates: [...protection.spendDates] };
  let earned = false;
  let spent = false;

  // Earn leg. Only counts when today is a qualifying review day and we have
  // not already counted today. The check fires daily — at most one increment
  // per calendar day, regardless of how many grade events fire.
  if (dateSet.has(today) && next.lastEarnCheckDate !== today) {
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

  // Spend leg. Triggered when yesterday is missing AND the day before was a
  // review day (or itself a prior spend). The consecutive-use guard rejects a
  // spend when day-before-yesterday is in `spendDates` — that would make two
  // protection days in a row.
  const yesterday = offsetDate(today, -1);
  const dayBefore = offsetDate(today, -2);

  const yesterdayMissing = !dateSet.has(yesterday) && !spendSet.has(yesterday);
  const streakAliveBeforeYesterday =
    dateSet.has(dayBefore) || spendSet.has(dayBefore);
  const dayBeforeWasSpend = spendSet.has(dayBefore);

  if (
    yesterdayMissing &&
    streakAliveBeforeYesterday &&
    !dayBeforeWasSpend &&
    next.balance >= 1
  ) {
    spent = true;
    const mergedDates = [...next.spendDates, yesterday].sort();
    next = {
      ...next,
      balance: next.balance - 1,
      spendDates: mergedDates,
    };
  }

  return { protection: next, spent, earned };
}

/**
 * Compose `streakDates` with `spendDates` so a downstream `computeStreak`
 * call treats spent days as bridged. Returns a sorted, deduped ISO-string
 * array. Pure — no mutation of inputs.
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
