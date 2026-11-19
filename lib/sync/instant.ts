/**
 * True when timestamp `a` is a later instant than `b`. Sync cursors stored
 * before the move to D1 hold PostgREST strings ("...56.789012+00:00",
 * "...56+00:00") while D1 returns "...56.789Z", so the strings of one instant
 * differ and must never be compared as text. Text that does not parse falls
 * back to a string comparison.
 */
export function isLaterInstant(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isNaN(ta) || Number.isNaN(tb) ? a > b : ta > tb;
}
