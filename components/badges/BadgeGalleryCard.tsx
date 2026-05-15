import type { BadgeDefinition } from "@/lib/badges/catalog";

type Props = {
  badge: BadgeDefinition;
  earned: boolean;
};

/**
 * A single tile in the gym-badge gallery on the Stats page (#539).
 *
 * Earned badges show full-colour artwork (the star + name in amber).
 * Locked badges show a greyscale silhouette (the star in zinc) and the
 * badge's `lockedHint` text in place of the description — evocative but
 * non-spoiler.
 *
 * Accessibility: the accessible name is "${name} — earned" or
 * "${hint} — Locked" so screen readers communicate both state and content
 * without redundant visible text.
 */
export function BadgeGalleryCard({ badge, earned }: Props) {
  if (earned) {
    return (
      <li
        aria-label={`${badge.name} — earned`}
        className="flex flex-col items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-center dark:border-amber-800/60 dark:bg-amber-950/30"
      >
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-300 text-xl font-bold text-amber-950 dark:bg-amber-400"
        >
          ★
        </span>
        <span className="text-[11px] font-semibold leading-tight text-amber-900 dark:text-amber-200">
          {badge.name}
        </span>
      </li>
    );
  }

  return (
    <li
      aria-label={`${badge.lockedHint} — Locked`}
      className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-center dark:border-zinc-800 dark:bg-zinc-900/50"
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-200 text-xl font-bold text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"
      >
        ★
      </span>
      <span className="text-[11px] leading-tight text-zinc-400 dark:text-zinc-500">
        {badge.lockedHint}
      </span>
    </li>
  );
}
