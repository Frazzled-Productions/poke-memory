/**
 * Count the current streak from an array of reviewed dates. Order and
 * duplicates don't matter — the function builds a Set internally.
 *
 * Grace window: if today has no entry but yesterday does, the streak is
 * still alive (the user hasn't reviewed yet today).
 */
export function computeStreak(dates: string[], today: string): number {
  if (dates.length === 0) return 0;

  const dateSet = new Set(dates);
  const yesterday = offsetDate(today, -1);
  const startDate = dateSet.has(today)
    ? today
    : dateSet.has(yesterday)
    ? yesterday
    : null;

  if (startDate === null) return 0;

  let count = 0;
  let cursor = startDate;

  while (dateSet.has(cursor)) {
    count++;
    cursor = offsetDate(cursor, -1);
  }

  return count;
}

function offsetDate(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
