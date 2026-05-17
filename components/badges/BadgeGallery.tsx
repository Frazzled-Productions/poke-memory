"use client";

import { useState } from "react";
import { BADGE_CATALOG, type BadgeDefinition } from "@/lib/badges/catalog";
import { BadgeGalleryCard } from "@/components/badges/BadgeGalleryCard";

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
};

/**
 * Gym-badge gallery for the Stats page (#539, #830). Earned badges are shown
 * by default; locked ones are hidden behind a "View all badges" toggle so the
 * gallery does not crowd out the mastery rings and charts further down the page.
 *
 * When `forceAllMastered` is true every badge renders as earned and no locked
 * section exists, so the toggle is hidden.
 *
 * Accessible: the toggle button carries aria-expanded and aria-controls so
 * screen readers can track the collapsed/expanded state.
 */
export function BadgeGallery({ earnedBadges, forceAllMastered = false }: Props) {
  const [lockedExpanded, setLockedExpanded] = useState(false);

  const earnedSet = new Set(earnedBadges.map((b) => b.id));

  const earned = forceAllMastered
    ? BADGE_CATALOG
    : BADGE_CATALOG.filter((b) => earnedSet.has(b.id));

  const locked = forceAllMastered
    ? []
    : BADGE_CATALOG.filter((b) => !earnedSet.has(b.id));

  const hasLocked = locked.length > 0;

  return (
    <section aria-labelledby="badge-gallery-heading">
      <h2
        id="badge-gallery-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        Gym badges
      </h2>

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
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
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
