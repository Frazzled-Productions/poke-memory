"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useFormatter, useTranslations } from "next-intl";
import type { MasteryPoint } from "@/lib/stats/mastery-over-time";
import { formatChartDate, type DateFormat } from "@/lib/utils/format-date";
import { cardPanel, chartTickText, chartTooltipCard, mutedText, mutedTextXs, statValue } from "@/lib/utils/class-names";

// ---------------------------------------------------------------------------
// Palette - consistent with other Stats components (zinc/emerald/rose)
// ---------------------------------------------------------------------------

/** Emerald fill matching the mastery colour used in MasteryBar and TypeBreakdown. */
const AREA_COLOUR = "#10b981"; // emerald-500

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

type TooltipPayload = {
  date: string;
  count: number;
};

function ChartTooltip({
  active,
  payload,
  dateFormat,
}: {
  active?: boolean;
  payload?: readonly unknown[];
  dateFormat: DateFormat;
}) {
  const t = useTranslations("stats.masteryOverTime");
  const format = useFormatter();
  if (!active || !payload || payload.length === 0) return null;
  const d = (payload[0] as { payload: TooltipPayload }).payload;
  return (
    <div className={chartTooltipCard}>
      <p className="font-semibold text-foreground">{formatChartDate(d.date, dateFormat)}</p>
      <p className={`mt-0.5 ${statValue}`}>
        <span
          className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
          style={{ backgroundColor: AREA_COLOUR }}
        />
        {format.number(d.count)} {t("tooltipMastered")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  /**
   * Cumulative mastery series from `computeMasteryOverTime`. Empty array
   * renders the empty state. A single-point series (e.g. from
   * `forceAllMastered`) renders a flat indicator.
   */
  series: readonly MasteryPoint[];
  /** Total name-card count - used in the heading and empty-state copy. */
  totalCards: number;
  /**
   * User's preferred date format. Defaults to "dmy" (day-first, en-GB).
   * Mirrors the `fmt` prop pattern used by `DueForecast`.
   */
  dateFormat?: DateFormat;
  /** When true, the single-point series is a superuser artefact, not sparse history. */
  forceAllMastered?: boolean;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Cumulative area chart showing mastered species count over time.
 *
 * Data source: `lastReview` on mastered name-cards (same approximation used
 * by `computeRecords` - see `lib/stats/mastery-over-time.ts`).
 *
 * Superuser `pretendAllMastered`: the caller passes in the result of
 * `computeMasteryOverTime(..., forceAllMastered)`, which produces a single
 * point at today with `count === cards.length`. This chart renders that
 * as a headline number with no trend line (single-point series).
 */
export function MasteryOverTimeChart({ series, totalCards, dateFormat = "dmy", forceAllMastered = false }: Props) {
  const format = useFormatter();
  const t = useTranslations("stats.masteryOverTime");
  const hasData = series.length > 0;
  const latestCount = hasData ? series[series.length - 1].count : 0;

  // A single-point series (forceAllMastered path, or only one mastered card)
  // cannot render a meaningful line; show a headline number instead.
  const isSinglePoint = series.length === 1;

  // The chart data needs to be a plain mutable array for Recharts.
  const chartData = series.map((p) => ({ ...p }));

  return (
    <section aria-labelledby="mastery-over-time-heading">
      <h2
        id="mastery-over-time-heading"
        className="mb-1 text-base font-semibold text-foreground"
      >
        {t("heading")}
      </h2>
      <p className={`mb-3 ${mutedTextXs}`}>
        {t("description")}
      </p>

      <div className={cardPanel}>
        {!hasData ? (
          <p className={mutedText}>
            {t("noData")}
          </p>
        ) : (
          <>
            {/* Headline count */}
            <div className="mb-4 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {format.number(latestCount)}
              </span>
              <span className={mutedTextXs}>
                {totalCards > 0
                  ? t("ofTotalMastered", { total: format.number(totalCards) })
                  : t("speciesMastered")}
              </span>
            </div>

            {isSinglePoint ? (
              /* Single-point: no trend to draw - just show the headline. */
              <p className={mutedTextXs}>
                {forceAllMastered
                  ? t("superuserMode")
                  : t("reviewMoreCards")}
              </p>
            ) : (
              <div
                role="img"
                aria-label={t("ariaLabel", {
                  count: format.number(latestCount),
                  total: format.number(totalCards),
                  date: series[series.length - 1].date,
                })}
              >
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart
                    data={chartData}
                    margin={{ top: 4, right: 8, bottom: 0, left: -20 }}
                  >
                    <defs>
                      <linearGradient
                        id="masteryGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor={AREA_COLOUR}
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor={AREA_COLOUR}
                          stopOpacity={0.02}
                        />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tickFormatter={(date: string) => formatChartDate(date, dateFormat)}
                      tick={{ fontSize: 10, fill: "currentColor" }}
                      className={chartTickText}
                      axisLine={false}
                      tickLine={false}
                      // Show a manageable number of ticks regardless of series length.
                      interval={Math.max(0, Math.ceil(series.length / 6) - 1)}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 10, fill: "currentColor" }}
                      className={chartTickText}
                      width={32}
                      axisLine={false}
                      tickLine={false}
                      domain={[0, totalCards > 0 ? totalCards : "auto"]}
                    />
                    <Tooltip
                      cursor={{ stroke: AREA_COLOUR, strokeOpacity: 0.3, strokeWidth: 1 }}
                      content={({ active, payload }) => (
                        <ChartTooltip active={active} payload={payload} dateFormat={dateFormat} />
                      )}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke={AREA_COLOUR}
                      strokeWidth={2}
                      fill="url(#masteryGradient)"
                      dot={false}
                      activeDot={{ r: 4, fill: AREA_COLOUR, strokeWidth: 0 }}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
