"use client";

/**
 * CloseToMastery — "Close to mastery" section on the Journey page.
 *
 * Lists species where the name card has graduated past the 21-day interval
 * gate but the reverse card has not yet reached full mastery. Gives users a
 * concrete, prioritised focus list for closing the gap that opened when the
 * 0.10.22 mastery rule change required both directions to pass the gate.
 *
 * Hidden entirely when the list is empty.
 */

import Image from "next/image";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";
import type { MasteryGapEntry } from "@/lib/mastery/masteryGap";
import { STATS_SPRITE_SIZE } from "@/lib/sprites/sizes";
import { cardPanel, mutedText } from "@/lib/utils/class-names";
import { cn } from "@/lib/utils/cn";

// ---------------------------------------------------------------------------
// GapRow — single species row
// ---------------------------------------------------------------------------

function GapRow({ entry }: { entry: MasteryGapEntry }) {
  const { name } = useLocalePokemonName(entry.speciesId, entry.name);

  return (
    <li className="flex items-center gap-3 py-2">
      <div className="shrink-0">
        <Image
          src={entry.spriteUrl}
          alt={name}
          width={STATS_SPRITE_SIZE}
          height={STATS_SPRITE_SIZE}
          className="h-12 w-12 object-contain"
          loading="lazy"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        <p className={cn("truncate", mutedText)}>
          Reverse card not yet mastered
        </p>
      </div>
      {/* Progress hint: reverse card scheduled days as a compact badge */}
      {entry.reverseScheduledDays > 0 && (
        <div
          className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
          aria-label={`Reverse card interval: ${entry.reverseScheduledDays} days`}
        >
          {entry.reverseScheduledDays}d
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// CloseToMastery
// ---------------------------------------------------------------------------

type Props = {
  /** Output of computeMasteryGap. Empty array = section hidden. */
  entries: readonly MasteryGapEntry[];
};

export function CloseToMastery({ entries }: Props) {
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="close-to-mastery-heading">
      <h2
        id="close-to-mastery-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        Close to mastery
      </h2>
      <p className={cn("mb-3", mutedText)}>
        Name mastered, reverse card still in progress.
      </p>
      <div className={cardPanel}>
        <ul role="list" className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {entries.map((entry) => (
            <GapRow key={entry.speciesId} entry={entry} />
          ))}
        </ul>
      </div>
    </section>
  );
}
