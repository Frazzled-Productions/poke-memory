"use client";

import { useTranslations } from "next-intl";
import type { TypeStats } from "@/lib/stats/derive";
import { TYPE_COLORS } from "@/lib/pokemon/types";
import { MeterBar } from "@/components/ui/MeterBar";
import { getTypeName } from "@/lib/i18n/typeNames";
import { colStack, mutedTextXs } from "@/lib/utils/class-names";

type Props = {
  perType: readonly TypeStats[];
};

function pct(num: number, den: number): number {
  return den === 0 ? 0 : Math.round((num / den) * 100);
}

/**
 * 18-cell grid showing mastered/total per type. Cells reuse the same
 * `TYPE_COLORS` palette as the Pokédex filter chips, so the colour
 * vocabulary is consistent across pages.
 *
 * Counts agree with the per-type filter on `/pokedex`: a dual-type card
 * appears in both buckets here and is also matched by either type's
 * filter - matches the Pokédex's existing intersection semantics.
 */
export function TypeBreakdown({ perType }: Props) {
  const tTB = useTranslations("stats.typeBreakdown");
  const tTypes = useTranslations("types");

  return (
    <section aria-labelledby="type-heading">
      <h2
        id="type-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        {tTB("heading")}
      </h2>
      <ul
        role="list"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6"
      >
        {perType.map((typeStats) => {
          const colors = TYPE_COLORS[typeStats.type];
          const masteredPct = pct(typeStats.mastered, typeStats.total);
          const typeName = getTypeName(typeStats.type, tTypes);
          return (
            <li
              key={typeStats.type}
              className={`${colStack} rounded-xl border border-zinc-200 bg-background p-3 dark:border-zinc-800`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors?.bg ?? "bg-zinc-500"} ${colors?.text ?? "text-white"}`}
                >
                  {typeName}
                </span>
                <span className={`tabular-nums ${mutedTextXs}`}>
                  {typeStats.mastered}/{typeStats.total}
                </span>
              </div>
              <MeterBar
                value={typeStats.mastered}
                max={typeStats.total}
                fillClass={colors?.bg ?? "bg-zinc-500"}
                label={tTB("meterAriaLabel", { masteredPct, typeName })}
                trackClass="dark:bg-zinc-800"
                transitionClass=""
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
