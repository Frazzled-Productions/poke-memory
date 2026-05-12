"use client";

import type { Records } from "@/lib/stats/records";

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
  return (
    <section aria-labelledby="records-heading">
      <h2
        id="records-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        Records
      </h2>
      <div className="grid grid-cols-2 gap-4 rounded-xl border border-zinc-200 bg-background p-4 dark:border-zinc-800 sm:grid-cols-4">
        <Stat
          label={records.longestStreak === 1 ? "day longest streak" : "days longest streak"}
          value={records.longestStreak.toString()}
        />
        <Stat
          label="best review day"
          value={records.bestReviewDay.toString()}
        />
        <Stat
          label="avg days to mastery"
          value={fmt(records.avgDaysToMastery)}
          description="from first sight"
        />
        <Stat
          label="mastered in a week"
          value={records.mostMasteredIn7d === null ? "—" : records.mostMasteredIn7d.toString()}
          description="best 7-day window"
        />
      </div>
    </section>
  );
}
