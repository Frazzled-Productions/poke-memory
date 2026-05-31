"use client";

import { useFormatter, useTranslations } from "next-intl";
import { mutedText, sectionLabel } from "@/lib/utils/class-names";

type Props = {
  again: number;
  hard: number;
  good: number;
  easy: number;
  label?: string;
  hideZeroSegments?: boolean;
};

type Segment = {
  key: string;
  label: string;
  count: number;
  color: string;
};

export function GradeBreakdownBar({ again, hard, good, easy, label, hideZeroSegments = false }: Props) {
  const format = useFormatter();
  const t = useTranslations("stats.gradeBreakdown");
  const tPractice = useTranslations("practice");
  const heading = label ?? t("heading");
  const total = again + hard + good + easy;

  const segments: Segment[] = [
    { key: "again", label: tPractice("again"), count: again, color: "bg-rose-500" },
    { key: "hard",  label: tPractice("hard"),  count: hard,  color: "bg-amber-500" },
    { key: "good",  label: tPractice("good"),  count: good,  color: "bg-blue-500" },
    { key: "easy",  label: tPractice("easy"),  count: easy,  color: "bg-emerald-500" },
  ];

  const visibleSegments = hideZeroSegments ? segments.filter((s) => s.count > 0) : segments;
  const legendColClass =
    visibleSegments.length === 1 ? "grid-cols-1" :
    visibleSegments.length === 2 ? "grid-cols-2" :
    visibleSegments.length === 3 ? "grid-cols-3" :
    "grid-cols-4";

  return (
    <section aria-label={heading}>
      <h2
        className="mb-4 text-lg font-semibold text-foreground"
      >
        {heading}
      </h2>

      {total === 0 ? (
        <p className={mutedText}>{t("noGrades")}</p>
      ) : (
        <>
          {/* Stacked bar */}
          <div
            className="flex h-6 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
            role="img"
            aria-label={t("ariaLabel", {
              heading,
              again,
              hard,
              good,
              easy,
            })}
          >
            {segments.map(({ key, count, color }) =>
              count > 0 ? (
                <div
                  key={key}
                  className={`${color} transition-all`}
                  style={{ width: `${(count / total) * 100}%` }}
                />
              ) : null
            )}
          </div>

          {/* Legend chips */}
          <div className={`mt-4 grid ${legendColClass} gap-3`}>
            {visibleSegments.map(({ key, label: segLabel, count, color }) => (
              <div
                key={key}
                className="rounded-xl border border-zinc-200 bg-background px-3 py-3 dark:border-zinc-800"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />
                  <span className={sectionLabel}>
                    {segLabel}
                  </span>
                </div>
                <p className="text-xl font-bold tabular-nums text-foreground">
                  {format.number(count)}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
