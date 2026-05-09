type Props = {
  again: number;
  hard: number;
  good: number;
  easy: number;
  label?: string;
};

type Segment = {
  key: string;
  label: string;
  count: number;
  color: string;
};

export function GradeBreakdownBar({ again, hard, good, easy, label }: Props) {
  const heading = label ?? "Grade breakdown";
  const total = again + hard + good + easy;

  const segments: Segment[] = [
    { key: "again", label: "Again", count: again, color: "bg-rose-500" },
    { key: "hard",  label: "Hard",  count: hard,  color: "bg-amber-400" },
    { key: "good",  label: "Good",  count: good,  color: "bg-blue-500" },
    { key: "easy",  label: "Easy",  count: easy,  color: "bg-emerald-500" },
  ];

  return (
    <section aria-label={heading}>
      <h2
        className="mb-4 text-lg font-semibold text-foreground"
      >
        {heading}
      </h2>

      {total === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No grades yet.</p>
      ) : (
        <>
          {/* Stacked bar */}
          <div
            className="flex h-6 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
            role="img"
            aria-label={`Grade breakdown: ${again} Again, ${hard} Hard, ${good} Good, ${easy} Easy`}
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
          <div className="mt-4 grid grid-cols-4 gap-3">
            {segments.map(({ key, label: segLabel, count, color }) => (
              <div
                key={key}
                className="rounded-xl border border-zinc-200 bg-background px-3 py-3 dark:border-zinc-800"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {segLabel}
                  </span>
                </div>
                <p className="text-xl font-bold tabular-nums text-foreground">
                  {count.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
