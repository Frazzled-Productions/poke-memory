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
  totalHistogramCards,
  type DifficultyBucket,
} from "@/lib/stats/difficulty-histogram";
import { cardPanel, chartTickText, mutedText } from "@/lib/utils/class-names";

type Props = {
  /** The nine difficulty buckets, from `computeDifficultyHistogram`. */
  buckets: readonly DifficultyBucket[];
  /** Mean difficulty across introduced cards, or null when there are none. */
  mean: number | null;
};

/**
 * Colour a bucket bar by its difficulty band: emerald for easy cards,
 * amber for the middle, rose for the hard tail. Consistent with the
 * Stats-page accent vocabulary.
 */
function bucketColour(lower: number): string {
  if (lower <= 3) return "#10b981"; // emerald-500 — easy
  if (lower <= 6) return "#f59e0b"; // amber-500 — moderate
  return "#f43f5e"; // rose-500 — hard
}

type ChartDatum = {
  label: string;
  count: number;
  lower: number;
  upper: number;
};

function TooltipBody({ datum }: { datum: ChartDatum }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-background px-3 py-2 text-xs shadow-lg dark:border-zinc-700">
      <p className="font-semibold text-foreground">
        Difficulty {datum.lower} to {datum.upper}
      </p>
      <p className="mt-1 tabular-nums text-zinc-600 dark:text-zinc-300">
        {datum.count} card{datum.count === 1 ? "" : "s"}
      </p>
    </div>
  );
}

/**
 * Histogram of introduced cards bucketed by FSRS `state.difficulty`.
 *
 * Honours the `pretendAllMastered` superuser flag via the
 * `computeDifficultyHistogram` helper: when the flag is on the helper
 * returns an empty population, which renders the empty state here.
 */
export function DifficultyHistogram({ buckets, mean }: Props) {
  const total = totalHistogramCards(buckets);

  const data: ChartDatum[] = buckets.map((b) => ({
    label: b.label,
    count: b.count,
    lower: b.lower,
    upper: b.upper,
  }));

  return (
    <section aria-labelledby="difficulty-heading">
      <h2
        id="difficulty-heading"
        className="mb-1 text-base font-semibold text-foreground"
      >
        Card difficulty spread
      </h2>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        How the FSRS scheduler rates the cards you have started learning, from
        1 (easy) to 10 (hard).
      </p>

      <div className={cardPanel}>
        {total === 0 ? (
          <p className={mutedText}>
            No cards introduced yet. Start a review session to build this up.
          </p>
        ) : (
          <>
            <div className="mb-3 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-foreground">
                {mean === null ? "-" : mean.toFixed(1)}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                average difficulty across {total.toLocaleString("en-GB")} card
                {total === 1 ? "" : "s"}
              </span>
            </div>

            <div
              role="img"
              aria-label={`Difficulty histogram: ${buckets
                .map(
                  (b) =>
                    `${b.label} ${b.count} card${b.count === 1 ? "" : "s"}`,
                )
                .join(", ")}`}
            >
              <ResponsiveContainer width="100%" height={160}>
                <BarChart
                  data={data}
                  margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
                  barCategoryGap="18%"
                >
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "currentColor" }}
                    className="text-zinc-500 dark:text-zinc-400"
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "currentColor" }}
                    className={chartTickText}
                    width={28}
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
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {data.map((d) => (
                      <Cell key={d.label} fill={bucketColour(d.lower)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
