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
 *   - "returning_guest" when any `poke-memory:` key is present in
 *     localStorage (indicating prior local progress) and the user is not
 *     signed in.
 *   - "new" when neither condition holds.
 *
 * `progressBucket` is derived from the mastered-species count cache
 * (`KEY_MASTERED_COUNT_BY_LOCALE`), the total across all locales. This is
 * a fast localStorage read with no card-array parse, consistent with the
 * approach used by `useProfileStatus`. Returns "0" when the cache is absent
 * or the total is zero, which is the correct value for a truly new user.
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
 * Read the total mastered-species count (sum across all locales) from the
 * localStorage cache. Returns 0 when the cache is absent or malformed.
 *
 * Re-uses the existing `readMasteredCountCache` single-source helper; does
 * not re-derive mastery from the card array.
 */
export function readTotalMasteredCount(): number {
  if (typeof window === "undefined") return 0;
  const counts = readMasteredCountCache();
  return counts.en + counts.ja + counts["zh-Hans"] + counts["zh-Hant"];
}

/**
 * Detect whether the current browser has any prior `poke-memory:` progress
 * in localStorage. A single key with a `poke-memory:` prefix that is not the
 * superuser key is treated as evidence of prior usage.
 *
 * We intentionally exclude the superuser key (`poke-memory:superuser`) to
 * avoid false-positives for users who have only unlocked the developer panel.
 *
 * Uses a prefix scan rather than checking a fixed key so new progress keys
 * added in future are automatically included.
 */
export function hasPriorLocalProgress(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const ls = window.localStorage;
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (
        key !== null &&
        key.startsWith("poke-memory:") &&
        // Exclude the superuser keys; those do not represent review progress.
        key !== "poke-memory:superuser" &&
        !key.startsWith("poke-memory:superuser:")
      ) {
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
