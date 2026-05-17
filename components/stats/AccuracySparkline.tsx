"use client";

import { useState } from "react";
import type { AccuracyPoint } from "@/lib/stats/accuracy";

// ---------------------------------------------------------------------------
// Window options
// ---------------------------------------------------------------------------

type Window = 7 | 30 | 365;

const WINDOW_OPTIONS: { label: string; value: Window }[] = [
  { label: "7d",   value: 7 },
  { label: "30d",  value: 30 },
  { label: "1yr",  value: 365 },
];

type Props = {
  /**
   * 30-day per-day accuracy series. Null entries represent days with no
   * reviews; rendered as a gap so the visual doesn't claim 0%-on-no-data.
   * The component also accepts a 365-day series when the parent provides one.
   */
  points: readonly AccuracyPoint[];
  /**
   * Rolling 7-day aggregate accuracy (0..1). `null` when the window has
   * no recorded reviews — in that case the headline reads "—".
   */
  rolling7d: number | null;
  /**
   * Rolling 30-day aggregate accuracy. Shown when the 30d or 1yr window
   * is selected. `null` when the window has no recorded reviews.
   */
  rolling30d?: number | null;
  /**
   * Rolling 365-day aggregate accuracy. Shown when the 1yr window is
   * selected. `null` when the window has no recorded reviews.
   */
  rolling365d?: number | null;
  /**
   * Full 365-day series for the "1yr" window option. When omitted, only
   * the 7d and 30d tabs are available.
   */
  points365?: readonly AccuracyPoint[];
};

const SVG_WIDTH = 240;
const SVG_HEIGHT = 32;

function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/**
 * Build polyline points and dot markers. Days with `accuracy: null` are
 * skipped (no dot, polyline breaks into a separate segment) so the chart
 * does not imply 0% accuracy when there were simply no reviews that day.
 */
function buildSegments(
  points: readonly AccuracyPoint[],
): { segments: string[]; dots: { x: number; y: number }[] } {
  if (points.length === 0) return { segments: [], dots: [] };
  const stepX = SVG_WIDTH / Math.max(1, points.length - 1);
  const segments: string[] = [];
  const dots: { x: number; y: number }[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p.accuracy === null) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    const x = i * stepX;
    const y = SVG_HEIGHT - p.accuracy * SVG_HEIGHT;
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    // For 365-point series, skip dot rendering (too dense).
    if (points.length <= 30) {
      dots.push({ x, y });
    }
  });
  if (current.length > 1) segments.push(current.join(" "));
  return { segments, dots };
}

export function AccuracySparkline({ points, rolling7d, rolling30d, rolling365d, points365 }: Props) {
  const [activeWindow, setActiveWindow] = useState<Window>(7);

  // Resolve which data to render for the active window.
  const displayPoints: readonly AccuracyPoint[] =
    activeWindow === 365 && points365 != null ? points365 :
    activeWindow === 30 ? points :
    // 7-day: slice the last 7 from the 30-day series.
    points.slice(-7);

  const rollingValue: number | null =
    activeWindow === 7 ? rolling7d :
    activeWindow === 30 ? (rolling30d ?? null) :
    (rolling365d ?? null);

  const windowLabel =
    activeWindow === 7 ? "7-day rolling" :
    activeWindow === 30 ? "30-day rolling" :
    "365-day rolling";

  const { segments, dots } = buildSegments(displayPoints);
  const hasAnyData = displayPoints.some((p) => p.accuracy !== null);

  // Visible window tabs: only show "1yr" when the parent provided points365.
  const availableWindows = points365 != null
    ? WINDOW_OPTIONS
    : WINDOW_OPTIONS.filter((o) => o.value !== 365);

  return (
    <section aria-labelledby="accuracy-heading">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2
          id="accuracy-heading"
          className="text-base font-semibold text-foreground"
        >
          Recent accuracy
        </h2>
        {/* Window selector */}
        <div
          role="group"
          aria-label="Accuracy window"
          className="flex items-center gap-px rounded-lg border border-zinc-200 bg-zinc-100 p-px dark:border-zinc-700 dark:bg-zinc-800"
        >
          {availableWindows.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setActiveWindow(opt.value)}
              aria-pressed={activeWindow === opt.value}
              className={
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 " +
                (activeWindow === opt.value
                  ? "bg-background text-foreground shadow-sm dark:bg-zinc-700"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-background p-4 dark:border-zinc-800">
        <div className="flex flex-col">
          <span className="text-2xl font-semibold tabular-nums text-foreground">
            {rollingValue === null ? "—" : formatPct(rollingValue)}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {windowLabel}
          </span>
        </div>
        {hasAnyData ? (
          <svg
            viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
            width="100%"
            height={SVG_HEIGHT}
            role="img"
            aria-label={`${activeWindow}-day accuracy sparkline`}
            className="overflow-visible"
            preserveAspectRatio="none"
          >
            {segments.map((pts, idx) => (
              <polyline
                key={idx}
                points={pts}
                fill="none"
                stroke="currentColor"
                strokeWidth={activeWindow === 365 ? 1 : 1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-emerald-500"
              />
            ))}
            {dots.map((d, idx) => (
              <circle
                key={idx}
                cx={d.x}
                cy={d.y}
                r={1.5}
                className="fill-emerald-500"
              />
            ))}
          </svg>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No reviews yet in the last {activeWindow === 365 ? "year" : `${activeWindow} days`}.
          </p>
        )}
      </div>
    </section>
  );
}
