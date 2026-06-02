"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslations } from "next-intl";
import {
  totalDirectionReviews,
  type DirectionBreakdownRow,
} from "@/lib/stats/direction-breakdown";
import type { CardDirection } from "@/lib/stats/direction-breakdown";
import { cardPanel, chartTickText, chartTooltipCard, mutedText, mutedTextXs, statValue } from "@/lib/utils/class-names";

type Props = {
  /** One row per card direction, from `computeDirectionBreakdown`. */
  rows: readonly DirectionBreakdownRow[];
};

/**
 * Colour an accuracy bar by how it compares to a healthy recall band.
 * Emerald above 80%, amber 60-80%, rose below. Mirrors the rose/emerald
 * accent vocabulary used elsewhere on the Stats page.
 */
function accuracyColour(accuracy: number): string {
  if (accuracy >= 0.8) return "#10b981"; // emerald-500
  if (accuracy >= 0.6) return "#f59e0b"; // amber-500
  return "#f43f5e"; // rose-500
}

type ChartDatum = {
  label: string;
  accuracyPct: number;
  total: number;
  passes: number;
  hasData: boolean;
  disabled: boolean;
};

function TooltipBody({ datum }: { datum: ChartDatum }) {
  const tDir = useTranslations("stats.directionBreakdown");
  return (
    <div className={chartTooltipCard}>
      <p className="font-semibold text-foreground">{datum.label}</p>
      {datum.hasData ? (
        <>
          <p className={`mt-1 ${statValue}`}>
            {tDir("tooltipAccuracy", { pct: datum.accuracyPct })}
          </p>
          <p className="tabular-nums text-zinc-500 dark:text-zinc-400">
            {tDir("tooltipReviews", { passes: datum.passes, total: datum.total })}
          </p>
          {datum.disabled && (
            <p className="mt-1 text-zinc-400 dark:text-zinc-500">
              {tDir("tooltipDisabled")}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

/** Resolve a CardDirection to its localised label from the practice catalogue. */
type DirectionLabelKey = "name" | "evolution" | "reverseEvolution" | "reverse" | "cry";
const DIRECTION_TO_KEY: Record<CardDirection, DirectionLabelKey> = {
  name: "name",
  evolution: "evolution",
  "reverse-evolution": "reverseEvolution",
  reverse: "reverse",
  cry: "cry",
};

/**
 * Horizontal bar chart of recall accuracy per card direction, with the raw
 * review count alongside each label.
 *
 * Derives from review history (`grade_log`), not mastery state, so it is
 * intentionally unaffected by the `pretendAllMastered` superuser flag.
 */
export function DirectionBreakdownChart({ rows }: Props) {
  const t = useTranslations("stats");
  const tDir = useTranslations("stats.directionBreakdown");
  const tPracticeDir = useTranslations("practice.direction");
  // Only show directions that have at least one review. Directions with zero
  // reviews (never used, or disabled before any history was recorded) are pure
  // clutter and are hidden entirely.
  const visibleRows = rows.filter((r) => r.total > 0);
  const total = totalDirectionReviews(visibleRows);

  const data: ChartDatum[] = visibleRows.map((row) => {
    const dirLabel = tPracticeDir(DIRECTION_TO_KEY[row.direction]);
    const label = row.disabled
      ? tDir("disabledLabel", { direction: dirLabel })
      : dirLabel;
    return {
      label,
      accuracyPct: row.accuracy === null ? 0 : Math.round(row.accuracy * 100),
      total: row.total,
      passes: row.passes,
      hasData: row.total > 0,
      disabled: row.disabled,
    };
  });

  return (
    <section aria-labelledby="direction-heading">
      <h2
        id="direction-heading"
        className="mb-1 text-base font-semibold text-foreground"
      >
        {tDir("heading")}
      </h2>
      <p className={`mb-3 ${mutedTextXs}`}>
        {tDir("description")}
      </p>

      <div className={cardPanel}>
        {total === 0 ? (
          <p className={mutedText}>
            {tDir("noData")}
          </p>
        ) : (
          <>
            <div
              role="img"
              aria-label={`${tDir("heading")}: ${visibleRows
                .map(
                  (r) => {
                    const dLabel = tPracticeDir(DIRECTION_TO_KEY[r.direction]);
                    const fullLabel = r.disabled ? tDir("disabledLabel", { direction: dLabel }) : dLabel;
                    return `${fullLabel} ${
                      r.accuracy === null
                        ? tDir("noReviewsLabel")
                        : `${Math.round(r.accuracy * 100)}% ${t("directionReviewCount", { count: r.total })}`
                    }`;
                  },
                )
                .join(", ")}`}
            >
              <ResponsiveContainer width="100%" height={data.length * 44}>
                <BarChart
                  layout="vertical"
                  data={data}
                  margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
                  barCategoryGap="28%"
                >
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                    tick={{ fontSize: 11, fill: "currentColor" }}
                    className={chartTickText}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={140}
                    tick={{ fontSize: 12, fill: "currentColor" }}
                    className="text-zinc-600 dark:text-zinc-300"
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "currentColor", fillOpacity: 0.06 }}
                    content={({ active, payload }) => {
                      if (!active) return null;
                      if (!payload?.length) return null;
                      return <TooltipBody datum={payload[0].payload as ChartDatum} />;
                    }}
                  />
                  <Bar dataKey="accuracyPct" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {data.map((d) => (
                      <Cell
                        key={d.label}
                        fill={
                          d.hasData
                            ? accuracyColour(d.accuracyPct / 100)
                            : "currentColor"
                        }
                        fillOpacity={d.hasData ? 1 : 0.12}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Per-direction review counts, since the bars only encode accuracy. */}
            <ul
              role="list"
              className={`mt-3 grid grid-cols-2 gap-x-4 gap-y-1 ${mutedTextXs} sm:grid-cols-3`}
            >
              {visibleRows.map((row) => {
                const dLabel = tPracticeDir(DIRECTION_TO_KEY[row.direction]);
                return (
                  <li
                    key={row.direction}
                    className="flex items-center justify-between gap-2 tabular-nums"
                  >
                    <span>
                      {dLabel}
                      {row.disabled && (
                        <span className="ml-1 text-zinc-400 dark:text-zinc-500">
                          {tDir("disabledMark")}
                        </span>
                      )}
                    </span>
                    <span>
                      {t("directionReviewCount", { count: row.total })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
