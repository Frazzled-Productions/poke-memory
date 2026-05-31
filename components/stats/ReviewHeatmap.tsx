"use client";

import { useRef, useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import type { HeatmapCell } from "@/lib/stats/heatmap";
import { intensityBucket } from "@/lib/stats/heatmap";
import { cardPanel, mutedTextXs } from "@/lib/utils/class-names";
import { formatDate } from "@/lib/utils/format-date";

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

/** Build the tooltip date string.
 *  Routes through formatDate (lib/utils/format-date.ts) so raw Intl.DateTimeFormat
 *  and toLocaleDateString calls are banned from components by the #1456 lint rule.
 *  Uses "dmy-year" (en-GB ordering: "1 Jan 2026") — includes the year so
 *  January cells in a year-spanning heatmap are unambiguous. */
function formatTooltipDate(cell: HeatmapCell): string {
  return formatDate(cell.date, "dmy-year", "UTC");
}

type TooltipState = {
  cell: HeatmapCell;
  /** Pixel x offset from the SVG container's left edge. */
  x: number;
  /** Pixel y offset from the SVG container's top edge. */
  y: number;
};

export function ReviewHeatmap({ columns }: Props) {
  const t = useTranslations("stats");
  const tH = useTranslations("stats.heatmap");
  const format = useFormatter();

  const width = COLS * (CELL_SIZE + CELL_GAP) - CELL_GAP;
  const height = ROWS * (CELL_SIZE + CELL_GAP) - CELL_GAP;
  const total = columns.flat().reduce((s, c) => s + c.count, 0);

  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  function buildTooltipLabel(cell: HeatmapCell): string {
    return `${formatTooltipDate(cell)} - ${t("directionReviewCount", { count: cell.count })}`;
  }

  function clampTooltipPos(
    rawX: number,
    rawY: number,
    containerWidth: number,
  ): { x: number; y: number } {
    // Keep the tooltip's centre point far enough from the container edges that
    // the tooltip box (roughly 120 px wide, 30 px tall) stays visible.
    // Using half the assumed max width (60 px) as a horizontal margin and the
    // assumed height (30 px) as a vertical minimum so top-row cells don't push
    // the tooltip above the container boundary.
    const X_MARGIN = 60;
    const Y_MIN = 30;
    return {
      x: Math.max(X_MARGIN, Math.min(rawX, containerWidth - X_MARGIN)),
      y: Math.max(Y_MIN, rawY),
    };
  }

  function handleCellEnter(
    e: React.MouseEvent<SVGRectElement>,
    cell: HeatmapCell,
    key: string,
  ) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const pos = clampTooltipPos(
      e.clientX - rect.left,
      e.clientY - rect.top,
      rect.width,
    );
    setTooltip({ cell, ...pos });
    setHoveredKey(key);
  }

  function handleCellMove(e: React.MouseEvent<SVGRectElement>, cell: HeatmapCell) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setTooltip((prev) => {
      if (!prev) return null;
      const pos = clampTooltipPos(
        e.clientX - rect.left,
        e.clientY - rect.top,
        rect.width,
      );
      return { cell, ...pos };
    });
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
        {tH("heading")}
      </h2>
      <div className={cardPanel}>
        <p className={`mb-3 ${mutedTextXs} tabular-nums`}>
          {t("reviewsInLastYear", { count: total })}
        </p>
        {/* relative container so the tooltip can be absolutely positioned. */}
        <div ref={containerRef} className="relative">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="xMidYMid meet"
            className="block h-auto w-full"
            style={{ maxWidth: width }}
            role="img"
            aria-label={`Review activity heatmap for the last 365 days, ${format.number(total)} total reviews`}
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
                    <title>{buildTooltipLabel(cell)}</title>
                  </rect>
                );
              }),
            )}
          </svg>

          {/* Hover tooltip — visible only on pointer devices. Primary guard:
              React only sets `tooltip` state from `onMouseEnter`, which only
              fires on pointer devices. Defence-in-depth: the
              `[@media(hover:hover)]` class hides the element via CSS on touch
              screens even if React state were to leak (e.g. a touch device
              that briefly fires mouseEnter). */}
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
                // CSS-level guard: hidden by default, visible only on
                // pointer (hover-capable) devices.
                "hidden [@media(hover:hover)]:block",
              ].join(" ")}
              style={{
                left: tooltip.x,
                top: tooltip.y - 8,
              }}
            >
              {buildTooltipLabel(tooltip.cell)}
            </div>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
          <span>{tH("less")}</span>
          {INTENSITY_FILLS.map((cls, i) => (
            <svg key={i} width={10} height={10} aria-hidden="true">
              <rect width={10} height={10} rx={2} ry={2} className={cls} />
            </svg>
          ))}
          <span>{tH("more")}</span>
        </div>
      </div>
    </section>
  );
}
