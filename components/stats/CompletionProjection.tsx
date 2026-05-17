"use client";

import type { CompletionProjection } from "@/lib/stats/completion-projection";
import type { DateFormat } from "@/lib/utils/format-date";
import { formatDate } from "@/lib/utils/format-date";

type Props = {
  projection: CompletionProjection;
  fmt?: DateFormat;
  tz?: string;
};

export function CompletionProjection({ projection, fmt = "dmy", tz = "UTC" }: Props) {
  return (
    <section aria-labelledby="completion-projection-heading">
      <h2
        id="completion-projection-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        Pokédex completion
      </h2>

      <div className="rounded-xl border border-zinc-200 bg-background p-4 dark:border-zinc-800">
        {projection.kind === "complete" && (
          <div className="flex flex-col gap-1">
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              Complete!
            </p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              You have mastered every species. Congratulations!
            </p>
          </div>
        )}

        {projection.kind === "insufficient-history" && (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              Not enough data yet
            </p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Keep reviewing and a completion estimate will appear once you have
              at least a week of mastery history.
            </p>
          </div>
        )}

        {projection.kind === "projected" && (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {formatDate(projection.projectedDate, fmt, tz)}
              </p>
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                estimated completion date
              </p>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
              <span>
                <span className="font-medium text-foreground">
                  {projection.remaining.toLocaleString("en-GB")}
                </span>{" "}
                species remaining
              </span>
              <span>
                <span className="font-medium text-foreground">
                  {projection.weeklyRate.toFixed(1)}
                </span>{" "}
                mastered per week (recent pace)
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
