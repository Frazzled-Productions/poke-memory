"use client";

import type { TypeStats } from "@/lib/stats/derive";
import { TYPE_COLORS } from "@/lib/pokemon/types";
import { MeterBar } from "@/components/ui/MeterBar";

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
 * filter — matches the Pokédex's existing intersection semantics.
 */
export function TypeBreakdown({ perType }: Props) {
  return (
    <section aria-labelledby="type-heading">
      <h2
        id="type-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        By type
      </h2>
      <ul
        role="list"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6"
      >
        {perType.map((t) => {
          const colors = TYPE_COLORS[t.type];
          const masteredPct = pct(t.mastered, t.total);
          return (
            <li
              key={t.type}
              className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-background p-3 dark:border-zinc-800"
            >
              <div className="flex items-center justify-between">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${colors?.bg ?? "bg-zinc-500"} ${colors?.text ?? "text-white"}`}
                >
                  {t.type}
                </span>
                <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                  {t.mastered}/{t.total}
                </span>
              </div>
              <MeterBar
                value={t.mastered}
                max={t.total}
                fillClass={colors?.bg ?? "bg-zinc-500"}
                label={`${masteredPct}% of ${t.type}-type Pokémon mastered`}
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
