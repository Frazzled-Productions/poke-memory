import { isoDate } from "@/lib/utils/format-date";

/**
 * Step back `n` days from a `YYYY-MM-DD` string and return the result in the
 * same format. Uses the same local-time `setDate` + UTC `toISOString` pattern
 * that the SRS scheduler and due-forecast code use, so calendar boundaries
 * line up across the codebase.
 *
 * Shared by `lib/stats/accuracy.ts` and `lib/stats/retention.ts` so they
 * cannot drift independently.
 */
export function isoMinusDays(today: string, n: number): string {
  const result = new Date(today);
  result.setDate(result.getDate() - n);
  return isoDate(result);
}
