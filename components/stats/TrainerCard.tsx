"use client";

import type { GenerationStats } from "@/lib/stats/derive";
import type { BadgeDefinition } from "@/lib/badges/catalog";

type Props = {
  handle: string | null;
  totalMastered: number;
  perGeneration: readonly GenerationStats[];
  /**
   * Gym badges (#420) the user has earned. Optional so existing tests that
   * predate the prop still render the component without setup. When empty
   * or omitted, the badge rail is not rendered — unearned badges must
   * not be hinted at anywhere in the UI.
   */
  earnedBadges?: readonly BadgeDefinition[];
};

/**
 * Trainer level: pinned to total mastered count via a square-root curve.
 * Picks 16 as the scaling constant so the early game feels rewarding
 * (10 mastered → level 5, 100 mastered → level 16, 1025 mastered → level 51).
 * Deterministic and pure — no persistence needed.
 */
export function trainerLevel(mastered: number): number {
  if (mastered <= 0) return 1;
  return Math.max(1, Math.floor(Math.sqrt(mastered) * 1.6));
}

/** Inverse of trainerLevel: mastered count needed to reach level + 1. */
export function nextLevelMastered(level: number): number {
  return Math.ceil(((level + 1) / 1.6) ** 2);
}

const TOTAL_SPECIES = 1025;

const GEN_LABELS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];

export function TrainerCard({ handle, totalMastered, perGeneration, earnedBadges }: Props) {
  const level = trainerLevel(totalMastered);
  const next = nextLevelMastered(level);
  const needed = next - totalMastered;

  return (
    <section
      aria-label="Trainer card"
      className="rounded-xl border border-zinc-200 bg-gradient-to-r from-amber-50 via-rose-50 to-sky-50 p-4 dark:border-zinc-800 dark:from-amber-950/30 dark:via-rose-950/30 dark:to-sky-950/30"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Trainer
          </span>
          <span className="text-lg font-semibold text-foreground">
            {handle ?? "Trainer"}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Lv
          </span>
          <span
            className="text-3xl font-bold tabular-nums text-foreground"
            aria-describedby="trainer-level-desc"
          >
            {level}
          </span>
          <span id="trainer-level-desc" className="sr-only">
            Level grows with the number of Pokémon name cards you&apos;ve mastered
            (reps ≥ 3 and scheduled interval ≥ 21 days).
          </span>
        </div>
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {totalMastered >= TOTAL_SPECIES
          ? "All mastered"
          : `${totalMastered} / ${next} mastered · ${needed} to Lv ${level + 1}`}
      </p>
      <ul
        role="list"
        className="mt-3 flex flex-wrap gap-1.5"
        aria-label="Generation completion badges"
      >
        {perGeneration.map((gen, idx) => {
          const completed = gen.total > 0 && gen.mastered === gen.total;
          return (
            <li
              key={gen.gen}
              title={
                completed
                  ? `${gen.name}: complete!`
                  : `${gen.name}: ${gen.mastered}/${gen.total} mastered`
              }
              className={
                "flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums transition-colors " +
                (completed
                  ? "border-amber-400 bg-amber-300 text-amber-950 dark:border-amber-500 dark:bg-amber-400"
                  : "border-zinc-300 bg-zinc-100 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500")
              }
            >
              {GEN_LABELS[idx] ?? gen.gen}
            </li>
          );
        })}
      </ul>
      {earnedBadges && earnedBadges.length > 0 ? (
        <ul
          role="list"
          className="mt-3 flex flex-wrap gap-1.5"
          aria-label="Gym badges earned"
        >
          {earnedBadges.map((badge) => (
            <li
              key={badge.id}
              title={badge.description}
              className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/70 dark:text-amber-200"
            >
              <span aria-hidden="true">★</span>
              {badge.name}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
