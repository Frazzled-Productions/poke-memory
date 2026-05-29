"use client";

/**
 * Pasture "Next arrivals" strip (#1316).
 *
 * Shows up to 5 unmastered, reviewed species ranked by proximity to mastery
 * (highest reps + scheduled interval first). Uses the shared
 * `rankByMasteryProximity` helper so the ranking logic is not duplicated
 * between this strip and the Pokédex "Closest to mastery" sort.
 *
 * Hidden entirely when:
 *   - `forceAllMastered` is on (every species is already mastered)
 *   - No reviewed-but-unmastered species exist in the session
 */

import Image from "next/image";
import type { ReviewableCard } from "@/lib/review/session";
import { rankByMasteryProximity } from "@/lib/mastery/proximity";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";
import { PASTURE_ARRIVALS_SPRITE_SIZE } from "@/lib/sprites/sizes";

// ---------------------------------------------------------------------------
// Strip limit
// ---------------------------------------------------------------------------

const STRIP_LIMIT = 5;

// ---------------------------------------------------------------------------
// Individual tile
// ---------------------------------------------------------------------------

type TileProps = {
  id: number;
  name: string;
  spriteUrl: string;
};

function ArrivalTile({ id, name, spriteUrl }: TileProps) {
  const { name: displayName } = useLocalePokemonName(id, name);
  return (
    <li className="flex flex-col items-center gap-1">
      <Image
        src={spriteUrl}
        alt={displayName}
        width={PASTURE_ARRIVALS_SPRITE_SIZE}
        height={PASTURE_ARRIVALS_SPRITE_SIZE}
        className="h-12 w-12 object-contain"
        loading="lazy"
      />
      <span className="max-w-[64px] truncate text-center text-xs text-zinc-600 dark:text-zinc-400">
        {displayName}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Strip
// ---------------------------------------------------------------------------

type Props = {
  cards: readonly ReviewableCard[];
  masteryRepetitions: number;
  forceAllMastered: boolean;
};

export function NextArrivalsStrip({ cards, masteryRepetitions, forceAllMastered }: Props) {
  const upcoming = rankByMasteryProximity(cards, {
    masteryRepetitions,
    forceAllMastered,
    limit: STRIP_LIMIT,
  });

  if (upcoming.length === 0) return null;

  return (
    <section aria-label="Next arrivals" className="mt-8">
      <h2 className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
        Almost there
      </h2>
      <ul className="flex flex-wrap gap-4" aria-label="Species closest to mastery">
        {upcoming.map((entry) => (
          <ArrivalTile
            key={entry.id}
            id={entry.id}
            name={entry.name}
            spriteUrl={entry.spriteUrl}
          />
        ))}
      </ul>
    </section>
  );
}
