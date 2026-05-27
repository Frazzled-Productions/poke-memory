/**
 * Snooze reconciliation for the practice scope (#333).
 *
 * `PracticeScope` (see `lib/review/scope.ts`) decides which species are
 * eligible for the active session. Cards that drop out of scope must not
 * keep aging — otherwise removing the scope dumps a week's worth of
 * "overdue" reviews on the user and FSRS treats the gap as forgetting.
 *
 * The mechanism is a per-card `hiddenSince` ISO date on `ReviewState`:
 *   - When a graduated card first goes out of scope, stamp `hiddenSince = today`.
 *   - When it later comes back into scope, shift `dueDate` forward by the
 *     hidden duration (clamped) and clear the stamp.
 *
 * Only one side-effect helper lives here. Eligibility itself is decided
 * by `cardMatchesScope` (scope.ts); this module just owns the schedule
 * book-keeping on top.
 */

import { cardMatchesScope, isScopeEmpty, type PracticeScope } from "@/lib/review/scope";
import type { ReviewableCard } from "@/lib/review/session";
import { addDaysToIsoDate, daysBetweenIsoDates } from "@/lib/utils/dates";

/** Defensive upper bound on the dueDate shift applied during reconciliation. */
export const MAX_HIDDEN_SHIFT_DAYS = 365;

/**
 * In-place reconciliation of `hiddenSince` and `dueDate` against the
 * active practice scope. Mutates each card whose state changes and
 * returns the mutated array together with a `changed` flag.
 *
 * The parameter is genuinely mutable: the function writes to
 * `card.state.hiddenSince` and `card.state.dueDate` on each affected card.
 * All callers rely on this side effect.
 *
 * For each card with `firstSeen !== null` and `learningStep === null`:
 *   - Out-of-scope AND `hiddenSince === null` → stamp `hiddenSince = today`.
 *     (Never fires when scope is empty: `cardMatchesScope` returns true for
 *     every card on an empty scope, so the un-hide branch is the only one
 *     reachable in that mode.)
 *   - In-scope (or scope empty) AND `hiddenSince !== null` → shift
 *     `dueDate` forward by `min(max(daysBetween(hiddenSince, today), 0),
 *     MAX_HIDDEN_SHIFT_DAYS)` days and clear `hiddenSince`. The lower bound
 *     guards against future-dated `hiddenSince` (clock skew); the upper
 *     bound caps catastrophic stale stamps. A zero-day shift still clears
 *     the stamp so the next session doesn't re-trigger.
 *
 * Skipped:
 *   - New cards (`firstSeen === null`): no schedule to shift, no "since"
 *     to set — they'll get a `firstSeen` on first grade.
 *   - Learning-step cards (`learningStep !== null`): the in-step
 *     countdown owns their timing; we don't snooze across the
 *     wall-clock countdown.
 *
 * The empty-scope code path is deliberately a no-op for everything except
 * clearing stale `hiddenSince` — that branch is the user's escape hatch
 * when they manually clear the scope. Running this function after every
 * scope change keeps the data tidy.
 *
 * Returns `{ session, changed }` where `session` is the same (mutated)
 * array and `changed` is true iff at least one card's state was modified.
 * Callers that only care about the side-effect can ignore `changed`;
 * callers that conditionally persist (e.g. the load effect in
 * `ReviewSession`) gate their `saveSession` call on `changed === true`
 * to avoid a redundant ~600 KB IDB write on every page load (#1262).
 */
export function reconcileHiddenState(
  cards: ReviewableCard[],
  scope: PracticeScope,
  today: string,
): { session: ReviewableCard[]; changed: boolean } {
  const scopeEmpty = isScopeEmpty(scope);
  let changed = false;
  for (const card of cards) {
    if (card.state.firstSeen === null) continue;
    if (card.state.learningStep !== null) continue;
    // `cardMatchesScope` returns true for every card when the scope is
    // empty — by evaluating it directly we ensure the empty-scope mode
    // routes through the un-hide branch only.
    const inScope = cardMatchesScope(card, scope);
    const hiddenSince = card.state.hiddenSince;
    if (!inScope && hiddenSince === null) {
      // Cannot reach this branch when `scopeEmpty` is true — guard kept
      // for clarity rather than correctness.
      if (scopeEmpty) continue;
      card.state.hiddenSince = today;
      changed = true;
    } else if (inScope && hiddenSince !== null) {
      const raw = daysBetweenIsoDates(hiddenSince, today);
      const shift = Math.min(Math.max(raw, 0), MAX_HIDDEN_SHIFT_DAYS);
      if (shift > 0) {
        card.state.dueDate = addDaysToIsoDate(card.state.dueDate, shift);
      }
      card.state.hiddenSince = null;
      changed = true;
    }
  }
  return { session: cards, changed };
}
