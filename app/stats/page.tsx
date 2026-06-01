"use client";

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useEffect, useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { buildSession, hydrateSession, todayString, DEFAULT_LIMITS, type ReviewableCard, type DailyLimits } from "@/lib/review/session";
import { EMPTY_SCOPE, type PracticeScope } from "@/lib/review/scope";
import { type DateFormat } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/cn";
import { colStack, mutedText, mutedTextXs } from "@/lib/utils/class-names";
import { loadSession, saveSession, bumpSessionStorageKey, STORAGE_KEY as SESSION_STORAGE_KEY } from "@/lib/review/persistence";
import { SEED_POKEMON, SEED_EVOLUTION_CARDS } from "@/lib/pokemon/seed";
import { MASTERY_INTERVAL_DAYS } from "@/lib/stats/derive";
import type { StrugglingCard } from "@/lib/stats/derive";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { BADGE_CATALOG } from "@/lib/badges/catalog";
import { checkBadges } from "@/lib/badges/check";
import { masteredSpeciesIds } from "@/lib/badges/derive";
import { saveStreakData } from "@/lib/streak/persistence";
import { runStreakProtection } from "@/lib/streak/runProtection";
import { StreakProtectionCard } from "@/components/stats/StreakProtectionCard";
import { loadGradeLog, saveGradeLog, computeGradeTotals, type GradeTotals } from "@/lib/gradelog/persistence";
import { pullSettingsWithTimestamp, pullRegionalPrefs } from "@/lib/sync/settings";
import { pullStreak } from "@/lib/sync/streak";
import { pullGradeLog } from "@/lib/sync/gradeLog";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";
import { computeAccuracySparkline, computeRollingAccuracy } from "@/lib/stats/accuracy";
import type { AccuracyPoint } from "@/lib/stats/accuracy";
import { computeDirectionBreakdown, enabledDirectionsFromSettings } from "@/lib/stats/direction-breakdown";
import { computeRetentionComparison } from "@/lib/stats/retention";
import { computeGradeDistribution, computeGradeTrend } from "@/lib/stats/grade-distribution";
import { type DashboardSnapshot } from "@/lib/stats/dashboard-snapshot";
import { useDashboardSnapshot, useProvideDashboardSnapshotInput } from "@/components/stats/DashboardSnapshotContext";
import { CompletionProjection } from "@/components/stats/CompletionProjection";
import DueForecast from "@/components/stats/DueForecast";
import { FirstMasteryHint } from "@/components/stats/FirstMasteryHint";
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
import { computePerGameStats, type GameStats } from "@/lib/stats/per-game";
import { GameBreakdown } from "@/components/stats/GameBreakdown";
import type { AppLocale } from "@/i18n/locales";
import { STATS_SPRITE_SIZE } from "@/lib/sprites/sizes";

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

function LoadingSkeleton({ ariaLabel }: { ariaLabel: string }) {
  return (
    <div
      className="flex flex-col gap-8"
      aria-busy="true"
      aria-label={ariaLabel}
    >
      <SkeletonBlock className="h-12 w-full" />
      <SkeletonBlock className="h-28 w-full" />
      <SkeletonBlock className="h-32 w-full" />
      <SkeletonBlock className="h-64 w-full" />
      <SkeletonBlock className="h-48 w-full" />
    </div>
  );
}


function StrugglingCards({ struggling }: { struggling: readonly StrugglingCard[] }) {
  const t = useTranslations("stats");
  const tCommon = useTranslations("common");
  return (
    <section aria-labelledby="struggling-heading">
      <h2
        id="struggling-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        {t("strugglingCards.heading")}
      </h2>

      {struggling.length === 0 ? (
        <p className={mutedText}>
          {t("strugglingCards.empty")}
        </p>
      ) : (
        <ul className={colStack} role="list">
          {struggling.map((card) => (
            <li key={card.id}>
              <Link
                href={`/pokedex/${card.id}`}
                aria-label={tCommon("viewInPokedex", { name: card.name })}
                className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-background px-4 py-2 transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                <Image
                  src={card.spriteUrl}
                  alt={card.name}
                  width={STATS_SPRITE_SIZE}
                  height={STATS_SPRITE_SIZE}
                  className="shrink-0 object-contain"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{card.name}</p>
                  <p className={`${mutedTextXs} tabular-nums`}>
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
  const t = useTranslations("stats");
  const [status, setStatus] = useState<ForcePullStatus>("idle");

  async function handleForcePull() {
    const confirmed = window.confirm(t("forcePull.confirmMessage"));
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
        {t("forcePull.heading")}
      </h2>
      <p className={cn("mb-3", mutedText)}>
        {t("forcePull.description")}
      </p>
      <button
        type="button"
        onClick={() => void handleForcePull()}
        disabled={status === "pulling"}
        aria-busy={status === "pulling"}
        className="rounded-lg border border-zinc-200 bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {status === "pulling" ? t("forcePull.pulling") : t("forcePull.button")}
      </button>
      {status === "success" && (
        <p
          role="status"
          aria-live="polite"
          className="mt-2 text-sm text-emerald-600 dark:text-emerald-400"
        >
          {t("forcePull.success")}
        </p>
      )}
      {status === "error" && (
        <p
          role="alert"
          aria-live="assertive"
          className="mt-2 text-sm text-rose-600 dark:text-rose-400"
        >
          {t("forcePull.error")}
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
  const t = useTranslations("stats");
  const tCommon = useTranslations("common");
  const { user, supabase } = useAuth();
  const { flags, anyFlagOn } = useSuperuser();
  const client = anyFlagOn ? null : supabase;
  const userId = anyFlagOn ? null : (user?.id ?? null);
  const { retryState, retryNow } = useRetryPush(client, userId);
  const storageVersion = useLocalStorageKey(SESSION_STORAGE_KEY);
  const [cards, setCards] = useState<ReviewableCard[] | null>(null);
  const [masteryRepetitions, setMasteryRepetitions] = useState<number | null>(null);
  const [pokemonNameLocale, setPokemonNameLocale] = useState<AppLocale>("en");
  const [cardTypeSettings, setCardTypeSettings] = useState<{
    evolutionCardsEnabled: boolean;
    reverseEvolutionCardsEnabled: boolean;
    cryCardsEnabled: boolean;
  }>({
    evolutionCardsEnabled: true,
    reverseEvolutionCardsEnabled: false,
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
      // Load settings first so the protection pass can evaluate `today` in
      // the user's timezone — the `streakDates` set is populated using the
      // user's local tz (see ReviewSession), so running protection against
      // UTC would cause off-by-one boundary errors at high UTC offsets.
      const settings = loadSettings();
      if (settings.timezone) setUserTimezone(settings.timezone);
      // Drive a streak-protection pass on every Stats mount so a missed-day
      // token spend (if any) is recorded before the page renders the
      // protection card (#1227). Idempotent across same-day mounts.
      runStreakProtection(todayString(new Date(), settings.timezone ?? "UTC"));
      if (settings.dateFormat) setUserDateFormat(settings.dateFormat);
      const saved = await loadSession();
      const sessionCards = saved !== null
        ? hydrateSession(saved.cards, SEED_POKEMON, SEED_EVOLUTION_CARDS, undefined, { reverseEnabled: true, nameEnabled: true, evolutionEnabled: settings.evolutionCardsEnabled }).cards
        : buildSession(SEED_POKEMON, SEED_EVOLUTION_CARDS, undefined, { reverseEnabled: true, nameEnabled: true, evolutionEnabled: settings.evolutionCardsEnabled });
      setCards(sessionCards);
      setMasteryRepetitions(settings.masteryRepetitions);
      setPokemonNameLocale(settings.pokemonNameLocale);
      setCardTypeSettings({
        evolutionCardsEnabled: settings.evolutionCardsEnabled,
        reverseEvolutionCardsEnabled: settings.reverseEvolutionCardsEnabled,
        cryCardsEnabled: settings.cryCardsEnabled,
      });
      setAlternateFormsEnabled(settings.alternateFormsEnabled);
      setPracticeScope(settings.practiceScope);
      // Derive limits from settings (same source of truth as ReviewSession.tsx).
      // Reading saved?.limits would lag settings changes until the next session
      // save, breaking parity the moment the user raises a daily cap.
      setSessionLimits({
        name: { maxNewPerDay: settings.maxNewPerDay, maxReviewsPerDay: settings.maxReviewsPerDay },
        evolution: { maxNewPerDay: settings.maxNewEvolutionPerDay, maxReviewsPerDay: settings.maxReviewsEvolutionPerDay },
        reverse: { maxNewPerDay: settings.maxNewReversePerDay, maxReviewsPerDay: settings.maxReviewsReversePerDay },
        cry: { maxNewPerDay: settings.maxNewCryPerDay, maxReviewsPerDay: settings.maxReviewsCryPerDay },
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

  // Per-game mastery breakdown (#1313). Recomputed whenever cards change or
  // the superuser flag toggles. SEED_POKEMON is a stable module-level const so
  // it does not need to be in the deps array.
  const perGame = useMemo<GameStats[]>(() => {
    if (cards === null || masteryRepetitions === null) return [];
    return computePerGameStats(
      cards,
      SEED_POKEMON,
      masteryRepetitions,
      flags.pretendAllMastered,
    );
  }, [cards, masteryRepetitions, flags.pretendAllMastered]);

  // Provide the full snapshot input to the shared DashboardSnapshotContext.
  // Stats reads all axes from the returned snapshot (#1139, simplified in #1151).
  const snapshotSettings = useMemo(() => ({
    evolutionCardsEnabled: cardTypeSettings.evolutionCardsEnabled,
    reverseEvolutionCardsEnabled: cardTypeSettings.reverseEvolutionCardsEnabled,
    cryCardsEnabled: cardTypeSettings.cryCardsEnabled,
    alternateFormsEnabled,
    practiceScope,
  }), [cardTypeSettings, alternateFormsEnabled, practiceScope]);

  const snapshotOptions = useMemo(() => ({
    masteryRepetitions: masteryRepetitions ?? undefined,
    forceAllMastered: flags.pretendAllMastered,
    retentionTarget,
    locale: pokemonNameLocale,
  }), [masteryRepetitions, flags.pretendAllMastered, retentionTarget, pokemonNameLocale]);

  const snapshotInput = useMemo(() => {
    if (cards === null || masteryRepetitions === null) return null;
    return {
      cards,
      settings: snapshotSettings,
      limits: sessionLimits,
      today: todayString(new Date()),
      options: snapshotOptions,
    };
  }, [cards, masteryRepetitions, snapshotSettings, sessionLimits, snapshotOptions]);

  useProvideDashboardSnapshotInput(snapshotInput);

  // Read the memoised snapshot from context — computed once per unique input set (#1139).
  const snapshot: DashboardSnapshot | null = useDashboardSnapshot();

  const reviewCharts =
    cards !== null && snapshot !== null
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
            gradeDistribution: computeGradeDistribution(gradeLog),
            gradeTrend: computeGradeTrend(gradeLog, today, 12),
            activityHistory: computeActivityHistory(gradeLog, today, 365),
            // Pass the full card array so computeMasteryOverTime can apply
            // species-level (both-legs) mastery counting (#1448).
            masteryOverTime: computeMasteryOverTime(
              cards,
              today,
              masteryRepetitions ?? undefined,
              flags.pretendAllMastered,
              pokemonNameLocale,
            ),
          };
        })()
      : null;

  return (
    <div className="flex flex-1 flex-col items-center bg-background px-4 py-10 sm:py-14">
      <div className="w-full max-w-3xl lg:max-w-6xl">
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">
          {t("title")}
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

        {snapshot === null ? (
          <LoadingSkeleton ariaLabel={t("loadingAriaLabel")} />
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
                  <span id="accuracy-section-heading">{t("accuracyHeading")}</span>
                </SectionHeading>
                <GradeBreakdownBar
                  again={gradeTotals[1]}
                  hard={gradeTotals[2]}
                  good={gradeTotals[4]}
                  easy={gradeTotals[5]}
                  label={t("allTimeGradeBreakdown")}
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
                      buckets={snapshot.difficulty!.buckets}
                      mean={snapshot.difficulty!.mean}
                    />
                  </>
                )}
              </section>

              {/* Activity section */}
              <section aria-labelledby="activity-section-heading" className="flex flex-col gap-6">
                <SectionHeading>
                  <span id="activity-section-heading">{t("activityHeading")}</span>
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
                      totalCards={snapshot.mastery!.totalCards}
                      dateFormat={userDateFormat}
                      forceAllMastered={flags.pretendAllMastered}
                    />
                  </>
                )}
              </section>

            </div>

            {/* Progress section — per-game mastery breakdown, full width on all breakpoints */}
            {perGame.length > 0 && (
              <section aria-labelledby="progress-section-heading" className="flex flex-col gap-6">
                <SectionHeading>
                  <span id="progress-section-heading">{t("progressHeading")}</span>
                </SectionHeading>
                <GameBreakdown perGame={perGame} />
              </section>
            )}

            {/* Scheduling section — full width on all breakpoints */}
            <section aria-labelledby="scheduling-section-heading" className="flex flex-col gap-6">
              <SectionHeading>
                <span id="scheduling-section-heading">{t("schedulingHeading")}</span>
              </SectionHeading>
              <OnboardingHint id="statsHintDismissed" title={t("masteryMeaning.title")}>
                <p>
                  {t.rich("masteryMeaning.body", { reps: masteryRepetitions ?? 3, em: (chunks) => <em>{chunks}</em> })}
                </p>
              </OnboardingHint>
              {snapshot.firstMasteryDays !== null && masteryRepetitions !== null && (
                <FirstMasteryHint
                  days={snapshot.firstMasteryDays}
                  masteryReps={masteryRepetitions}
                  masteryDays={MASTERY_INTERVAL_DAYS}
                />
              )}
              {snapshot.projection !== null && (
                <CompletionProjection
                  projection={snapshot.projection}
                  fmt={userDateFormat}
                  tz={userTimezone}
                />
              )}
              <DueForecast forecast={snapshot.dueForecast ?? []} fmt={userDateFormat} tz={userTimezone} />
              <StreakProtectionCard
                dateFormat={userDateFormat}
                timezone={userTimezone}
              />
              <StrugglingCards struggling={snapshot.struggling ?? []} />
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
