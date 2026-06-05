"use client";

/**
 * FunnelTracker: fires a single `app_open` custom event on first mount.
 *
 * Properties emitted:
 *   - `userType`: "new" | "returning_guest" | "signed_in"
 *   - `progressBucket`: "0" | "1-10" | "11-50" | "50+"
 *
 * Both properties are strictly bucketed (non-PII).
 *
 * `userType` logic:
 *   - "signed_in" when auth resolves a non-null user.
 *   - "returning_guest" when at least one real-progress localStorage key is
 *     present (review session, grade log, streak, mastered-count cache, etc.)
 *     and the user is not signed in. Keys written automatically on the first
 *     visit (persist-requested, last-seen-version, client-salt, superuser)
 *     are NOT treated as evidence of progress.
 *   - "new" when neither condition holds.
 *
 * `progressBucket` is derived from the mastered-species count cache
 * (`KEY_MASTERED_COUNT_BY_LOCALE`), the maximum count across all locales.
 * Using the max (best single locale) avoids double-counting a species that
 * a user has mastered in more than one locale. This is a fast localStorage
 * read with no card-array parse, consistent with the approach used by
 * `useProfileStatus`. Returns "0" when the cache is absent or the maximum
 * is zero, which is the correct value for a truly new user.
 *
 * The event fires once, after auth loading completes, and is not repeated on
 * subsequent renders. The component renders nothing.
 *
 * Superuser note: the event fires normally under superuser mode. No cloud
 * write occurs (track() is a client-side beacon, not a Supabase write), so
 * the sync write-guard does not apply. Analytics data will be present but
 * may reflect the artificial superuser state (acceptable for a QA tool).
 *
 * #1667
 */

import { useEffect, useRef } from "react";
import { track } from "@vercel/analytics";
import { useAuth } from "@/lib/auth/AuthContext";
import { readMasteredCountCache } from "@/lib/profile/masteredCountCache";
import {
  KEY_REVIEW_SESSION,
  KEY_GRADE_LOG,
  KEY_DAILY_SUMMARY,
  KEY_SETTINGS,
  KEY_SETTINGS_LAST_PUSHED,
  KEY_SYNC_STATUS,
  KEY_PENDING_GRADE_QUEUE,
  KEY_STREAK,
  KEY_HAS_MASTERED,
  KEY_MASTERED_COUNT_BY_LOCALE,
  KEY_DUE_COUNT_BY_LOCALE,
  KEY_HAS_HISTORY_BY_LOCALE,
  KEY_POKEDEX_SORT,
  KEY_OFFLINE_DOWNLOADED_AT,
  KEY_OFFLINE_MANIFEST,
} from "@/lib/storage/keys";

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

type UserType = "new" | "returning_guest" | "signed_in";
type ProgressBucket = "0" | "1-10" | "11-50" | "50+";

// -----------------------------------------------------------------
// Pure helpers (exported for unit tests)
// -----------------------------------------------------------------

/**
 * Given the total mastered-species count (across all locales), return the
 * appropriate non-PII bucket label.
 */
export function toProgressBucket(total: number): ProgressBucket {
  if (total <= 0) return "0";
  if (total <= 10) return "1-10";
  if (total <= 50) return "11-50";
  return "50+";
}

/**
 * Read the best-locale mastered-species count from the localStorage cache.
 * Returns the maximum count across all locales so that a species mastered in
 * more than one locale is not double-counted. Returns 0 when the cache is
 * absent or malformed.
 *
 * The returned value is used to place the user in a `progressBucket` that
 * reflects the most-progressed single locale, not a cross-locale aggregate.
 *
 * Uses `Math.max` rather than a sum to avoid double-counting: a user who has
 * mastered the same 42 species in two locales has not mastered 84 unique
 * species. The highest single-locale count is the correct proxy for bucket
 * classification.
 *
 * Re-uses the existing `readMasteredCountCache` single-source helper; does
 * not re-derive mastery from the card array.
 */
export function readTotalMasteredCount(): number {
  const counts = readMasteredCountCache();
  return Math.max(0, ...Object.values(counts));
}

/**
 * The set of localStorage keys that represent actual review/card progress.
 *
 * Only the presence of one of these keys signals a returning guest. Keys
 * written automatically on the first session (persist-requested,
 * last-seen-version, client-salt, superuser unlock/flags) are deliberately
 * excluded so a zero-progress user is not misclassified as `returning_guest`
 * on their second visit.
 *
 * Using a named-constant allowlist (rather than a prefix scan) means adding a
 * new non-progress key never silently expands the returning-guest signal.
 */
const PROGRESS_KEYS: ReadonlySet<string> = new Set([
  KEY_REVIEW_SESSION,
  KEY_GRADE_LOG,
  KEY_DAILY_SUMMARY,
  KEY_SETTINGS,
  KEY_SETTINGS_LAST_PUSHED,
  KEY_SYNC_STATUS,
  KEY_PENDING_GRADE_QUEUE,
  KEY_STREAK,
  KEY_HAS_MASTERED,
  KEY_MASTERED_COUNT_BY_LOCALE,
  KEY_DUE_COUNT_BY_LOCALE,
  KEY_HAS_HISTORY_BY_LOCALE,
  KEY_POKEDEX_SORT,
  KEY_OFFLINE_DOWNLOADED_AT,
  KEY_OFFLINE_MANIFEST,
]);

/**
 * Detect whether the current browser has any prior review/card progress in
 * localStorage. Returns `true` only when at least one key from the
 * `PROGRESS_KEYS` allowlist is present.
 *
 * Keys written automatically on the first session (persist-requested,
 * last-seen-version, client-salt, superuser) do NOT count as progress, so a
 * zero-progress user returning for their second visit is still classified as
 * `new`.
 */
export function hasPriorLocalProgress(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const ls = window.localStorage;
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (key !== null && PROGRESS_KEYS.has(key)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------
// Component
// -----------------------------------------------------------------

export function FunnelTracker() {
  const { user, loading } = useAuth();
  const fired = useRef(false);

  useEffect(() => {
    // Wait until auth has resolved so we can correctly classify signed-in users.
    if (loading) return;
    // Fire exactly once per page session.
    if (fired.current) return;
    fired.current = true;

    const userType: UserType = user
      ? "signed_in"
      : hasPriorLocalProgress()
        ? "returning_guest"
        : "new";

    const totalMastered = readTotalMasteredCount();
    const progressBucket: ProgressBucket = toProgressBucket(totalMastered);

    track("app_open", { userType, progressBucket });
  }, [loading, user]);

  return null;
}
