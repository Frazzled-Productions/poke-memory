"use client";

import type { AccuracyPoint } from "@/lib/stats/accuracy";

type Props = {
  /**
   * 30-day per-day accuracy series. Null entries represent days with no
   * reviews; rendered as a gap so the visual doesn't claim 0%-on-no-data.
   */
  points: readonly AccuracyPoint[];
  /**
   * Rolling 7-day aggregate accuracy (0..1). `null` when the window has
   * no recorded reviews — in that case the headline reads "—".
   */
  rolling7d: number | null;
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
    dots.push({ x, y });
  });
  if (current.length > 1) segments.push(current.join(" "));
  return { segments, dots };
}

export function AccuracySparkline({ points, rolling7d }: Props) {
  const { segments, dots } = buildSegments(points);
  const hasAnyData = points.some((p) => p.accuracy !== null);

  return (
    <section aria-labelledby="accuracy-heading">
      <h2
        id="accuracy-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        Recent accuracy
      </h2>
      <div className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-background p-4 dark:border-zinc-800">
        <div className="flex flex-col">
          <span className="text-2xl font-semibold tabular-nums text-foreground">
            {rolling7d === null ? "—" : formatPct(rolling7d)}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            7-day rolling
          </span>
        </div>
        {hasAnyData ? (
          <svg
            viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
            width="100%"
            height={SVG_HEIGHT}
            role="img"
            aria-label="30-day accuracy sparkline"
            className="overflow-visible"
            preserveAspectRatio="none"
          >
            {segments.map((points, idx) => (
              <polyline
                key={idx}
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
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
            No reviews yet in the last 30 days.
          </p>
        )}
      </div>
    </section>
  );
}
