import type { BadgeDefinition } from "@/lib/badges/catalog";

/**
 * Pure award-check. Returns the badge definitions whose criterion is now
 * satisfied AND that are not yet in `alreadyEarned`. Order matches the
 * order in `catalog`. Safe to call O(grades-that-mastered-a-card) times
 * per session.
 */
export function checkBadges(
  masteredSpeciesIds: ReadonlySet<number>,
  catalog: readonly BadgeDefinition[],
  alreadyEarned: ReadonlySet<string>,
): BadgeDefinition[] {
  const newlyEarned: BadgeDefinition[] = [];
  for (const badge of catalog) {
    if (alreadyEarned.has(badge.id)) continue;
    if (criterionMet(badge.criterion.speciesIds, masteredSpeciesIds)) {
      newlyEarned.push(badge);
    }
  }
  return newlyEarned;
}

function criterionMet(
  required: readonly number[],
  mastered: ReadonlySet<number>,
): boolean {
  if (required.length === 0) return false;
  for (const id of required) {
    if (!mastered.has(id)) return false;
  }
  return true;
}
