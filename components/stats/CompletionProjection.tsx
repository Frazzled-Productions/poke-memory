"use client";

import { useFormatter } from "next-intl";
import type { CompletionProjection } from "@/lib/stats/completion-projection";
import type { DateFormat } from "@/lib/utils/format-date";
import { formatDate } from "@/lib/utils/format-date";
import { cardPanel, mutedText } from "@/lib/utils/class-names";

type Props = {
  projection: CompletionProjection;
  fmt?: DateFormat;
  tz?: string;
};

export function CompletionProjection({ projection, fmt = "dmy", tz = "UTC" }: Props) {
  const format = useFormatter();
  return (
    <section aria-labelledby="completion-projection-heading">
      <h2
        id="completion-projection-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        Pokédex completion
      </h2>

      <div className={cardPanel}>
        {projection.kind === "complete" && (
          <div className="flex flex-col gap-1">
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              Complete!
            </p>
            <p className={mutedText}>
              You have mastered every species. Congratulations!
            </p>
          </div>
        )}

        {projection.kind === "insufficient-history" && (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              Projection not available yet
            </p>
            <p className={mutedText}>
              Available once you have mastered at least one species and kept it
              up for a week. Master a species by reviewing it until it is
              scheduled at least 21 days ahead, then come back after 7 days.
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
                  {format.number(projection.remaining)}
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
