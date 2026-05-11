"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { buildSession, hydrateSession, todayString, type ReviewableCard } from "@/lib/review/session";
import { loadSession } from "@/lib/review/persistence";
import { SEED_POKEMON, SEED_EVOLUTION_CARDS } from "@/lib/pokemon/seed";
import { computeStats } from "@/lib/stats/derive";
import type { StatsResult } from "@/lib/stats/derive";
import { loadSettings } from "@/lib/settings/persistence";
import { computeStreak, loadStreakData } from "@/lib/streak";
import { loadGradeLog, computeGradeTotals, type GradeTotals } from "@/lib/gradelog/persistence";
import { GradeBreakdownBar } from "@/components/stats/GradeBreakdownBar";
import { SyncStatusLine } from "@/components/stats/SyncStatusLine";
import { SyncNowButton } from "@/components/stats/SyncNowButton";
import { useAuth } from "@/lib/auth/AuthContext";
import { useManualSync } from "@/lib/sync/useManualSync";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SkeletonBlock({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800 ${className}`}
    />
  );
}

function LoadingSkeleton() {
  return (
    <div
      className="flex flex-col gap-8"
      aria-busy="true"
      aria-label="Loading stats"
    >
      <SkeletonBlock className="h-20 w-full" />
      <SkeletonBlock className="h-28 w-full" />
      <SkeletonBlock className="h-12 w-full" />
      <div className="grid grid-cols-2 gap-4">
        <SkeletonBlock className="h-20" />
        <SkeletonBlock className="h-20" />
      </div>
      <SkeletonBlock className="h-32 w-full" />
      <SkeletonBlock className="h-64 w-full" />
      <SkeletonBlock className="h-48 w-full" />
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
      <p className={`text-2xl font-bold tabular-nums ${accent ?? "text-foreground"}`}>
        {value.toLocaleString()}
      </p>
      <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
    </div>
  );
}

function MasteryBar({ stats, nameCardsEnabled }: { stats: StatsResult; nameCardsEnabled: boolean }) {
  const { totalCards, locked, learning, mastered } = stats;
  // Compute mastered + learning by rounding, then derive locked as the
  // remainder so the three segments always sum to exactly 100% — three
  // independent Math.rounds can leave a 1px gap or 1px overflow in the bar.
  const masteredPct = pct(mastered, totalCards);
  const learningPct = pct(learning, totalCards);
  const lockedPct = Math.max(0, 100 - masteredPct - learningPct);

  return (
    <section aria-labelledby="mastery-heading">
      <h2
        id="mastery-heading"
        className="mb-4 text-lg font-semibold text-foreground"
      >
        Mastery distribution{!nameCardsEnabled && <span className="ml-2 text-sm font-normal text-zinc-400 dark:text-zinc-500">(disabled)</span>}
      </h2>

      {/* Stacked bar */}
      <div
        className="flex h-6 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        role="img"
        aria-label={`Mastery distribution: ${mastered} mastered, ${learning} learning, ${locked} locked`}
      >
        {mastered > 0 && (
          <div
            className="bg-emerald-500 transition-all"
            style={{ width: `${masteredPct}%` }}
          />
        )}
        {learning > 0 && (
          <div
            className="bg-amber-400 transition-all"
            style={{ width: `${learningPct}%` }}
          />
        )}
        {locked > 0 && (
          <div
            className="bg-zinc-300 dark:bg-zinc-700 transition-all"
            style={{ width: `${lockedPct}%` }}
          />
        )}
      </div>

      {/* Legend chips */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-zinc-200 bg-background px-4 py-3 dark:border-zinc-800">
          <div className="mb-1 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Locked
            </span>
          </div>
          <p className="text-xl font-bold tabular-nums text-foreground">
            {locked.toLocaleString()}
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">{lockedPct}%</p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-background px-4 py-3 dark:border-zinc-800">
          <div className="mb-1 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Learning
            </span>
          </div>
          <p className="text-xl font-bold tabular-nums text-foreground">
            {learning.toLocaleString()}
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">{learningPct}%</p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-background px-4 py-3 dark:border-zinc-800">
          <div className="mb-1 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Mastered
            </span>
          </div>
          <p className="text-xl font-bold tabular-nums text-foreground">
            {mastered.toLocaleString()}
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">{masteredPct}%</p>
        </div>
      </div>
    </section>
  );
}

function IntroducedBar({ stats }: { stats: StatsResult }) {
  const { introduced, totalCards } = stats;
  const introPct = pct(introduced, totalCards);

  return (
    <section aria-labelledby="introduced-heading">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2
          id="introduced-heading"
          className="text-base font-semibold text-foreground"
        >
          <span className="tabular-nums">{introduced.toLocaleString()}</span>
          {" / "}
          <span className="tabular-nums">{totalCards.toLocaleString()}</span>
          {" introduced"}
        </h2>
        <span className="text-sm text-zinc-500 dark:text-zinc-400 tabular-nums">
          {introPct}%
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        role="img"
        aria-label={`${introduced} of ${totalCards} Pokémon introduced`}
      >
        <div
          className="h-full bg-blue-500 transition-all"
          style={{ width: `${introPct}%` }}
        />
      </div>
    </section>
  );
}

function DueForecast({ stats }: { stats: StatsResult }) {
  return (
    <section aria-labelledby="due-heading">
      <h2
        id="due-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        Due forecast
      </h2>
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Due today" value={stats.dueToday} accent="text-rose-600 dark:text-rose-400" />
        <StatCard label="Due tomorrow" value={stats.dueTomorrow} />
      </div>
    </section>
  );
}

function GenerationBreakdown({ stats }: { stats: StatsResult }) {
  return (
    <section aria-labelledby="gen-heading">
      <h2
        id="gen-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        By generation
      </h2>
      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              <th
                scope="col"
                className="py-2 pl-4 pr-2 text-left font-medium text-zinc-500 dark:text-zinc-400"
              >
                Generation
              </th>
              <th
                scope="col"
                className="py-2 pr-4 text-right font-medium text-zinc-500 dark:text-zinc-400"
              >
                Mastered / Total
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.perGeneration.map((gen, idx) => {
              const masteredPct = pct(gen.mastered, gen.total);
              const isLast = idx === stats.perGeneration.length - 1;
              return (
                <tr
                  key={gen.gen}
                  className={
                    isLast
                      ? ""
                      : "border-b border-zinc-100 dark:border-zinc-800/60"
                  }
                >
                  <td className="py-2.5 pl-4 pr-2 text-foreground">
                    {gen.name}
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center justify-end gap-3">
                      {/* inline bar */}
                      <div
                        className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
                        aria-hidden="true"
                      >
                        <div
                          className="h-full bg-emerald-500"
                          style={{ width: `${masteredPct}%` }}
                        />
                      </div>
                      <span className="tabular-nums text-zinc-500 dark:text-zinc-400 min-w-[64px] text-right">
                        {gen.mastered} / {gen.total}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StrugglingCards({ stats }: { stats: StatsResult }) {
  return (
    <section aria-labelledby="struggling-heading">
      <h2
        id="struggling-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        Struggling cards
      </h2>

      {stats.struggling.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No data yet — review some cards first!
        </p>
      ) : (
        <ul className="flex flex-col gap-2" role="list">
          {stats.struggling.map((card) => (
            <li
              key={card.id}
              className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-background px-4 py-2 dark:border-zinc-800"
            >
              <Image
                src={card.spriteUrl}
                alt={card.name}
                width={48}
                height={48}
                className="shrink-0 object-contain"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{card.name}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                  Ease factor: {card.easeFactor.toFixed(2)} · Reps:{" "}
                  {card.repetitions}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StatsPage() {
  const { user, supabase } = useAuth();
  const { syncState, errorMessage, syncNow } = useManualSync(supabase, user?.id ?? null);
  const [syncRefreshKey, setSyncRefreshKey] = useState(0);
  const [cards, setCards] = useState<ReviewableCard[] | null>(null);
  const [masteryRepetitions, setMasteryRepetitions] = useState<number | null>(null);
  const [nameCardsEnabled, setNameCardsEnabled] = useState(true);
  const [currentStreak, setCurrentStreak] = useState<number | null>(null);
  const [gradeTotals, setGradeTotals] = useState<GradeTotals>(() => computeGradeTotals([]));

  useEffect(() => {
    if (syncState === "success") {
      setSyncRefreshKey((k) => k + 1);
    }
  }, [syncState]);

  useEffect(() => {
    const settings = loadSettings();
    const saved = loadSession();
    if (saved !== null) {
      setCards(hydrateSession(saved.cards, SEED_POKEMON, SEED_EVOLUTION_CARDS, undefined, { reverseEnabled: settings.reverseCardsEnabled, nameEnabled: settings.nameCardsEnabled, evolutionEnabled: settings.evolutionCardsEnabled }));
    } else {
      setCards(buildSession(SEED_POKEMON, SEED_EVOLUTION_CARDS, undefined, { reverseEnabled: settings.reverseCardsEnabled, nameEnabled: settings.nameCardsEnabled, evolutionEnabled: settings.evolutionCardsEnabled }));
    }
    setMasteryRepetitions(settings.masteryRepetitions);
    setNameCardsEnabled(settings.nameCardsEnabled);
    setCurrentStreak(computeStreak(loadStreakData(), todayString(new Date())));
    setGradeTotals(computeGradeTotals(loadGradeLog()));
  }, []);

  const stats: StatsResult | null =
    cards !== null && masteryRepetitions !== null
      ? computeStats(
          cards.filter((c) => c.cardType === "name"),
          todayString(new Date()),
          10,
          masteryRepetitions,
        )
      : null;

  return (
    <div className="flex flex-1 flex-col items-center bg-background px-4 py-10 sm:py-14">
      <div className="w-full max-w-3xl">
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">
          Stats
        </h1>
        {user !== null && (
          <div className="mb-8 flex items-center justify-between gap-4">
            <SyncStatusLine refreshKey={syncRefreshKey} />
            <SyncNowButton
              syncState={syncState}
              errorMessage={errorMessage}
              onSync={syncNow}
            />
          </div>
        )}

        {stats === null || currentStreak === null ? (
          <LoadingSkeleton />
        ) : (
          <div className="flex flex-col gap-10">
            <section aria-labelledby="streak-heading">
              <h2 id="streak-heading" className="mb-3 text-base font-semibold text-foreground">
                Current streak
              </h2>
              {currentStreak > 0 ? (
                <StatCard
                  label={currentStreak === 1 ? "day in a row" : "days in a row"}
                  value={currentStreak}
                  accent="text-amber-500 dark:text-amber-400"
                />
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  No active streak — review some cards to start one!
                </p>
              )}
            </section>
            <GradeBreakdownBar
              again={gradeTotals[1]}
              hard={gradeTotals[2]}
              good={gradeTotals[4]}
              easy={gradeTotals[5]}
              label="All-time grade breakdown"
            />
            <MasteryBar stats={stats} nameCardsEnabled={nameCardsEnabled} />
            <IntroducedBar stats={stats} />
            <DueForecast stats={stats} />
            <GenerationBreakdown stats={stats} />
            <StrugglingCards stats={stats} />
          </div>
        )}
      </div>
    </div>
  );
}
