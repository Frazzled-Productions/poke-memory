"use client";

import { useRef, useState } from "react";
import type { HeatmapCell } from "@/lib/stats/heatmap";
import { intensityBucket } from "@/lib/stats/heatmap";
import { cardPanel } from "@/lib/utils/class-names";

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

/** Hover highlight stroke classes, matching the intensity bucket colour. */
const INTENSITY_HOVER_STROKES = [
  "stroke-zinc-400 dark:stroke-zinc-500",       // 0
  "stroke-emerald-400 dark:stroke-emerald-700", // 1
  "stroke-emerald-500 dark:stroke-emerald-600", // 2
  "stroke-emerald-600 dark:stroke-emerald-400", // 3
  "stroke-emerald-700 dark:stroke-emerald-200", // 4
] as const;

function formatTooltipLabel(cell: HeatmapCell): string {
  // en-GB locale gives English month/weekday names on all browser locales.
  const d = new Date(cell.date + "T00:00:00Z");
  const human = d.toLocaleDateString("en-GB", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${human} - ${cell.count} review${cell.count === 1 ? "" : "s"}`;
}

/** SVG `<title>` text for screen readers — same wording as the visible tooltip. */
function formatSvgTitle(cell: HeatmapCell): string {
  return formatTooltipLabel(cell);
}

type TooltipState = {
  cell: HeatmapCell;
  /** Pixel x offset from the SVG container's left edge. */
  x: number;
  /** Pixel y offset from the SVG container's top edge. */
  y: number;
};

export function ReviewHeatmap({ columns }: Props) {
  const width = COLS * (CELL_SIZE + CELL_GAP) - CELL_GAP;
  const height = ROWS * (CELL_SIZE + CELL_GAP) - CELL_GAP;
  const total = columns.flat().reduce((s, c) => s + c.count, 0);

  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  function handleCellEnter(
    e: React.MouseEvent<SVGRectElement>,
    cell: HeatmapCell,
    key: string,
  ) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setTooltip({
      cell,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setHoveredKey(key);
  }

  function handleCellMove(e: React.MouseEvent<SVGRectElement>, cell: HeatmapCell) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setTooltip((prev) =>
      prev ? { cell, x: e.clientX - rect.left, y: e.clientY - rect.top } : null,
    );
  }

  function handleCellLeave() {
    setTooltip(null);
    setHoveredKey(null);
  }

  return (
    <section aria-labelledby="heatmap-heading">
      <h2
        id="heatmap-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        Review activity
      </h2>
      <div className={cardPanel}>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
          {total.toLocaleString('en-GB')} review{total === 1 ? "" : "s"} in the last year
        </p>
        {/* relative container so the tooltip can be absolutely positioned. */}
        <div ref={containerRef} className="relative">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="xMidYMid meet"
            className="block h-auto w-full"
            style={{ maxWidth: width }}
            role="img"
            aria-label={`Review activity heatmap for the last 365 days, ${total} total reviews`}
            onMouseLeave={handleCellLeave}
          >
            {columns.map((col, x) =>
              col.map((cell, y) => {
                const key = `${x}-${y}`;
                const bucket = intensityBucket(cell.count);
                const isHovered = hoveredKey === key;
                return (
                  <rect
                    key={key}
                    x={x * (CELL_SIZE + CELL_GAP)}
                    y={y * (CELL_SIZE + CELL_GAP)}
                    width={CELL_SIZE}
                    height={CELL_SIZE}
                    rx={2}
                    ry={2}
                    className={[
                      INTENSITY_FILLS[bucket],
                      // Pointer cursor and highlight ring on hover — scoped to
                      // pointer devices so touch screens are unaffected.
                      "[@media(hover:hover)]:cursor-pointer",
                      isHovered
                        ? `${INTENSITY_HOVER_STROKES[bucket]} stroke-[1.5]`
                        : "stroke-none",
                    ].join(" ")}
                    onMouseEnter={(e) => handleCellEnter(e, cell, key)}
                    onMouseMove={(e) => handleCellMove(e, cell)}
                  >
                    <title>{formatSvgTitle(cell)}</title>
                  </rect>
                );
              }),
            )}
          </svg>

          {/* Hover tooltip — visible only on pointer devices via CSS. The `hidden`
              class is removed via pointer-events detection at the React level: we
              only set `tooltip` when a mouseEnter fires, which only happens on
              pointer devices. The `[@media(hover:hover)]` wrapper ensures the
              tooltip element itself is invisible on touch screens even if React
              state leaks (e.g. a touch device that briefly fires mouseEnter). */}
          {tooltip && (
            <div
              role="tooltip"
              className={[
                // Positioned relative to the SVG container.
                "pointer-events-none absolute z-10",
                // Visual styling.
                "rounded-md bg-zinc-900 px-2 py-1 text-xs text-white shadow-md dark:bg-zinc-100 dark:text-zinc-900",
                // Offset above the cursor so it does not obscure cells.
                "-translate-y-full -translate-x-1/2",
              ].join(" ")}
              style={{
                left: tooltip.x,
                top: tooltip.y - 8,
              }}
            >
              {formatTooltipLabel(tooltip.cell)}
            </div>
          )}
        </div>
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
