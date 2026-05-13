"use client";

import type { HeatmapCell } from "@/lib/stats/heatmap";
import { intensityBucket } from "@/lib/stats/heatmap";

type Props = {
  /** 53 columns × 7 rows, oldest column first; today is in the rightmost column. */
  columns: readonly (readonly HeatmapCell[])[];
};

const CELL_SIZE = 10;
const CELL_GAP = 2;
const COLS = 53;
const ROWS = 7;

const INTENSITY_FILLS = [
  "fill-zinc-200 dark:fill-zinc-800",       // 0
  "fill-emerald-200 dark:fill-emerald-900", // 1
  "fill-emerald-400 dark:fill-emerald-700", // 2
  "fill-emerald-500 dark:fill-emerald-500", // 3
  "fill-emerald-600 dark:fill-emerald-300", // 4
] as const;

function formatTooltip(cell: HeatmapCell): string {
  const d = new Date(cell.date + "T00:00:00Z");
  const human = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${human} · ${cell.count} review${cell.count === 1 ? "" : "s"}`;
}

export function ReviewHeatmap({ columns }: Props) {
  const width = COLS * (CELL_SIZE + CELL_GAP) - CELL_GAP;
  const height = ROWS * (CELL_SIZE + CELL_GAP) - CELL_GAP;
  const total = columns.flat().reduce((s, c) => s + c.count, 0);

  return (
    <section aria-labelledby="heatmap-heading">
      <h2
        id="heatmap-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        Review activity
      </h2>
      <div className="rounded-xl border border-zinc-200 bg-background p-4 dark:border-zinc-800">
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
          {total.toLocaleString()} review{total === 1 ? "" : "s"} in the last year
        </p>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          className="block h-auto w-full"
          style={{ maxWidth: width }}
          role="img"
          aria-label={`Review activity heatmap for the last 365 days, ${total} total reviews`}
        >
          {columns.map((col, x) =>
            col.map((cell, y) => (
              <rect
                key={`${x}-${y}`}
                x={x * (CELL_SIZE + CELL_GAP)}
                y={y * (CELL_SIZE + CELL_GAP)}
                width={CELL_SIZE}
                height={CELL_SIZE}
                rx={2}
                ry={2}
                className={INTENSITY_FILLS[intensityBucket(cell.count)]}
              >
                <title>{formatTooltip(cell)}</title>
              </rect>
            )),
          )}
        </svg>
        <div className="mt-3 flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
          <span>Less</span>
          {INTENSITY_FILLS.map((cls, i) => (
            <svg key={i} width={10} height={10} aria-hidden="true">
              <rect width={10} height={10} rx={2} ry={2} className={cls} />
            </svg>
          ))}
          <span>More</span>
        </div>
      </div>
    </section>
  );
}
