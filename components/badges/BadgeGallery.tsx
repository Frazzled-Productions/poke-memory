"use client";

import { useState } from "react";
import { BADGE_CATALOG, type BadgeDefinition } from "@/lib/badges/catalog";
import { BadgeGalleryCard } from "@/components/badges/BadgeGalleryCard";
import { cn } from "@/lib/utils/cn";
import { mutedText } from "@/lib/utils/class-names";

type Props = {
  /**
   * The badge definitions that the user has already earned (in catalog order).
   * When `forceAllMastered` is true this should be the full catalog so every
   * tile renders earned — the superuser flag is honoured upstream by the caller.
   */
  earnedBadges: readonly BadgeDefinition[];
  /**
   * When true, every badge in the catalog is rendered as earned regardless
   * of `earnedBadges`. Wires into the `pretendAllMastered` superuser flag
   * per the AGENTS.md superuser-mode convention.
   */
  forceAllMastered?: boolean;
  /**
   * The set of species IDs the user has currently mastered (name-card
   * mastery). Used to compute the "Next badge" proximity hint. When omitted
   * or when `forceAllMastered` is true, no hint is rendered.
   */
  masteredSpeciesIds?: ReadonlySet<number>;
};

/**
 * Returns the unearned badge closest to being unlocked and how many more
 * species the user needs to master. Picks the badge with the fewest
 * remaining species; ties are broken by catalog order (first wins).
 *
 * Returns `null` when all badges are earned or no catalog entries exist.
 */
function findNextBadge(
  catalog: readonly BadgeDefinition[],
  earnedIds: ReadonlySet<string>,
  mastered: ReadonlySet<number>,
): { badge: BadgeDefinition; remaining: number } | null {
  let best: { badge: BadgeDefinition; remaining: number } | null = null;
  for (const badge of catalog) {
    if (earnedIds.has(badge.id)) continue;
    const remaining = badge.criterion.speciesIds.filter(
      (id) => !mastered.has(id),
    ).length;
    if (remaining === 0) continue; // about to be awarded — skip
    if (best === null || remaining < best.remaining) {
      best = { badge, remaining };
    }
  }
  return best;
}

/**
 * Gym-badge gallery for the Journey page (#539, #830, #993). Earned badges
 * are shown by default; locked ones are hidden behind a "View all badges"
 * toggle so the gallery does not crowd out the mastery rings and charts
 * further down the page.
 *
 * When `forceAllMastered` is true every badge renders as earned and no locked
 * section exists, so the toggle is hidden.
 *
 * When `masteredSpeciesIds` is provided (and `forceAllMastered` is false), a
 * proximity hint is shown above the badge grid naming the nearest unearned
 * badge and how many more Pokémon need to be mastered to unlock it.
 *
 * Accessible: the toggle button carries aria-expanded and aria-controls so
 * screen readers can track the collapsed/expanded state.
 */
export function BadgeGallery({
  earnedBadges,
  forceAllMastered = false,
  masteredSpeciesIds,
}: Props) {
  const [lockedExpanded, setLockedExpanded] = useState(false);

  const earnedSet = new Set(earnedBadges.map((b) => b.id));

  const earned = forceAllMastered
    ? BADGE_CATALOG
    : BADGE_CATALOG.filter((b) => earnedSet.has(b.id));

  const locked = forceAllMastered
    ? []
    : BADGE_CATALOG.filter((b) => !earnedSet.has(b.id));

  const hasLocked = locked.length > 0;

  // Proximity hint: only when the caller provides mastered species data and
  // the superuser flag is off (forceAllMastered would make all badges earned).
  const nextBadge =
    !forceAllMastered && masteredSpeciesIds !== undefined
      ? findNextBadge(BADGE_CATALOG, earnedSet, masteredSpeciesIds)
      : null;

  return (
    <section aria-labelledby="badge-gallery-heading">
      <h2
        id="badge-gallery-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        Gym badges
      </h2>

      {nextBadge !== null && (
        <p
          data-testid="next-badge-hint"
          className={cn("mb-3", mutedText)}
        >
          <span className="font-medium text-foreground">Next badge:</span>{" "}
          {nextBadge.badge.name},{" "}
          {nextBadge.remaining === 1
            ? "1 more Pokémon to master"
            : `${nextBadge.remaining} more Pokémon to master`}
        </p>
      )}

      {earned.length > 0 ? (
        <ul
          role="list"
          className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5"
          aria-label="Earned gym badges"
        >
          {earned.map((badge) => (
            <BadgeGalleryCard key={badge.id} badge={badge} earned />
          ))}
        </ul>
      ) : (
        <p className={mutedText}>
          No badges earned yet. Keep mastering Pokémon to unlock your first gym badge!
        </p>
      )}

      {hasLocked && (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={lockedExpanded}
            aria-controls="badge-gallery-locked"
            onClick={() => setLockedExpanded((prev) => !prev)}
            className="flex items-center gap-1.5 rounded px-1 py-0.5 text-sm text-zinc-500 underline-offset-2 hover:text-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            <span
              aria-hidden="true"
              className={`inline-block transition-transform duration-200 ${lockedExpanded ? "rotate-90" : ""}`}
            >
              &#9658;
            </span>
            {lockedExpanded
              ? `Hide locked badges (${locked.length})`
              : `View all badges (${locked.length} locked)`}
          </button>

          {/* Always rendered so aria-controls references a real element; hidden attribute hides it when collapsed. */}
          <ul
            id="badge-gallery-locked"
            role="list"
            hidden={!lockedExpanded}
            className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5"
            aria-label="Locked gym badges"
          >
            {locked.map((badge) => (
              <BadgeGalleryCard key={badge.id} badge={badge} earned={false} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
