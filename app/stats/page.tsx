"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { buildSession, hydrateSession, todayString, DEFAULT_LIMITS, type ReviewableCard } from "@/lib/review/session";
import { formatDate, type DateFormat } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/cn";
import { cardPanel, colStack, mutedText } from "@/lib/utils/class-names";
import { loadSession, saveSession, bumpSessionStorageKey, STORAGE_KEY as SESSION_STORAGE_KEY } from "@/lib/review/persistence";
import { SEED_POKEMON, SEED_EVOLUTION_CARDS } from "@/lib/pokemon/seed";
import { computeStats } from "@/lib/stats/derive";
import type { StatsResult } from "@/lib/stats/derive";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { BADGE_CATALOG } from "@/lib/badges/catalog";
import { checkBadges } from "@/lib/badges/check";
import { masteredSpeciesIds } from "@/lib/badges/derive";
import { computeStreak, loadStreakData } from "@/lib/streak";
import { saveStreakData } from "@/lib/streak/persistence";
import { loadGradeLog, saveGradeLog, computeGradeTotals, type GradeTotals } from "@/lib/gradelog/persistence";
import { pullSettingsWithTimestamp, pullRegionalPrefs } from "@/lib/sync/settings";
import { pullStreak } from "@/lib/sync/streak";
import { pullGradeLog } from "@/lib/sync/gradeLog";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";
import { computeAccuracySparkline, computeRollingAccuracy } from "@/lib/stats/accuracy";
import type { AccuracyPoint } from "@/lib/stats/accuracy";
import { computeDirectionBreakdown, enabledDirectionsFromSettings } from "@/lib/stats/direction-breakdown";
import { computeDifficultyHistogram, meanDifficulty } from "@/lib/stats/difficulty-histogram";
import { computeRetentionComparison } from "@/lib/stats/retention";
import { computeGradeDistribution, computeGradeTrend } from "@/lib/stats/grade-distribution";
import { computeCompletionProjection } from "@/lib/stats/completion-projection";
import { CompletionProjection } from "@/components/stats/CompletionProjection";
import { computeMasteryOverTime } from "@/lib/stats/mastery-over-time";
import { GradeBreakdownBar } from "@/components/stats/GradeBreakdownBar";
import { GradeDistributionChart } from "@/components/stats/GradeDistributionChart";
import { MasteryOverTimeChart } from "@/components/stats/MasteryOverTimeChart";
import { AccuracySparkline } from "@/components/stats/AccuracySparkline";
import { DirectionBreakdownChart } from "@/components/stats/DirectionBreakdownChart";
import { DifficultyHistogram } from "@/components/stats/DifficultyHistogram";
import { RetentionIndicator } from "@/components/stats/RetentionIndicator";
import { DirectionBadge } from "@/components/review/DirectionBadge";
import { ReviewHeatmap } from "@/components/stats/ReviewHeatmap";
import { computeReviewHeatmap } from "@/lib/stats/heatmap";
import { ActivityHistoryChart } from "@/components/stats/ActivityHistoryChart";
import { computeActivityHistory } from "@/lib/stats/activity-history";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";
import { SyncStatusLine } from "@/components/stats/SyncStatusLine";
import { useAuth } from "@/lib/auth/AuthContext";
import { useRetryPush } from "@/lib/sync/useRetryPush";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { pullSession, applyCloudAuthoritative, maxCloudUpdatedAt } from "@/lib/sync/cloud";
import { seedOptsFromSettings } from "@/lib/review/seedOpts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a YYYY-MM-DD date for the due-forecast tooltip / aria-label.
 * Uses en-GB English month/weekday names to avoid locale-leaking French or
 * German names on non-English browser locales. fmt and tz come from user
 * settings; they default to dmy / UTC when not yet set.
 */
function formatForecastDate(
  iso: string,
  fmt: DateFormat = "dmy",
  tz = "UTC",
): string {
  return formatDate(iso, fmt, tz);
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
      <SkeletonBlock className="h-12 w-full" />
      <SkeletonBlock className="h-28 w-full" />
      <SkeletonBlock className="h-32 w-full" />
      <SkeletonBlock className="h-64 w-full" />
      <SkeletonBlock className="h-48 w-full" />
    </div>
  );
}

function DueForecast({
  stats,
  fmt = "dmy",
  tz = "UTC",
}: {
  stats: StatsResult;
  fmt?: DateFormat;
  tz?: string;
}) {
  const forecast = stats.dueForecast;
  const max = forecast.reduce((m, d) => (d.count > m ? d.count : m), 0);
  const total = forecast.reduce((s, d) => s + d.count, 0);

  return (
    <section aria-labelledby="due-heading">
      <h2
        id="due-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        Due forecast
      </h2>
      <div className={cardPanel}>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
          {total.toLocaleString('en-GB')} card{total === 1 ? "" : "s"} over the next 14
          days
        </p>
        <div
          className="grid h-24 grid-cols-[repeat(14,minmax(0,1fr))] items-end gap-1"
          role="img"
          aria-label={`14-day due forecast: ${forecast
            .map((d) => `${formatForecastDate(d.date, fmt, tz)} ${d.count}`)
            .join(", ")}`}
        >
          {forecast.map((day, idx) => {
            const heightPct = max === 0 ? 0 : (day.count / max) * 100;
            const isToday = idx === 0;
            return (
              <div
                key={day.date}
                className="group relative flex h-full flex-col justify-end"
                title={`${formatForecastDate(day.date, fmt, tz)} · ${day.count} card${day.count === 1 ? "" : "s"}`}
              >
                <div
                  className={
                    isToday
                      ? "rounded-sm bg-rose-500"
                      : "rounded-sm bg-emerald-500/60 group-hover:bg-emerald-500"
                  }
                  style={{
                    height: heightPct === 0 ? "2px" : `${Math.max(heightPct, 6)}%`,
                  }}
                  aria-hidden="true"
                />
              </div>
            );
          })}
        </div>
        <div className="mt-2 grid grid-cols-[repeat(14,minmax(0,1fr))] gap-1 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
          {forecast.map((day, idx) => (
            <span key={day.date} className="text-center">
              {idx === 0
                ? "Today"
                : new Date(day.date).getDate()}
            </span>
          ))}
        </div>
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
        <p className={mutedText}>
          No struggling cards yet. Keep it up!
        </p>
      ) : (
        <ul className={colStack} role="list">
          {stats.struggling.map((card) => (
            <li key={card.id}>
              <Link
                href={`/pokedex/${card.id}`}
                aria-label={`View ${card.name} in Pokédex`}
                className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-background px-4 py-2 transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:border-zinc-800 dark:hover:bg-zinc-900"
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
                <DirectionBadge direction="name" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// ForcePullSection — recovery button visible only when signed in
// ---------------------------------------------------------------------------

type ForcePullStatus = "idle" | "pulling" | "success" | "error";

function ForcePullSection({
  supabase,
  userId,
  onSuccess,
}: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  userId: string;
  onSuccess: (cards: ReviewableCard[]) => void;
}) {
  const [status, setStatus] = useState<ForcePullStatus>("idle");

  async function handleForcePull() {
    const confirmed = window.confirm(
      "This will replace your local progress, settings, and display preferences with what's currently in the cloud. Continue?",
    );
    if (!confirmed) return;

    setStatus("pulling");
    try {
      const [
        cloudRows,
        pulledSettings,
        cloudPrefs,
        cloudStreak,
        cloudGradeLog,
      ] = await Promise.all([
        pullSession(supabase, userId),
        pullSettingsWithTimestamp(supabase, userId).catch(() => null),
        pullRegionalPrefs(supabase, userId).catch(() => null),
        pullStreak(supabase, userId).catch(() => null),
        pullGradeLog(supabase, userId).catch(() => null),
      ]);

      if (cloudRows === null) {
        setStatus("error");
        return;
      }

      if (pulledSettings !== null) {
        saveSettings(pulledSettings.settings);
      }

      if (cloudPrefs !== null) {
        const local = loadSettings();
        const next = {
          ...local,
          ...(cloudPrefs.timezone !== null ? { timezone: cloudPrefs.timezone } : {}),
          ...(cloudPrefs.dateFormat !== null ? { dateFormat: cloudPrefs.dateFormat } : {}),
        };
        if (next.timezone !== local.timezone || next.dateFormat !== local.dateFormat) {
          saveSettings(next);
        }
      }

      const settings = loadSettings();
      const opts = seedOptsFromSettings(settings);
      const cards = applyCloudAuthoritative(
        SEED_POKEMON,
        SEED_EVOLUTION_CARDS,
        cloudRows,
        opts,
      );

      if (cloudStreak !== null) {
        saveStreakData([...cloudStreak].sort());
      }
      if (cloudGradeLog !== null) {
        await saveGradeLog(cloudGradeLog);
      }

      const saved = await loadSession();
      const limits = saved?.limits ?? DEFAULT_LIMITS;
      const result = await saveSession({ cards, limits });

      if (!result.ok) {
        setStatus("error");
        return;
      }

      const syncStatus = loadSyncStatus();
      saveSyncStatus({
        ...syncStatus,
        lastPullAt: maxCloudUpdatedAt(cloudRows),
        ...(pulledSettings?.updatedAt !== undefined &&
        pulledSettings.updatedAt !== null
          ? { lastSettingsPullAt: pulledSettings.updatedAt }
          : {}),
      });

      bumpSessionStorageKey();

      onSuccess(cards);
      setStatus("success");
      setTimeout(() => setStatus("idle"), 4000);
    } catch {
      setStatus("error");
    }
  }

  return (
    <section aria-labelledby="force-pull-heading">
      <h2
        id="force-pull-heading"
        className="mb-1 text-base font-semibold text-foreground"
      >
        Data
      </h2>
      <p className={cn("mb-3", mutedText)}>
        Use this if your stats look wrong; it pulls authoritative data from the cloud.
      </p>
      <button
        type="button"
        onClick={() => void handleForcePull()}
        disabled={status === "pulling"}
        aria-busy={status === "pulling"}
        className="rounded-lg border border-zinc-200 bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {status === "pulling" ? "Pulling from cloud…" : "Force pull from cloud"}
      </button>
      {status === "success" && (
        <p
          role="status"
          aria-live="polite"
          className="mt-2 text-sm text-emerald-600 dark:text-emerald-400"
        >
          Done. Stats updated from cloud.
        </p>
      )}
      {status === "error" && (
        <p
          role="alert"
          aria-live="assertive"
          className="mt-2 text-sm text-rose-600 dark:text-rose-400"
        >
          Pull failed. Check your connection and try again.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section heading
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-semibold text-foreground">
      {children}
    </h2>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StatsPage() {
  const { user, supabase } = useAuth();
  const { flags, anyFlagOn } = useSuperuser();
  const client = anyFlagOn ? null : supabase;
  const userId = anyFlagOn ? null : (user?.id ?? null);
  const { retryState, retryNow } = useRetryPush(client, userId);
  const storageVersion = useLocalStorageKey(SESSION_STORAGE_KEY);
  const [cards, setCards] = useState<ReviewableCard[] | null>(null);
  const [masteryRepetitions, setMasteryRepetitions] = useState<number | null>(null);
  const [cardTypeSettings, setCardTypeSettings] = useState<{
    nameCardsEnabled: boolean;
    evolutionCardsEnabled: boolean;
    reverseEvolutionCardsEnabled: boolean;
    reverseCardsEnabled: boolean;
    cryCardsEnabled: boolean;
  }>({
    nameCardsEnabled: true,
    evolutionCardsEnabled: true,
    reverseEvolutionCardsEnabled: false,
    reverseCardsEnabled: false,
    cryCardsEnabled: false,
  });
  const [userTimezone, setUserTimezone] = useState("UTC");
  const [userDateFormat, setUserDateFormat] = useState<DateFormat>("dmy");
  const [gradeTotals, setGradeTotals] = useState<GradeTotals>(() => computeGradeTotals([]));
  const [accuracyPoints, setAccuracyPoints] = useState<AccuracyPoint[]>([]);
  const [rolling7d, setRolling7d] = useState<number | null>(null);
  const [rolling30d, setRolling30d] = useState<number | null>(null);
  const [rolling365d, setRolling365d] = useState<number | null>(null);
  const [accuracyPoints365, setAccuracyPoints365] = useState<AccuracyPoint[]>([]);
  const [gradeLog, setGradeLog] = useState<Awaited<ReturnType<typeof loadGradeLog>>>([]);
  const [retentionTarget, setRetentionTarget] = useState(0.9);

  useEffect(() => {
    async function load() {
      const settings = loadSettings();
      if (settings.timezone) setUserTimezone(settings.timezone);
      if (settings.dateFormat) setUserDateFormat(settings.dateFormat);
      const saved = await loadSession();
      const sessionCards = saved !== null
        ? hydrateSession(saved.cards, SEED_POKEMON, SEED_EVOLUTION_CARDS, undefined, { reverseEnabled: settings.reverseCardsEnabled, nameEnabled: settings.nameCardsEnabled, evolutionEnabled: settings.evolutionCardsEnabled })
        : buildSession(SEED_POKEMON, SEED_EVOLUTION_CARDS, undefined, { reverseEnabled: settings.reverseCardsEnabled, nameEnabled: settings.nameCardsEnabled, evolutionEnabled: settings.evolutionCardsEnabled });
      setCards(sessionCards);
      setMasteryRepetitions(settings.masteryRepetitions);
      setCardTypeSettings({
        nameCardsEnabled: settings.nameCardsEnabled,
        evolutionCardsEnabled: settings.evolutionCardsEnabled,
        reverseEvolutionCardsEnabled: settings.reverseEvolutionCardsEnabled,
        reverseCardsEnabled: settings.reverseCardsEnabled,
        cryCardsEnabled: settings.cryCardsEnabled,
      });
      setRetentionTarget(settings.retentionTarget);
      const tz = settings.timezone ?? "UTC";
      const today = todayString(new Date(), tz);
      const log = await loadGradeLog();
      setGradeLog(log);
      setGradeTotals(computeGradeTotals(log));
      setAccuracyPoints(computeAccuracySparkline(log, today, 30));
      setRolling7d(computeRollingAccuracy(log, today, 7));
      setRolling30d(computeRollingAccuracy(log, today, 30));
      setRolling365d(computeRollingAccuracy(log, today, 365));
      setAccuracyPoints365(computeAccuracySparkline(log, today, 365));

      // Retroactive badge award (#420). If a user already meets a badge's
      // criterion when the feature ships (or after a sync pull), award it
      // silently — no toast. The reveal toast only fires on the grade event
      // that crosses the threshold (`ReviewSession.handleGrade`). We never
      // award retroactively while a superuser flag is on; the catalog-wide
      // overlay on Journey covers that QA case without touching persisted state.
      // This check is idempotent: `checkBadges` only returns badges not already
      // in `earnedIdSet`, so running it on both Stats and Journey is safe.
      if (!anyFlagOn) {
        const masteredIds = masteredSpeciesIds(
          sessionCards,
          settings.masteryRepetitions,
          false,
        );
        const earnedIdSet = new Set(settings.earnedBadges.map((b) => b.id));
        const newlyEarned = checkBadges(masteredIds, BADGE_CATALOG, earnedIdSet);
        if (newlyEarned.length > 0) {
          const nowIso = new Date().toISOString();
          const nextEntries = [
            ...settings.earnedBadges,
            ...newlyEarned.map((b) => ({ id: b.id, earnedAt: nowIso })),
          ];
          saveSettings({ ...settings, earnedBadges: nextEntries });
        }
      }

      if (supabase !== null && user !== null && !anyFlagOn) {
        try {
          const cloudRows = await pullSession(supabase, user.id);
          if (cloudRows !== null) {
            const opts = seedOptsFromSettings(settings);
            const cloudCards = applyCloudAuthoritative(
              SEED_POKEMON,
              SEED_EVOLUTION_CARDS,
              cloudRows,
              opts,
            );
            setCards(cloudCards);
          }
        } catch (err) {
          console.warn("[stats] cloud hydration failed, falling back to local", err);
        }
      }
    }
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageVersion, anyFlagOn, supabase, user]);

  const nameCards =
    cards !== null
      ? (cards.filter((c) => c.cardType === "name") as Parameters<typeof computeStats>[0])
      : null;

  const stats: StatsResult | null =
    nameCards !== null && masteryRepetitions !== null
      ? computeStats(
          nameCards,
          todayString(new Date()),
          10,
          masteryRepetitions,
          flags.pretendAllMastered,
        )
      : null;

  const completionProjection =
    nameCards !== null && masteryRepetitions !== null
      ? computeCompletionProjection(
          nameCards,
          todayString(new Date()),
          masteryRepetitions,
          flags.pretendAllMastered,
        )
      : null;

  const reviewCharts =
    cards !== null
      ? (() => {
          const today = todayString(new Date(), userTimezone);
          return {
            directionRows: computeDirectionBreakdown(
              gradeLog,
              enabledDirectionsFromSettings(cardTypeSettings),
            ),
            retentionComparison: computeRetentionComparison(
              gradeLog,
              today,
              retentionTarget,
            ),
            difficultyBuckets: computeDifficultyHistogram(
              cards,
              flags.pretendAllMastered,
            ),
            difficultyMean: meanDifficulty(cards, flags.pretendAllMastered),
            gradeDistribution: computeGradeDistribution(gradeLog),
            gradeTrend: computeGradeTrend(gradeLog, today, 12),
            activityHistory: computeActivityHistory(gradeLog, today, 365),
            masteryOverTime: computeMasteryOverTime(
              nameCards!,
              today,
              masteryRepetitions ?? undefined,
              flags.pretendAllMastered,
            ),
          };
        })()
      : null;

  return (
    <div className="flex flex-1 flex-col items-center bg-background px-4 py-10 sm:py-14">
      <div className="w-full max-w-3xl">
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">
          Stats
        </h1>
        {user !== null && (
          <div className="mb-8">
            <SyncStatusLine
              retryState={retryState}
              retryNow={retryNow}
              superuserPaused={anyFlagOn}
            />
          </div>
        )}

        {stats === null ? (
          <LoadingSkeleton />
        ) : (
          <div className="flex flex-col gap-10">

            {/* Accuracy section */}
            <section aria-labelledby="accuracy-section-heading" className="flex flex-col gap-6">
              <SectionHeading>
                <span id="accuracy-section-heading">Accuracy</span>
              </SectionHeading>
              <GradeBreakdownBar
                again={gradeTotals[1]}
                hard={gradeTotals[2]}
                good={gradeTotals[4]}
                easy={gradeTotals[5]}
                label="All-time grade breakdown"
              />
              <AccuracySparkline
                points={accuracyPoints}
                rolling7d={rolling7d}
                rolling30d={rolling30d}
                rolling365d={rolling365d}
                points365={accuracyPoints365}
              />
              {reviewCharts !== null && (
                <>
                  <GradeDistributionChart
                    distribution={reviewCharts.gradeDistribution}
                    trend={reviewCharts.gradeTrend}
                  />
                  <RetentionIndicator comparison={reviewCharts.retentionComparison} />
                  <DirectionBreakdownChart rows={reviewCharts.directionRows} />
                  <DifficultyHistogram
                    buckets={reviewCharts.difficultyBuckets}
                    mean={reviewCharts.difficultyMean}
                  />
                </>
              )}
            </section>

            {/* Activity section */}
            <section aria-labelledby="activity-section-heading" className="flex flex-col gap-6">
              <SectionHeading>
                <span id="activity-section-heading">Activity</span>
              </SectionHeading>
              <ReviewHeatmap
                columns={computeReviewHeatmap(gradeLog, todayString(new Date(), userTimezone))}
              />
              {reviewCharts !== null && (
                <>
                  <ActivityHistoryChart
                    series={reviewCharts.activityHistory}
                    dateFormat={userDateFormat}
                  />
                  <MasteryOverTimeChart
                    series={reviewCharts.masteryOverTime}
                    totalCards={stats.totalCards}
                    dateFormat={userDateFormat}
                    forceAllMastered={flags.pretendAllMastered}
                  />
                </>
              )}
            </section>

            {/* Scheduling section */}
            <section aria-labelledby="scheduling-section-heading" className="flex flex-col gap-6">
              <SectionHeading>
                <span id="scheduling-section-heading">Scheduling</span>
              </SectionHeading>
              <OnboardingHint id="statsHintDismissed" title="What &quot;mastered&quot; means">
                <p>
                  A card is mastered once you&apos;ve recalled it correctly{" "}
                  {masteryRepetitions} time{masteryRepetitions === 1 ? "" : "s"}{" "}
                  in a row <em>and</em> the next review is scheduled at least 21
                  days out: that&apos;s when the scheduler is confident
                  you&apos;ve actually learnt it, not just memorised it short
                  term.
                </p>
              </OnboardingHint>
              {completionProjection !== null && (
                <CompletionProjection
                  projection={completionProjection}
                  fmt={userDateFormat}
                  tz={userTimezone}
                />
              )}
              <DueForecast stats={stats} fmt={userDateFormat} tz={userTimezone} />
              <StrugglingCards stats={stats} />
            </section>

            {user !== null && supabase !== null && !anyFlagOn && (
              <ForcePullSection
                supabase={supabase}
                userId={user.id}
                onSuccess={setCards}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
