/**
 * Streak milestone days (in calendar days reviewed in-a-row).
 *
 * The early ramp hooks new users quickly (3, 7, 14, 30). Gaps are then
 * kept to ~115 days or fewer so consistent users stay celebrated (60, 100,
 * 150, 200, 250, 365). After 365, a milestone fires every 100 days (465,
 * 565, …) so the tail is unbounded and no gap exceeds ~115 days.
 */
export const STREAK_MILESTONES: readonly number[] = [
  3, 7, 14, 30, 60, 100, 150, 200, 250, 365,
];

/**
 * Celebration tier for a streak milestone. Controls confetti density,
 * banner styling, and copy.
 *
 * - `light`    — 3, 7, 14: early hook milestones, gentle celebration.
 * - `standard` — 30, 60, 100, 150, 200, 250: consistent-user milestones.
 * - `major`    — 365 and every post-365 milestone (465, 565, …): rare,
 *               maximum celebration.
 */
export type MilestoneTier = "light" | "standard" | "major";

/** The interval (days) between auto-generated milestones beyond 365. */
export const POST_365_INTERVAL = 100;

/**
 * Returns the celebration tier for a given milestone day count.
 *
 * - 3 / 7 / 14 → `light`
 * - 30 / 60 / 100 / 150 / 200 / 250 → `standard`
 * - 365 and every post-365 milestone → `major`
 */
export function tierForMilestone(milestone: number): MilestoneTier {
  if (milestone < 30) return "light";
  if (milestone < 365) return "standard";
  return "major";
}

/**
 * Smallest milestone <= `streak` that the user has not yet celebrated.
 * Returns null when the streak has not yet reached the next milestone, or
 * when every milestone reached is already in `seen`.
 *
 * Picks the smallest un-seen milestone (not the largest) so a user who
 * misses a celebration day still gets a celebration the next time they
 * open the app — but only one celebration per session, with the larger
 * milestone deferred to the next reload.
 *
 * For streaks beyond 365, milestones are generated every 100 days (465,
 * 565, …) rather than stored in a static array.
 */
export function findPendingMilestone(
  streak: number,
  seen: readonly number[],
): number | null {
  const seenSet = new Set(seen);

  // Walk the static milestones first.
  for (const m of STREAK_MILESTONES) {
    if (streak < m) return null;
    if (!seenSet.has(m)) return m;
  }

  // All static milestones reached and seen — check the post-365 tail.
  const lastStatic = STREAK_MILESTONES[STREAK_MILESTONES.length - 1]; // 365
  if (streak <= lastStatic) return null;

  // Find the smallest post-365 milestone the user has reached but not seen.
  const firstPost = lastStatic + POST_365_INTERVAL; // 465
  // Scan from the first post-365 milestone up to the current streak.
  for (let m = firstPost; m <= streak; m += POST_365_INTERVAL) {
    if (!seenSet.has(m)) return m;
  }

  return null;
}
