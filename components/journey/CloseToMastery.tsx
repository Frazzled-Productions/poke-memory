"use client";

/**
 * CloseToMastery - "Focus here next" section on the Journey page.
 *
 * Shows species where the name card has cleared the mastery gate
 * (stability >= MASTERY_STABILITY_DAYS) but the paired reverse card has not
 * yet reached that bar.
 *
 * Derived via the pure `deriveCloseToMastery` helper in lib/journey/; this
 * component handles rendering only.
 *
 * Superuser: when forceAllMastered is on the list is always empty (the
 * helper returns [] and we show the empty state).
 */

import Image from "next/image";
import { useTranslations } from "next-intl";
import type { CloseToMasteryEntry } from "@/lib/journey/closeToMastery";
import { MASTERY_INTERVAL_DAYS } from "@/lib/stats/derive";
import { STATS_SPRITE_SIZE } from "@/lib/sprites/sizes";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";
import { cn } from "@/lib/utils/cn";
import { mutedText } from "@/lib/utils/class-names";
import { MeterBar } from "@/components/ui/MeterBar";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of entries displayed. Remaining entries are noted in the footer. */
const INITIAL_VISIBLE = 10;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// IntervalBar replaced by MeterBar from @/components/ui/MeterBar.
// The accessible label comes from the progressLabel string passed as the
// `label` prop to MeterBar.

/** A single row in the close-to-mastery list. */
function CloseToMasteryRow({ entry }: { entry: CloseToMasteryEntry }) {
  const tWidget = useTranslations("journey.closeToMasteryWidget");
  const { name } = useLocalePokemonName(entry.speciesId, entry.englishName);

  const daysRemaining = Math.max(
    0,
    MASTERY_INTERVAL_DAYS - entry.reverseScheduledDays,
  );

  const progressLabel = entry.reverseIntroduced
    ? tWidget("progressLabel", { current: entry.reverseScheduledDays, max: MASTERY_INTERVAL_DAYS })
    : tWidget("notStartedLabel");

  return (
    <li className="flex items-center gap-3 py-2">
      {/* Sprite */}
      <div className="shrink-0" aria-hidden="true">
        <Image
          src={entry.spriteUrl}
          alt=""
          width={STATS_SPRITE_SIZE}
          height={STATS_SPRITE_SIZE}
          className="object-contain"
          loading="lazy"
        />
      </div>

      {/* Name + progress */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        <div className="mt-1 flex items-center gap-2">
          <MeterBar
            value={Math.min(MASTERY_INTERVAL_DAYS, Math.max(0, entry.reverseScheduledDays))}
            max={MASTERY_INTERVAL_DAYS}
            fillClass="bg-amber-400 dark:bg-amber-500"
            label={progressLabel}
            transitionClass="transition-[width]"
            className="w-20"
          />
          {/* aria-hidden: the meter's aria-label already carries the "Xd of 21d"
              semantic; hiding the visual "Xd" avoids double announcement. */}
          <span className={cn("text-xs tabular-nums", mutedText)} aria-hidden="true">
            {entry.reverseIntroduced
              ? `${entry.reverseScheduledDays}d`
              : tWidget("notStarted")}
          </span>
        </div>
      </div>

      {/* Days remaining badge */}
      <div className="shrink-0 text-right">
        {entry.reverseIntroduced ? (
          <span
            className={cn(
              "text-xs font-medium tabular-nums",
              daysRemaining === 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400",
            )}
            aria-label={
              daysRemaining === 0
                ? tWidget("readyForMastery")
                : tWidget("daysNeeded", { days: daysRemaining })
            }
          >
            {daysRemaining === 0 ? tWidget("ready") : `-${daysRemaining}d`}
          </span>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// CloseToMastery
// ---------------------------------------------------------------------------

export function CloseToMastery({
  entries,
}: {
  entries: readonly CloseToMasteryEntry[];
}) {
  const tWidget = useTranslations("journey.closeToMasteryWidget");
  const visible = entries.slice(0, INITIAL_VISIBLE);
  const hasMore = entries.length > INITIAL_VISIBLE;

  return (
    <section aria-labelledby="close-to-mastery-heading">
      <h3
        id="close-to-mastery-heading"
        className="mb-1 text-base font-semibold text-foreground"
      >
        {tWidget("heading")}
      </h3>

      {entries.length > 0 && (
        <p className={cn("mb-3 text-sm", mutedText)}>
          {tWidget("body")}{" "}
          {tWidget.rich("speciesToGo", {
            count: entries.length,
            em: (chunks) => (
              <span className="font-semibold tabular-nums text-foreground">
                {chunks}
              </span>
            ),
          })}
        </p>
      )}

      {entries.length === 0 ? (
        <p className={cn("py-4 text-center text-sm", mutedText)}>
          {tWidget("emptyState")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
          <ul
            role="list"
            aria-label={tWidget("listAriaLabel")}
            className="divide-y divide-zinc-100 px-3 dark:divide-zinc-800"
          >
            {visible.map((entry) => (
              <CloseToMasteryRow key={entry.speciesId} entry={entry} />
            ))}
          </ul>
          {hasMore && (
            <p className="border-t border-zinc-100 px-4 py-2.5 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
              {tWidget("showingOf", { shown: INITIAL_VISIBLE, total: entries.length })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
