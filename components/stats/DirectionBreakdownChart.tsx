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
import {
  DIRECTION_LABELS,
  totalDirectionReviews,
  type DirectionBreakdownRow,
} from "@/lib/stats/direction-breakdown";

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
};

function TooltipBody({ datum }: { datum: ChartDatum }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-background px-3 py-2 text-xs shadow-lg dark:border-zinc-700">
      <p className="font-semibold text-foreground">{datum.label}</p>
      {datum.hasData ? (
        <>
          <p className="mt-1 tabular-nums text-zinc-600 dark:text-zinc-300">
            Accuracy: {datum.accuracyPct}%
          </p>
          <p className="tabular-nums text-zinc-500 dark:text-zinc-400">
            {datum.passes} of {datum.total} reviews passed
          </p>
        </>
      ) : (
        <p className="mt-1 text-zinc-500 dark:text-zinc-400">No reviews yet</p>
      )}
    </div>
  );
}

/**
 * Horizontal bar chart of recall accuracy per card direction, with the raw
 * review count alongside each label.
 *
 * Derives from review history (`grade_log`), not mastery state, so it is
 * intentionally unaffected by the `pretendAllMastered` superuser flag.
 */
export function DirectionBreakdownChart({ rows }: Props) {
  const total = totalDirectionReviews(rows);

  const data: ChartDatum[] = rows.map((row) => ({
    label: DIRECTION_LABELS[row.direction],
    accuracyPct: row.accuracy === null ? 0 : Math.round(row.accuracy * 100),
    total: row.total,
    passes: row.passes,
    hasData: row.total > 0,
  }));

  return (
    <section aria-labelledby="direction-heading">
      <h2
        id="direction-heading"
        className="mb-1 text-base font-semibold text-foreground"
      >
        Accuracy by card direction
      </h2>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        How your recall compares across name, reverse, cry and evolution cards.
      </p>

      <div className="rounded-xl border border-zinc-200 bg-background p-4 dark:border-zinc-800">
        {total === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No reviews recorded yet. Grade some cards to see your breakdown.
          </p>
        ) : (
          <>
            <div
              role="img"
              aria-label={`Accuracy by card direction: ${rows
                .map(
                  (r) =>
                    `${DIRECTION_LABELS[r.direction]} ${
                      r.accuracy === null
                        ? "no reviews"
                        : `${Math.round(r.accuracy * 100)}% over ${r.total} reviews`
                    }`,
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
                    className="text-zinc-400 dark:text-zinc-500"
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={108}
                    tick={{ fontSize: 12, fill: "currentColor" }}
                    className="text-zinc-600 dark:text-zinc-300"
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "currentColor", fillOpacity: 0.06 }}
                    content={({ active, payload }) =>
                      active && payload && payload.length > 0 ? (
                        <TooltipBody datum={payload[0].payload as ChartDatum} />
                      ) : null
                    }
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
              className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400 sm:grid-cols-3"
            >
              {rows.map((row) => (
                <li
                  key={row.direction}
                  className="flex items-center justify-between gap-2 tabular-nums"
                >
                  <span>{DIRECTION_LABELS[row.direction]}</span>
                  <span>
                    {row.total} review{row.total === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
