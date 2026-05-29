"use client";

/**
 * "Next arrivals" preview strip for the Pasture page (#1316).
 *
 * Shows up to 5 unmastered-but-seen species that are closest to joining the
 * Pasture, ranked by highest reps + nearest due date. Motivational "almost
 * there" nudge below the biome grid.
 *
 * Superuser behaviour: when pretendAllMastered is active, every species is
 * already mastered so there are no upcoming arrivals. The strip renders an
 * all-caught-up message in that state — this is correct and deliberate.
 */

import Image from "next/image";
import type { NextArrival } from "@/lib/pasture/nextArrivals";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";
import { PASTURE_SPRITE_SIZE } from "@/lib/sprites/sizes";

// ---------------------------------------------------------------------------
// Individual arrival tile
// ---------------------------------------------------------------------------

type ArrivalTileProps = {
  arrival: NextArrival;
};

function ArrivalTile({ arrival }: ArrivalTileProps) {
  const { name } = useLocalePokemonName(arrival.speciesId, arrival.name);

  return (
    <li className="flex flex-col items-center gap-1">
      <div className="relative">
        <Image
          src={arrival.spriteUrl}
          alt={name}
          width={PASTURE_SPRITE_SIZE}
          height={PASTURE_SPRITE_SIZE}
          className="h-14 w-14 object-contain opacity-60 grayscale"
          loading="lazy"
          priority={false}
        />
        {/* Reps badge */}
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-600 text-[10px] font-bold leading-none text-white dark:bg-zinc-400 dark:text-zinc-900"
        >
          {arrival.state.reps}
        </span>
      </div>
      <span className="max-w-[56px] truncate text-center text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
        {name}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Strip
// ---------------------------------------------------------------------------

type Props = {
  arrivals: NextArrival[];
};

/**
 * Renders a compact horizontal row of up to 5 upcoming Pasture species.
 *
 * When arrivals is empty (either no reviewed species or superuser
 * pretendAllMastered is on), an all-caught-up message is shown instead.
 */
export function NextArrivalsStrip({ arrivals }: Props) {
  return (
    <section
      aria-label="Next arrivals"
      className="mt-8 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4 dark:border-zinc-700 dark:bg-zinc-900/50"
    >
      <h2 className="mb-3 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
        Next arrivals
      </h2>

      {arrivals.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          All reviewed Pokémon are already in your Pasture.
        </p>
      ) : (
        <ol
          aria-label="Upcoming Pasture species"
          className="flex flex-wrap gap-4"
        >
          {arrivals.map((arrival) => (
            <ArrivalTile key={arrival.id} arrival={arrival} />
          ))}
        </ol>
      )}
    </section>
  );
}
