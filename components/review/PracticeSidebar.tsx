"use client";

/**
 * PracticeSidebar — shown alongside the review card at lg: breakpoints.
 *
 * Displays session-local counters only: grades completed today and a compact
 * grade-colour legend. This data comes from the grade log, not from mastery
 * or progression state, so it is unaffected by the `pretendAllMastered`
 * superuser flag. The sidebar updates live by listening for the
 * GRADE_LOG_APPENDED_EVENT that ReviewSession fires after each grade.
 */

import { memo, useEffect, useState } from "react";
import Link from "next/link";
import {
  loadGradeLog,
  todayGradeSequence,
  GRADE_LOG_APPENDED_EVENT,
  type GradeLog,
} from "@/lib/gradelog/persistence";
import { KEY_GRADE_LOG } from "@/lib/storage/keys";
import { todayString } from "@/lib/review/session";
import { cardPanel } from "@/lib/utils/class-names";

// Grade colour mapping — same convention as GradeBreakdownBar and session UI.
const GRADE_COLOURS: Record<number, { label: string; dot: string; text: string }> = {
  1: { label: "Again",  dot: "bg-rose-500",    text: "text-rose-600 dark:text-rose-400" },
  2: { label: "Hard",   dot: "bg-amber-500",   text: "text-amber-600 dark:text-amber-400" },
  4: { label: "Good",   dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  5: { label: "Easy",   dot: "bg-blue-500",    text: "text-blue-600 dark:text-blue-400" },
};

// How many recent grade dots to render in the recents strip.
const RECENT_DOTS = 20;

function gradeLabel(grade: number): string {
  return GRADE_COLOURS[grade]?.label ?? String(grade);
}

function gradeDotClass(grade: number): string {
  return GRADE_COLOURS[grade]?.dot ?? "bg-zinc-400";
}

function gradeTextClass(grade: number): string {
  return GRADE_COLOURS[grade]?.text ?? "text-zinc-500 dark:text-zinc-400";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="tabular-nums text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

function GradeTallyRow({
  grade,
  count,
}: {
  grade: number;
  count: number;
}) {
  if (count === 0) return null;
  return (
    <div role="listitem" className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${gradeDotClass(grade)}`} aria-hidden="true" />
      <span className="text-sm text-zinc-500 dark:text-zinc-400 flex-1">{gradeLabel(grade)}</span>
      <span className={`tabular-nums text-sm font-semibold ${gradeTextClass(grade)}`}>{count}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PracticeSidebar
// ---------------------------------------------------------------------------

/**
 * `PracticeSidebar` takes no props from the parent, so wrapping in `memo`
 * prevents spurious re-renders triggered by `setCards` and other state
 * updates in `ReviewSession` — the sidebar manages its own state via the
 * `GRADE_LOG_APPENDED_EVENT` listener (#1191 Class B item 8).
 */
export const PracticeSidebar = memo(function PracticeSidebar() {
  const [todayGrades, setTodayGrades] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function refresh() {
      const log: GradeLog = await loadGradeLog();
      const today = todayString(new Date());
      const grades = todayGradeSequence(log, today);
      setTodayGrades(grades);
      setLoading(false);
    }

    void refresh();

    // Re-read every time a new grade is appended, so the sidebar stays live.
    function handleGradeAppended() {
      void refresh();
    }
    window.addEventListener(GRADE_LOG_APPENDED_EVENT, handleGradeAppended);

    // Re-read when reset-all-progress wipes the grade log. reset.ts dispatches
    // a synthetic StorageEvent keyed to KEY_GRADE_LOG so same-tab listeners
    // pick up the cleared state without a full reload — mirror the pattern in
    // ReviewSession.tsx and Stats/Pasture/Pokédex pages.
    function handleStorage(e: StorageEvent) {
      if (e.key === KEY_GRADE_LOG) {
        void refresh();
      }
    }
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(GRADE_LOG_APPENDED_EVENT, handleGradeAppended);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const total = todayGrades.length;

  // Grade tally — count each grade value.
  const tally: Record<number, number> = { 1: 0, 2: 0, 4: 0, 5: 0 };
  for (const g of todayGrades) {
    if (g in tally) tally[g]++;
  }

  // Accuracy: Good (4) + Easy (5) as a share of all grades.
  const passes = (tally[4] ?? 0) + (tally[5] ?? 0);
  const accuracyPct = total > 0 ? Math.round((passes / total) * 100) : null;

  // Most recent grades, shown newest-first as coloured dots.
  const recentDots = todayGrades.slice(-RECENT_DOTS).reverse();

  if (loading) {
    return (
      <aside
        aria-label="Session progress"
        className="flex flex-col gap-4"
      >
        <div className={`${cardPanel} animate-pulse flex flex-col gap-3`}>
          <div className="h-4 w-28 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-3 w-20 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-3 w-16 rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Session progress"
      className="flex flex-col gap-4"
    >
      <div className={`${cardPanel} flex flex-col gap-3`}>
        <h2 className="text-sm font-semibold text-foreground">Today</h2>

        <StatRow label="Cards reviewed" value={total} />
        {accuracyPct !== null && (
          <StatRow label="Accuracy" value={`${accuracyPct}%`} />
        )}

        {total > 0 && (
          <div className="flex flex-col gap-1.5 pt-1" role="list" aria-label="Grade breakdown">
            <GradeTallyRow grade={5} count={tally[5]} />
            <GradeTallyRow grade={4} count={tally[4]} />
            <GradeTallyRow grade={2} count={tally[2]} />
            <GradeTallyRow grade={1} count={tally[1]} />
          </div>
        )}

        {total === 0 && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            No cards reviewed yet today.
          </p>
        )}
      </div>

      {recentDots.length > 0 && (
        <div className={`${cardPanel} flex flex-col gap-2`}>
          <h2 className="text-sm font-semibold text-foreground">Recent grades</h2>
          <div
            className="flex flex-wrap gap-1.5"
            role="img"
            aria-label={`${recentDots.length} recent grades, newest first`}
          >
            {recentDots.map((g, i) => (
              <span
                key={i}
                title={gradeLabel(g)}
                className={`h-3 w-3 rounded-full ${gradeDotClass(g)}`}
                aria-hidden="true"
              />
            ))}
          </div>
        </div>
      )}

      <Link
        href="/stats"
        className="text-center text-xs font-medium text-zinc-500 underline underline-offset-4 hover:text-foreground hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 rounded dark:text-zinc-400"
      >
        View full stats
      </Link>
    </aside>
  );
});
