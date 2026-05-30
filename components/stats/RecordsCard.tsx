"use client";

import { useTranslations } from "next-intl";
import type { Records } from "@/lib/stats/records";
import { cn } from "@/lib/utils/cn";
import { cardPanel } from "@/lib/utils/class-names";

type Props = { records: Records };

function fmt(n: number | null, suffix = ""): string {
  return n === null ? "—" : `${Math.round(n)}${suffix}`;
}

function Stat({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
      {description ? (
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
          {description}
        </span>
      ) : null}
    </div>
  );
}

export function RecordsCard({ records }: Props) {
  const t = useTranslations("stats.records");
  return (
    <section aria-labelledby="records-heading">
      <h2
        id="records-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        {t("heading")}
      </h2>
      <div className={cn("grid grid-cols-2 gap-4 sm:grid-cols-4", cardPanel)}>
        <Stat
          label={records.longestStreak === 1 ? t("longestStreakDay") : t("longestStreakDays")}
          value={records.longestStreak.toString()}
        />
        <Stat
          label={t("bestReviewDay")}
          value={records.bestReviewDay.toString()}
        />
        <Stat
          label={t("avgDaysToMastery")}
          value={fmt(records.avgDaysToMastery)}
          description={t("fromFirstSight")}
        />
        <Stat
          label={t("masteredInWeek")}
          value={records.mostMasteredIn7d === null ? "—" : records.mostMasteredIn7d.toString()}
          description={t("bestSevenDayWindow")}
        />
      </div>
    </section>
  );
}
