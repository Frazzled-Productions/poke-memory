/**
 * Shared date helpers for "YYYY-MM-DD" strings — the canonical date format
 * across persisted SRS state (per AGENTS.md). String-comparable, no
 * timezone math.
 *
 * Both functions use UTC to avoid local-TZ drift across negative-offset
 * timezones. This matches the convention in lib/stats/records.ts'
 * private `daysBetween`. The local-time variant exists in
 * lib/srs/scheduler.ts (`addDays`) for now-relative arithmetic; this
 * module is for already-ISO inputs where there is no `Date.now()` involved.
 */

/**
 * Number of whole days between two YYYY-MM-DD strings. Returns negative
 * values when `to` is earlier than `from`. Robust to DST / TZ since both
 * sides are parsed as UTC midnight.
 */
export function daysBetweenIsoDates(fromIso: string, toIso: string): number {
  const from = new Date(fromIso + "T00:00:00Z").getTime();
  const to = new Date(toIso + "T00:00:00Z").getTime();
  return Math.round((to - from) / 86_400_000);
}

/**
 * Returns `date + days` formatted as YYYY-MM-DD. Negative `days` shifts
 * backward. UTC math throughout — the result is independent of the
 * caller's timezone.
 */
export function addDaysToIsoDate(date: string, days: number): string {
  const result = new Date(date + "T00:00:00Z");
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
