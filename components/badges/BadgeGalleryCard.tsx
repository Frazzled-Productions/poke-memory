import Image from "next/image";
import { useTranslations } from "next-intl";
import type { BadgeDefinition } from "@/lib/badges/catalog";
import { BADGE_ICON_SIZE } from "@/lib/badges/artwork";

type Props = {
  badge: BadgeDefinition;
  earned: boolean;
};

/**
 * A single tile in the gym-badge gallery on the Journey page (#539, #830, #831).
 *
 * Earned badges show the badge's full-colour 8-bit pixel-art medallion.
 * Locked badges show the same artwork as a greyed silhouette (grayscale
 * filter + reduced opacity) rather than the artwork or name being visible -
 * the badge's `lockedHint` text is shown in place of the description, so the
 * shape is a non-spoiler tease while the badge itself stays secret until
 * earned (#420).
 *
 * Accessibility: the accessible name is "${name}, earned" or
 * "${name} (locked): ${hint}" so screen readers always have the badge name
 * to anchor on, regardless of lock state - set via `aria-label` on the `<li>`.
 * The artwork `<Image>` itself is `aria-hidden` (its meaning is fully carried
 * by the `<li>`'s label) EXCEPT that a locked badge's image alt text must
 * never repeat the badge name (that would leak the secret to a screen-reader
 * user reading the image node in isolation), so locked artwork uses a
 * generic, non-spoiler alt string instead of `aria-hidden`.
 */
export function BadgeGalleryCard({ badge, earned }: Props) {
  const t = useTranslations("journey.badges");

  if (earned) {
    return (
      <li
        aria-label={`${badge.name}, earned`}
        className="flex flex-col items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-center dark:border-amber-800/60 dark:bg-amber-950/30"
      >
        <Image
          src={badge.artwork}
          alt={t("earnedArtworkAlt", { name: badge.name })}
          width={BADGE_ICON_SIZE}
          height={BADGE_ICON_SIZE}
          className="h-10 w-10"
        />
        <span className="text-[11px] font-semibold leading-tight text-amber-900 dark:text-amber-200">
          {badge.name}
        </span>
      </li>
    );
  }

  return (
    <li
      aria-label={`${badge.name} (locked): ${badge.lockedHint}`}
      className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-center dark:border-zinc-800 dark:bg-zinc-900/50"
    >
      <Image
        src={badge.artwork}
        alt={t("lockedArtworkAlt")}
        width={BADGE_ICON_SIZE}
        height={BADGE_ICON_SIZE}
        className="h-10 w-10 grayscale opacity-50"
      />
      <span className="text-[11px] leading-tight text-zinc-400 dark:text-zinc-500">
        {badge.lockedHint}
      </span>
    </li>
  );
}
