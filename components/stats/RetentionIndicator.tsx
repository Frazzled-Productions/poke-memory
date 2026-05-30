"use client";

import {
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
} from "recharts";
import { useTranslations, useFormatter } from "next-intl";
import type { RetentionComparison } from "@/lib/stats/retention";
import { cardPanel, mutedText, mutedTextXs, sectionLabel } from "@/lib/utils/class-names";

type Props = {
  /** Actual-vs-target comparison from `computeRetentionComparison`. */
  comparison: RetentionComparison;
};

/**
 * Colour the gauge by how the measured recall sits against the target:
 * emerald on or above target, amber within ten points below, rose further off.
 */
function gaugeColour(delta: number): string {
  if (delta >= 0) return "#10b981"; // emerald-500
  if (delta >= -0.1) return "#f59e0b"; // amber-500
  return "#f43f5e"; // rose-500
}

/**
 * Radial gauge comparing measured recall accuracy against the user's
 * configured FSRS retention target.
 *
 * The figure is deliberately framed as a rolling window over the past year,
 * never "all-time". The grade log retains the full review history; the
 * 365-day window is a display choice, not a storage limit.
 *
 * Derives from review history (`grade_log`), not mastery state, so it is
 * intentionally unaffected by the `pretendAllMastered` superuser flag.
 */
export function RetentionIndicator({ comparison }: Props) {
  const t = useTranslations("stats");
  const format = useFormatter();
  const { actual, target, delta, reviews } = comparison;

  /** Format a fraction as a percent with no decimal places, locale-aware. */
  function formatPct(v: number): string {
    return format.number(v, { style: "percent", maximumFractionDigits: 0 });
  }

  return (
    <section aria-labelledby="retention-heading">
      <h2
        id="retention-heading"
        className="mb-1 text-base font-semibold text-foreground"
      >
        Recall vs target
      </h2>
      <p className={`mb-3 ${mutedTextXs}`}>
        Your measured recall over the past year against the {formatPct(target)}{" "}
        retention target the scheduler aims for.
      </p>

      <div className={cardPanel}>
        {actual === null || delta === null ? (
          <p className={mutedText}>
            No reviews recorded in the past year. Grade some cards to see how
            your recall tracks against target.
          </p>
        ) : (
          <div className="flex items-center gap-5">
            <div
              className="relative h-32 w-32 shrink-0"
              role="img"
              aria-label={`Recall ${formatPct(actual)} against a ${formatPct(
                target,
              )} target, ${t("reviewsOverWindowInline", { count: reviews })}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  innerRadius="72%"
                  outerRadius="100%"
                  data={[{ value: Math.round(actual * 100) }]}
                  startAngle={90}
                  endAngle={-270}
                >
                  <PolarAngleAxis
                    type="number"
                    domain={[0, 100]}
                    tick={false}
                    axisLine={false}
                  />
                  <RadialBar
                    dataKey="value"
                    cornerRadius={8}
                    fill={gaugeColour(delta)}
                    background={{ className: "fill-zinc-200 dark:fill-zinc-800" }}
                    isAnimationActive={false}
                  />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold tabular-nums text-foreground">
                  {formatPct(actual)}
                </span>
                <span className={sectionLabel}>
                  recall
                </span>
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                {Math.round(delta * 100) === 0 ? (
                  <>
                    Right on your{" "}
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {formatPct(target)}
                    </span>{" "}
                    retention target.
                  </>
                ) : delta > 0 ? (
                  <>
                    Running{" "}
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {formatPct(delta)}
                    </span>{" "}
                    above your {formatPct(target)} target.
                  </>
                ) : (
                  <>
                    Running{" "}
                    <span
                      className={`font-semibold tabular-nums ${
                        delta >= -0.1
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {formatPct(Math.abs(delta))}
                    </span>{" "}
                    below your {formatPct(target)} target.
                  </>
                )}
              </p>
              <p className={`mt-1 ${mutedTextXs} tabular-nums`}>
                {t("reviewsOverWindow", { count: reviews })}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
