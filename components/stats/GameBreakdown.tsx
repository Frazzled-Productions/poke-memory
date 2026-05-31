"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { GameStats } from "@/lib/stats/per-game";
import {
  versionGroupLabel,
  versionGroupGeneration,
  VERSION_GROUP_ORDER,
} from "@/lib/pokemon/versionGroupLabels";
import { mutedText, colStack, mutedTextXs } from "@/lib/utils/class-names";
import { MeterBar } from "@/components/ui/MeterBar";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(num: number, den: number): number {
  return den === 0 ? 0 : Math.round((num / den) * 100);
}

// ---------------------------------------------------------------------------
// Row sub-component
// ---------------------------------------------------------------------------

function GameRow({ row }: { row: GameStats }) {
  const masteredPct = pct(row.mastered, row.total);
  const label = versionGroupLabel(row.slug);

  return (
    <li className="flex flex-col gap-1 py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-foreground leading-snug">{label}</span>
        <span className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {row.mastered}/{row.total}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <MeterBar
          value={row.mastered}
          max={row.total}
          fillClass="bg-emerald-500 dark:bg-emerald-400"
          label={`${label}: ${row.mastered} of ${row.total} mastered (${masteredPct}%)`}
          transitionClass="transition-all duration-300"
          className="flex-1"
        />
        <span className="w-9 text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {masteredPct}%
        </span>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Generation group accordion
// ---------------------------------------------------------------------------

type GenGroup = {
  gen: number;
  rows: GameStats[];
};

/** Map a numeric generation to its i18n key in stats.gameBreakdown. */
const GEN_KEY: Record<number, string> = {
  1: "gen1",
  2: "gen2",
  3: "gen3",
  4: "gen4",
  5: "gen5",
  6: "gen6",
  7: "gen7",
  8: "gen8",
  9: "gen9",
  0: "genOther",
};

function GenAccordion({ group }: { group: GenGroup }) {
  const t = useTranslations("stats");
  const tG = useTranslations("stats.gameBreakdown");
  const [open, setOpen] = useState(false);
  const genKey = GEN_KEY[group.gen];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- key is string from known map
  const genName: string = genKey ? tG(genKey as any) : `Generation ${group.gen}`;
  const totalMastered = group.rows.reduce((s, r) => s + r.mastered, 0);
  const totalSpecies = group.rows.reduce((s, r) => s + r.total, 0);
  const uniqueGames = group.rows.length;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left bg-background hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-inset"
      >
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-semibold text-foreground">{genName}</span>
          <span className={mutedTextXs}>
            {t("gameCount", { count: uniqueGames })} · {tG("speciesMastered", { mastered: totalMastered, total: totalSpecies })}
          </span>
        </div>
        <svg
          aria-hidden="true"
          className={`shrink-0 w-4 h-4 text-zinc-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <ul
          role="list"
          className="px-4 pb-1 bg-background"
          aria-label={tG("gameListAriaLabel", { name: genName })}
        >
          {group.rows.map((row) => (
            <GameRow key={row.slug} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GameBreakdown — public component
// ---------------------------------------------------------------------------

type Props = {
  perGame: readonly GameStats[];
};

/**
 * Renders per-game mastery progress as an accordion grouped by generation.
 * Each generation can be expanded to reveal individual game rows with a
 * mastery progress bar.
 *
 * Data comes from `computePerGameStats` in `lib/stats/per-game.ts`.
 */
export function GameBreakdown({ perGame }: Props) {
  const tG = useTranslations("stats.gameBreakdown");

  // Sort rows by VERSION_GROUP_ORDER, then group by generation.
  const orderIndex = new Map<string, number>(
    VERSION_GROUP_ORDER.map((slug, i) => [slug, i]),
  );

  const sorted = [...perGame].sort((a, b) => {
    const genA = versionGroupGeneration(a.slug);
    const genB = versionGroupGeneration(b.slug);
    if (genA !== genB) {
      // Generation 0 (other/spin-off) sorts last.
      if (genA === 0) return 1;
      if (genB === 0) return -1;
      return genA - genB;
    }
    const idxA = orderIndex.get(a.slug) ?? 9999;
    const idxB = orderIndex.get(b.slug) ?? 9999;
    return idxA - idxB;
  });

  // Group by generation.
  const groups: GenGroup[] = [];
  for (const row of sorted) {
    const gen = versionGroupGeneration(row.slug);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.gen === gen) {
      last.rows.push(row);
    } else {
      groups.push({ gen, rows: [row] });
    }
  }

  if (groups.length === 0) {
    return (
      <section aria-labelledby="game-breakdown-heading">
        <h2
          id="game-breakdown-heading"
          className="mb-3 text-base font-semibold text-foreground"
        >
          {tG("heading")}
        </h2>
        <p className={mutedText}>
          {tG("noData")}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="game-breakdown-heading">
      <h2
        id="game-breakdown-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        {tG("heading")}
      </h2>
      <div className={colStack} role="list" aria-label={tG("listAriaLabel")}>
        {groups.map((group) => (
          <div key={group.gen} role="listitem">
            <GenAccordion group={group} />
          </div>
        ))}
      </div>
    </section>
  );
}
