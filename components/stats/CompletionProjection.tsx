"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { CompletionProjection } from "@/lib/stats/completion-projection";
import type { DateFormat } from "@/lib/utils/format-date";
import { formatDate } from "@/lib/utils/format-date";
import { cardPanel, mutedText, mutedTextXs } from "@/lib/utils/class-names";

type Props = {
  projection: CompletionProjection;
  fmt?: DateFormat;
  tz?: string;
};

export function CompletionProjection({ projection, fmt = "dmy", tz = "UTC" }: Props) {
  const format = useFormatter();
  const t = useTranslations("stats.completionProjection");
  return (
    <section aria-labelledby="completion-projection-heading">
      <h2
        id="completion-projection-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        {t("heading")}
      </h2>

      <div className={cardPanel}>
        {projection.kind === "complete" && (
          <div className="flex flex-col gap-1">
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {t("complete")}
            </p>
            <p className={mutedText}>
              {t("completeCopy")}
            </p>
          </div>
        )}

        {projection.kind === "insufficient-history" && (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              {t("notAvailable")}
            </p>
            <p className={mutedText}>
              {t("notAvailableDescription")}
            </p>
          </div>
        )}

        {projection.kind === "projected" && (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {formatDate(projection.projectedDate, fmt, tz)}
              </p>
              <p className={`mt-0.5 ${mutedText}`}>
                {t("estimatedDate")}
              </p>
            </div>
            <div className={`flex flex-wrap gap-x-6 gap-y-1 ${mutedTextXs} tabular-nums`}>
              <span>
                <span className="font-medium text-foreground">
                  {format.number(projection.remaining)}
                </span>{" "}
                {t("speciesRemaining")}
              </span>
              <span>
                <span className="font-medium text-foreground">
                  {projection.weeklyRate.toFixed(1)}
                </span>{" "}
                {t("masteredPerWeek")}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
