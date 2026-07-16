/**
 * Pure eligibility predicate for the late-day "streak at risk" push (#1950).
 *
 * Reuses the existing streak-derivation primitives from `lib/streak/` -
 * `applyProtectionStep` / `effectiveStreakDates` (tokens.ts) and
 * `computeStreak` (compute.ts) - rather than re-deriving streak logic here.
 * This mirrors the CLIENT orchestration in `lib/streak/runProtection.ts`
 * (`runStreakProtection`), which cannot be imported directly because it reads
 * `localStorage` and is client-only; this predicate takes the equivalent
 * state as plain arguments instead.
 *
 * HONESTY REQUIREMENT (ux/privacy sign-off, #1950): a push claiming the
 * streak is "at risk" must never fire when a streak-protection token would
 * silently bridge the gap tonight (when the user's next app-open runs
 * `runStreakProtection` for tomorrow). Sending a false-urgency nudge when the
 * streak was never actually in danger erodes trust in the copy. The
 * eligibility check simulates that tomorrow protection step here and treats
 * an auto-bridgeable gap as "not at risk".
 */

import { applyProtectionStep, effectiveStreakDates, type StreakProtection } from "@/lib/streak/tokens";
import { computeStreak } from "@/lib/streak/compute";

export type StreakNudgeInput = {
  /** Every streak_days review date for this user ("YYYY-MM-DD", UTC). */
  streakDays: readonly string[];
  /** The user's persisted streak-protection state (from `user_settings.settings`). */
  streakProtection: StreakProtection;
  /** Whether the user has already reviewed today (from `get_push_reviewed_today`). */
  reviewedToday: boolean;
  /** "Today" in the user's own timezone ("YYYY-MM-DD"). */
  today: string;
};

/**
 * Returns true only when the user has an ACTIVE streak that is GENUINELY at
 * risk today: they have not reviewed today, missing today would break the
 * streak, and no available protection token would auto-bridge the gap.
 */
export function isEligibleForStreakNudge(input: StreakNudgeInput): boolean {
  const { streakDays, streakProtection, reviewedToday, today } = input;

  // Gate 1: already reviewed today - never nudge, regardless of streak state.
  if (reviewedToday) return false;

  // Gate 2: active streak, honouring already-bridged gaps (grace window).
  // `streakDays` never includes today's date (reviewedToday is false), so
  // `computeStreak`'s grace window (today missing, yesterday present) applies
  // when the streak is genuinely still alive pending today's review.
  const effectiveDatesSoFar = effectiveStreakDates(
    streakDays,
    streakProtection.spendDates,
  );
  const activeStreak = computeStreak(effectiveDatesSoFar, today);
  if (activeStreak <= 0) return false;

  // Gate 3 (honesty check): simulate the protection step that will run the
  // next time the user opens the app - "tomorrow" relative to `today` - with
  // today still missing from the streak dates (the user has not reviewed).
  // If that simulated step would spend a token to bridge today's gap, the
  // streak is not genuinely at risk: suppress the nudge.
  const tomorrow = offsetDate(today, 1);
  const simulated = applyProtectionStep(streakProtection, streakDays, tomorrow);
  if (simulated.spent) return false;

  // Gate 4: no token bridges the gap and the streak is active - genuinely at
  // risk. (If missing today would NOT break the streak - e.g. reviewDates
  // already reflects some other bridging - `activeStreak <= 0` would have
  // already returned false above, so reaching here means it genuinely lapses.)
  return true;
}

function offsetDate(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
