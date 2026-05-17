"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { GradeDistribution, GradeTrendPoint } from "@/lib/stats/grade-distribution";

// ---------------------------------------------------------------------------
// Colour palette — consistent with GradeBreakdownBar and the Stats accent vocabulary
// ---------------------------------------------------------------------------

const GRADE_COLOURS = {
  again: "#f43f5e", // rose-500
  hard:  "#f59e0b", // amber-500
  good:  "#3b82f6", // blue-500
  easy:  "#10b981", // emerald-500
} as const;

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

type TooltipPayload = {
  weekStart: string;
  again: number;
  hard: number;
  good: number;
  easy: number;
  total: number;
};

function ChartTooltip({ active, payload }: { active?: boolean; payload?: readonly unknown[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const d = (payload[0] as { payload: TooltipPayload }).payload;
  const rows: { label: string; key: keyof typeof GRADE_COLOURS; count: number }[] = [
    { label: "Again", key: "again", count: d.again },
    { label: "Hard",  key: "hard",  count: d.hard  },
    { label: "Good",  key: "good",  count: d.good  },
    { label: "Easy",  key: "easy",  count: d.easy  },
  ];
  return (
    <div className="rounded-lg border border-zinc-200 bg-background px-3 py-2 text-xs shadow-lg dark:border-zinc-700">
      <p className="mb-1 font-semibold text-foreground">
        w/c {d.weekStart}
      </p>
      {rows.map(({ label, key, count }) => (
        <p key={key} className="tabular-nums text-zinc-600 dark:text-zinc-300">
          <span
            className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
            style={{ backgroundColor: GRADE_COLOURS[key] }}
          />
          {label}: {count.toLocaleString("en-GB")}
        </p>
      ))}
      <p className="mt-1 border-t border-zinc-100 pt-1 tabular-nums text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        Total: {d.total.toLocaleString("en-GB")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  /** Overall grade totals, from `computeGradeDistribution`. */
  distribution: GradeDistribution;
  /** Weekly trend points (12 weeks), from `computeGradeTrend`. */
  trend: readonly GradeTrendPoint[];
};

// ---------------------------------------------------------------------------
// Mini stacked bar (overall distribution) — pure CSS, mirrors GradeBreakdownBar
// ---------------------------------------------------------------------------

function OverallBar({ distribution }: { distribution: GradeDistribution }) {
  const { again, hard, good, easy, total } = distribution;
  if (total === 0) return null;

  const segments = [
    { key: "again", label: "Again", count: again, color: "bg-rose-500" },
    { key: "hard",  label: "Hard",  count: hard,  color: "bg-amber-500" },
    { key: "good",  label: "Good",  count: good,  color: "bg-blue-500"  },
    { key: "easy",  label: "Easy",  count: easy,  color: "bg-emerald-500" },
  ] as const;

  return (
    <div className="mb-4">
      <div
        className="flex h-4 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        role="img"
        aria-label={`All-time grade mix: ${again} Again, ${hard} Hard, ${good} Good, ${easy} Easy`}
      >
        {segments.map(({ key, count, color }) =>
          count > 0 ? (
            <div
              key={key}
              className={`${color} transition-all`}
              style={{ width: `${(count / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <ul
        role="list"
        className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400"
      >
        {segments.map(({ key, label, count, color }) => (
          <li key={key} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} />
            <span className="tabular-nums">
              {label}: {count.toLocaleString("en-GB")} (
              {total > 0 ? Math.round((count / total) * 100) : 0}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main chart component
// ---------------------------------------------------------------------------

/**
 * Stacked bar chart showing grade-button volume per week over the last 12
 * weeks, plus an overall distribution bar for context.
 *
 * Derives from review history (`grade_log`), not mastery state, so it is
 * intentionally NOT affected by the `pretendAllMastered` superuser flag.
 */
export function GradeDistributionChart({ distribution, trend }: Props) {
  const hasTrendData = trend.some((p) => p.total > 0);

  // X-axis tick: show the day-of-month for the week start date.
  function weekLabel(weekStart: string): string {
    const [, m, d] = weekStart.split("-");
    return `${parseInt(m)}/${parseInt(d)}`;
  }

  const chartData = trend.map((p) => ({
    ...p,
    weekLabel: weekLabel(p.weekStart),
  }));

  return (
    <section aria-labelledby="grade-dist-heading">
      <h2
        id="grade-dist-heading"
        className="mb-1 text-base font-semibold text-foreground"
      >
        Grade distribution
      </h2>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        How often you pressed Again, Hard, Good, or Easy over time. A higher
        Easy and Good share shows the cards are sticking.
      </p>

      <div className="rounded-xl border border-zinc-200 bg-background p-4 dark:border-zinc-800">
        {distribution.total === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No grades recorded yet. Start a review session to see your grade
            breakdown here.
          </p>
        ) : (
          <>
            <OverallBar distribution={distribution} />

            <div className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Weekly volume (last 12 weeks)
            </div>

            {hasTrendData ? (
              <div
                role="img"
                aria-label={`Weekly grade volume over the last 12 weeks: ${trend
                  .filter((p) => p.total > 0)
                  .map(
                    (p) =>
                      `week of ${p.weekStart}: ${p.total} grade${p.total === 1 ? "" : "s"}`,
                  )
                  .join(", ")}`}
              >
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart
                    data={chartData}
                    margin={{ top: 4, right: 4, bottom: 0, left: -24 }}
                    barCategoryGap="20%"
                    barSize={14}
                  >
                    <XAxis
                      dataKey="weekLabel"
                      tick={{ fontSize: 10, fill: "currentColor" }}
                      className="text-zinc-400 dark:text-zinc-500"
                      axisLine={false}
                      tickLine={false}
                      interval={2}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 10, fill: "currentColor" }}
                      className="text-zinc-400 dark:text-zinc-500"
                      width={32}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "currentColor", fillOpacity: 0.06 }}
                      content={({ active, payload }) => (
                        <ChartTooltip active={active} payload={payload} />
                      )}
                    />
                    <Bar
                      dataKey="again"
                      stackId="grades"
                      fill={GRADE_COLOURS.again}
                      isAnimationActive={false}
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="hard"
                      stackId="grades"
                      fill={GRADE_COLOURS.hard}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="good"
                      stackId="grades"
                      fill={GRADE_COLOURS.good}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="easy"
                      stackId="grades"
                      fill={GRADE_COLOURS.easy}
                      isAnimationActive={false}
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                No data in the last 12 weeks yet.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
