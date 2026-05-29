"use client";

/**
 * Per-game mastery breakdown for the Stats page (issue #1313).
 *
 * Renders a bar-list showing mastered / total species and a percentage bar for
 * each version-group (game) in the seed. Games are grouped by generation and
 * sorted in release order, matching the Games scope picker.
 *
 * Styling follows the TypeBreakdown and TrainerCard conventions — `cardPanel`,
 * `sectionLabel`, `statValue` from `lib/utils/class-names`.
 */

import type { GameStats } from "@/lib/stats/perGame";
import { cardPanel, sectionLabel, statValue } from "@/lib/utils/class-names";

type Props = {
  games: readonly GameStats[];
};

const GEN_LABELS: Record<number, string> = {
  0: "Other",
  1: "Generation I",
  2: "Generation II",
  3: "Generation III",
  4: "Generation IV",
  5: "Generation V",
  6: "Generation VI",
  7: "Generation VII",
  8: "Generation VIII",
  9: "Generation IX",
};

function pct(num: number, den: number): number {
  return den === 0 ? 0 : Math.round((num / den) * 100);
}

/**
 * A single game row: label, bar, and fraction/percentage.
 */
function GameRow({ game }: { game: GameStats }) {
  const masteredPct = pct(game.mastered, game.total);
  const complete = game.total > 0 && game.mastered === game.total;

  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="text-sm font-medium text-foreground leading-snug"
          title={game.label}
        >
          {game.label}
        </span>
        <span
          className={`shrink-0 text-xs tabular-nums ${complete ? "text-emerald-600 dark:text-emerald-400 font-semibold" : statValue}`}
          aria-label={`${game.mastered} of ${game.total} mastered`}
        >
          {game.mastered}/{game.total}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
          role="progressbar"
          aria-valuenow={masteredPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${masteredPct}% of ${game.label} mastered`}
        >
          <div
            className={`h-full rounded-full transition-all ${complete ? "bg-emerald-500 dark:bg-emerald-400" : "bg-blue-500 dark:bg-blue-400"}`}
            style={{ width: `${masteredPct}%` }}
          />
        </div>
        <span className={`w-8 text-right text-xs tabular-nums ${statValue}`} aria-hidden="true">
          {masteredPct}%
        </span>
      </div>
    </li>
  );
}

/**
 * Group the flat GameStats array by generation bucket for the accordion layout.
 * Generation 0 ("Other") is placed last.
 */
function groupByGeneration(games: readonly GameStats[]): [number, GameStats[]][] {
  const map = new Map<number, GameStats[]>();
  for (const g of games) {
    if (!map.has(g.generation)) map.set(g.generation, []);
    map.get(g.generation)!.push(g);
  }
  return [...map.entries()].sort((a, b) => {
    if (a[0] === 0) return 1;
    if (b[0] === 0) return -1;
    return a[0] - b[0];
  });
}

/**
 * Per-game mastery breakdown. Shows a progress bar list grouped by generation,
 * with mastered/total counts and percentages per game. Renders nothing (null)
 * when the games array is empty (no versionGroups seeded).
 */
export function PerGameMastery({ games }: Props) {
  if (games.length === 0) return null;

  const grouped = groupByGeneration(games);

  return (
    <section aria-labelledby="per-game-heading">
      <h2
        id="per-game-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        By game
      </h2>
      <div className={`${cardPanel} flex flex-col gap-5`}>
        {grouped.map(([gen, genGames]) => (
          <div key={gen}>
            <p className={`${sectionLabel} mb-2`}>
              {GEN_LABELS[gen] ?? "Other"}
            </p>
            <ul className="flex flex-col gap-3" role="list">
              {genGames.map((game) => (
                <GameRow key={game.slug} game={game} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
