"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useFormatter } from "next-intl";
import type { ActivityPoint } from "@/lib/stats/activity-history";
import { isActivityHistoryEmpty } from "@/lib/stats/activity-history";
import type { DateFormat } from "@/lib/utils/format-date";
import { cardPanel, chartTickText, mutedText, statValue } from "@/lib/utils/class-names";

// ---------------------------------------------------------------------------
// Palette — consistent with other Stats components (zinc/emerald/rose)
// ---------------------------------------------------------------------------

/** Rose-500: reviews volume, matching the practice-accent colour. */
const REVIEWS_COLOUR = "#f43f5e";

/** Emerald-500: new-card introductions, matching the mastery colour. */
const INTRODUCED_COLOUR = "#10b981";

// ---------------------------------------------------------------------------
// X-axis tick formatter
// ---------------------------------------------------------------------------

/**
 * Produce a short date label for the x-axis tick, honouring the user's
 * preferred date format. Mirrors the `formatXTick` pattern in
 * `MasteryOverTimeChart`.
 */
function formatXTick(date: string, fmt: DateFormat): string {
  const [, m, d] = date.split("-");
  if (fmt === "mdy") return `${parseInt(m)}/${parseInt(d)}`;
  if (fmt === "iso") return `${m}-${d}`;
  // dmy (default, en-GB)
  return `${parseInt(d)}/${parseInt(m)}`;
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

type TooltipPayload = ActivityPoint;

function ChartTooltip({
  active,
  payload,
  dateFormat,
}: {
  active?: boolean;
  payload?: readonly unknown[];
  dateFormat: DateFormat;
}) {
  const format = useFormatter();
  if (!active || !payload || payload.length === 0) return null;
  const d = (payload[0] as { payload: TooltipPayload }).payload;
  const label = formatXTick(d.date, dateFormat);
  return (
    <div className="rounded-lg border border-zinc-200 bg-background px-3 py-2 text-xs shadow-lg dark:border-zinc-700">
      <p className="mb-1 font-semibold text-foreground">{label}</p>
      <p className={statValue}>
        <span
          className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
          style={{ backgroundColor: REVIEWS_COLOUR }}
        />
        Reviews: {format.number(d.reviews)}
      </p>
      {d.introduced > 0 && (
        <p className={statValue}>
          <span
            className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
            style={{ backgroundColor: INTRODUCED_COLOUR }}
          />
          New cards introduced: {format.number(d.introduced)}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom legend
// ---------------------------------------------------------------------------

// The legend always shows both series, even on days with zero introductions.
// This is intentional — the legend describes the chart's series, not the data.
function ChartLegend() {
  return (
    <div
      aria-hidden="true"
      className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400"
    >
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: REVIEWS_COLOUR }}
        />
        Reviews
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: INTRODUCED_COLOUR }}
        />
        New cards introduced
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  /**
   * Daily activity series from `computeActivityHistory`. 365 points by
   * default; shorter windows accepted for testing.
   */
  series: readonly ActivityPoint[];
  /**
   * User's preferred date format. Defaults to "dmy" (day-first, en-GB).
   */
  dateFormat?: DateFormat;
};

// ---------------------------------------------------------------------------
// Compute a sparse tick interval so the x-axis shows roughly 6 labels
// regardless of series length.
// ---------------------------------------------------------------------------

function sparseInterval(length: number): number {
  return Math.max(0, Math.ceil(length / 6) - 1);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Bar chart showing reviews-per-day and new-cards-introduced-per-day over the
 * last year (365-day rolling window).
 *
 * Derives from review history (`grade_log`), NOT from mastery state. This
 * chart is intentionally NOT affected by the `pretendAllMastered` superuser
 * flag — the caller passes in the raw log-derived series unchanged.
 *
 * Guest-mode empty state: when `isActivityHistoryEmpty(series)` is true,
 * a prompt to start a review session is shown instead of the chart.
 */
export function ActivityHistoryChart({
  series,
  dateFormat = "dmy",
}: Props) {
  const isEmpty = isActivityHistoryEmpty(series);

  // Recharts requires a plain mutable array.
  const chartData = series.map((p) => ({ ...p }));

  const interval = sparseInterval(series.length);

  // Aria label summarises peak activity for screen readers.
  const peakDay = isEmpty
    ? null
    : [...series].sort((a, b) => b.reviews - a.reviews)[0];
  const ariaLabel = peakDay
    ? `Daily review and introduction history over the past year. Peak activity: ${peakDay.reviews} reviews on ${formatXTick(peakDay.date, dateFormat)}.`
    : "Daily review and introduction history: no activity recorded yet.";

  return (
    <section aria-labelledby="activity-history-heading">
      <h2
        id="activity-history-heading"
        className="mb-1 text-base font-semibold text-foreground"
      >
        Daily activity
      </h2>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Reviews completed and new cards introduced within the past year. Derived
        from review history, not mastery.
      </p>

      <div className={cardPanel}>
        {isEmpty ? (
          <p className={mutedText}>
            No activity recorded yet. Start a review session to see your
            daily history here.
          </p>
        ) : (
          <>
            <div role="img" aria-label={ariaLabel}>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart
                  data={chartData}
                  margin={{ top: 4, right: 4, bottom: 0, left: -24 }}
                  barCategoryGap="10%"
                  barSize={3}
                >
                  <XAxis
                    dataKey="date"
                    tickFormatter={(date: string) =>
                      formatXTick(date, dateFormat)
                    }
                    tick={{ fontSize: 10, fill: "currentColor" }}
                    className={chartTickText}
                    axisLine={false}
                    tickLine={false}
                    interval={interval}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: "currentColor" }}
                    className={chartTickText}
                    width={32}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "currentColor", fillOpacity: 0.06 }}
                    content={({ active, payload }) => (
                      <ChartTooltip
                        active={active}
                        payload={payload}
                        dateFormat={dateFormat}
                      />
                    )}
                  />
                  <Bar
                    dataKey="reviews"
                    name="Reviews"
                    fill={REVIEWS_COLOUR}
                    isAnimationActive={false}
                    radius={[2, 2, 0, 0]}
                  />
                  <Bar
                    dataKey="introduced"
                    name="New cards introduced"
                    fill={INTRODUCED_COLOUR}
                    isAnimationActive={false}
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ChartLegend />
          </>
        )}
      </div>
    </section>
  );
}
