"use client";

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { buildSession, hydrateSession, todayString, DEFAULT_LIMITS, buildSessionQueues, type ReviewableCard, type DailyLimits } from "@/lib/review/session";
import { computeEligibleCardIds, type EligibilitySettings, EMPTY_SCOPE, type PracticeScope } from "@/lib/review/scope";
import { type DateFormat } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/cn";
import { colStack, mutedText } from "@/lib/utils/class-names";
import { loadSession, saveSession, bumpSessionStorageKey, STORAGE_KEY as SESSION_STORAGE_KEY } from "@/lib/review/persistence";
import { SEED_POKEMON, SEED_EVOLUTION_CARDS } from "@/lib/pokemon/seed";
import { computeStats, MASTERY_INTERVAL_DAYS } from "@/lib/stats/derive";
import type { StatsResult, DueForecastDay } from "@/lib/stats/derive";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { BADGE_CATALOG } from "@/lib/badges/catalog";
import { checkBadges } from "@/lib/badges/check";
import { masteredSpeciesIds } from "@/lib/badges/derive";
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
import DueForecast from "@/components/stats/DueForecast";
import { FirstMasteryHint } from "@/components/stats/FirstMasteryHint";
import { projectTimeToFirstMastery } from "@/lib/srs/timeToMastery";
import { computeMasteryOverTime } from "@/lib/stats/mastery-over-time";
import { GradeBreakdownBar } from "@/components/stats/GradeBreakdownBar";
import { AccuracySparkline } from "@/components/stats/AccuracySparkline";
import { DirectionBadge } from "@/components/review/DirectionBadge";
import { ReviewHeatmap } from "@/components/stats/ReviewHeatmap";
import { computeReviewHeatmap } from "@/lib/stats/heatmap";
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
// Due-forecast today-bar parity helper (#1117)
// ---------------------------------------------------------------------------

/**
 * Replaces the today-bar count (index 0) in a due-forecast array with the
 * exact queue total from `buildSessionQueues` so it matches what the Practice
 * page displays. Future bars (indices 1–13) are left unchanged.
 *
 * The discrepancy existed because `computeStats` only counted introduced name
 * cards due today, ignoring new cards (no review history) and all non-name card
 * types (evolution, reverse, cry). Using `buildSessionQueues` with the same
 * eligibility set as the Practice page removes all three gaps.
 *
 * Pure — no I/O, no side effects. Exported for unit testing.
 */
export function patchForecastTodayBar(
  forecast: readonly DueForecastDay[],
  cards: readonly ReviewableCard[],
  eligibilitySettings: EligibilitySettings,
  limits: DailyLimits,
  today: string,
): readonly DueForecastDay[] {
  if (forecast.length === 0) return forecast;
  const eligibleCardIds = computeEligibleCardIds(cards, eligibilitySettings);
  const { newQueue, learningCardIds, reviewQueue } = buildSessionQueues(
    cards,
    limits,
    today,
    eligibleCardIds,
  );
  const todayCount = newQueue.length + learningCardIds.length + reviewQueue.length;
  return [{ ...forecast[0], count: todayCount }, ...forecast.slice(1)];
}

// ---------------------------------------------------------------------------
// Lazily-loaded Recharts chart components.
//
// `ssr: false` is valid here because this file is a Client Component
// (`"use client"` directive above). Recharts is excluded from the initial
// JS bundle and fetched only when the Stats page is first visited.
// ---------------------------------------------------------------------------

/** Shared placeholder rendered while a chart chunk is downloading. */
function ChartPlaceholder() {
  return (
    <div
      className="animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800 h-32 w-full"
      aria-hidden="true"
    />
  );
}

const GradeDistributionChart = dynamic(
  () => import("@/components/stats/GradeDistributionChart").then((m) => m.GradeDistributionChart),
  { ssr: false, loading: () => <ChartPlaceholder /> },
);

const MasteryOverTimeChart = dynamic(
  () => import("@/components/stats/MasteryOverTimeChart").then((m) => m.MasteryOverTimeChart),
  { ssr: false, loading: () => <ChartPlaceholder /> },
);

const DirectionBreakdownChart = dynamic(
  () => import("@/components/stats/DirectionBreakdownChart").then((m) => m.DirectionBreakdownChart),
  { ssr: false, loading: () => <ChartPlaceholder /> },
);

const DifficultyHistogram = dynamic(
  () => import("@/components/stats/DifficultyHistogram").then((m) => m.DifficultyHistogram),
  { ssr: false, loading: () => <ChartPlaceholder /> },
);

const RetentionIndicator = dynamic(
  () => import("@/components/stats/RetentionIndicator").then((m) => m.RetentionIndicator),
  { ssr: false, loading: () => <ChartPlaceholder /> },
);

const ActivityHistoryChart = dynamic(
  () => import("@/components/stats/ActivityHistoryChart").then((m) => m.ActivityHistoryChart),
  { ssr: false, loading: () => <ChartPlaceholder /> },
);

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
  const [alternateFormsEnabled, setAlternateFormsEnabled] = useState(false);
  const [practiceScope, setPracticeScope] = useState<PracticeScope>(EMPTY_SCOPE);
  const [sessionLimits, setSessionLimits] = useState<DailyLimits>(DEFAULT_LIMITS);
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
      setAlternateFormsEnabled(settings.alternateFormsEnabled);
      setPracticeScope(settings.practiceScope);
      setSessionLimits(saved?.limits ?? DEFAULT_LIMITS);
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

  // Patch the today bar (#1117): replace dueForecast[0] with the exact queue
  // total from buildSessionQueues so it matches the Practice page display.
  // Future bars (indices 1–13) are left as-is — only today is in scope.
  const patchedForecast: readonly DueForecastDay[] | null =
    stats !== null && cards !== null
      ? patchForecastTodayBar(
          stats.dueForecast,
          cards,
          {
            nameCardsEnabled: cardTypeSettings.nameCardsEnabled,
            evolutionCardsEnabled: cardTypeSettings.evolutionCardsEnabled,
            reverseCardsEnabled: cardTypeSettings.reverseCardsEnabled,
            reverseEvolutionCardsEnabled: cardTypeSettings.reverseEvolutionCardsEnabled,
            cryCardsEnabled: cardTypeSettings.cryCardsEnabled,
            alternateFormsEnabled,
            practiceScope,
          },
          sessionLimits,
          todayString(new Date()),
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

  // Time-to-first-mastery hint (#1083). Show only when the user has at least
  // one introduced card, zero mastered cards, and the projection helper
  // produced a finite estimate. The helper already returns null when the
  // superuser pretendAllMastered flag is on, so the hint hides under cheats.
  const firstMasteryDays =
    nameCards !== null &&
    masteryRepetitions !== null &&
    stats !== null &&
    stats.introduced > 0 &&
    stats.mastered === 0
      ? projectTimeToFirstMastery(
          nameCards,
          new Date(),
          masteryRepetitions,
          flags.pretendAllMastered,
          { retentionTarget },
        ).days
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
      <div className="w-full max-w-3xl lg:max-w-6xl">
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

            {/*
              At lg: the Accuracy and Activity sections sit side-by-side in a
              2-column grid. On smaller screens they stack vertically as before.
            */}
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-start">

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

            </div>

            {/* Scheduling section — full width on all breakpoints */}
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
              {firstMasteryDays !== null && masteryRepetitions !== null && (
                <FirstMasteryHint
                  days={firstMasteryDays}
                  masteryReps={masteryRepetitions}
                  masteryDays={MASTERY_INTERVAL_DAYS}
                />
              )}
              {completionProjection !== null && (
                <CompletionProjection
                  projection={completionProjection}
                  fmt={userDateFormat}
                  tz={userTimezone}
                />
              )}
              <DueForecast forecast={patchedForecast ?? stats.dueForecast} fmt={userDateFormat} tz={userTimezone} />
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
