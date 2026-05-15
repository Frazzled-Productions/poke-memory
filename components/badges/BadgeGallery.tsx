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
 * Full gym-badge gallery for the Stats page (#539). Shows every badge in
 * BADGE_CATALOG in order. Earned badges render in colour; locked ones show
 * a greyscale silhouette with a vague teaser hint.
 *
 * Rendered as a Server-Component-compatible pure function — no hooks, no
 * client-side state. The parent Stats page (already 'use client') drives
 * the earned/locked decision and passes it down.
 */
export function BadgeGallery({ earnedBadges, forceAllMastered = false }: Props) {
  const earnedSet = new Set(earnedBadges.map((b) => b.id));

  return (
    <section aria-labelledby="badge-gallery-heading">
      <h2
        id="badge-gallery-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        Gym badges
      </h2>
      <ul
        role="list"
        className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5"
        aria-label="Gym badge gallery"
      >
        {BADGE_CATALOG.map((badge) => (
          <BadgeGalleryCard
            key={badge.id}
            badge={badge}
            earned={forceAllMastered || earnedSet.has(badge.id)}
          />
        ))}
      </ul>
    </section>
  );
}
