/**
 * Streak milestone days (in calendar days reviewed in-a-row).
 *
 * Tuned so the early ones come fast enough to hook a new user (3, 7) and
 * later ones feel like real accomplishments (100, 365). Avoid more than ~6
 * total — celebrations should feel rare, not periodic.
 */
export const STREAK_MILESTONES: readonly number[] = [3, 7, 14, 30, 100, 365];

/**
 * Smallest milestone <= `streak` that the user has not yet celebrated.
 * Returns null when the streak has not yet reached the next milestone, or
 * when every milestone reached is already in `seen`.
 *
 * Picks the smallest un-seen milestone (not the largest) so a user who
 * misses a celebration day still gets a celebration the next time they
 * open the app — but only one celebration per session, with the larger
 * milestone deferred to the next reload.
 */
export function findPendingMilestone(
  streak: number,
  seen: readonly number[],
): number | null {
  const seenSet = new Set(seen);
  for (const m of STREAK_MILESTONES) {
    if (streak < m) return null;
    if (!seenSet.has(m)) return m;
  }
  return null;
}
