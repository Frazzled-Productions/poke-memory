import { addDaysToIsoDate } from "@/lib/utils/dates";

/**
 * Step back `n` days from a `YYYY-MM-DD` string and return the result in the
 * same format. Delegates to `addDaysToIsoDate`, which does the arithmetic
 * wholly in UTC (`setUTCDate` on a `T00:00:00Z` parse), so the result is
 * independent of the caller's timezone and stable across DST transitions.
 * The previous local-time `setDate` implementation went one day early and
 * skipped a calendar date entirely at every DST seam (#1853 / F25).
 *
 * Shared by `lib/stats/accuracy.ts` and `lib/stats/retention.ts` so they
 * cannot drift independently.
 */
export function isoMinusDays(today: string, n: number): string {
  return addDaysToIsoDate(today, -n);
}
