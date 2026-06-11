"use client";

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useEffect, useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { buildSession, hydrateSession, todayString, DEFAULT_LIMITS, type ReviewableCard, type DailyLimits } from "@/lib/review/session";
import { EMPTY_SCOPE, type PracticeScope } from "@/lib/review/scope";
import { type DateFormat } from "@/lib/utils/format-date";
import { colStack, mutedText, mutedTextXs, pageTitle } from "@/lib/utils/class-names";
import { PageShell } from "@/components/ui/PageShell";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { loadSession, saveSession, bumpSessionStorageKey, STORAGE_KEY as SESSION_STORAGE_KEY } from "@/lib/review/persistence";
import { useSeed } from "@/lib/pokemon/SeedContext";
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
import { GuestSignUpNudge } from "@/components/onboarding/GuestSignUpNudge";
import { SyncStatusLine } from "@/components/stats/SyncStatusLine";
import { useAuth } from "@/lib/auth/AuthContext";
import { useRetryPush } from "@/lib/sync/useRetryPush";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { pullSession, applyCloudAuthoritative, maxCloudUpdatedAt } from "@/lib/sync/cloud";
import { seedOptsFromSettings } from "@/lib/review/seedOpts";
import { computePerGameStats, type GameStats } from "@/lib/stats/per-game";
import { GameBreakdown } from "@/components/stats/GameBreakdown";
import { LanguageBreakdown } from "@/components/stats/LanguageBreakdown";
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
      {/* h3 because StrugglingCards is nested inside the Scheduling h2 section */}
      <SectionHeading level={3} id="struggling-heading" className="mb-3">
        {t("strugglingCards.heading")}
      </SectionHeading>

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
// Page
// ---------------------------------------------------------------------------

export default function StatsPage() {
  const t = useTranslations("stats");
  const tCommon = useTranslations("common");
  const { user, supabase } = useAuth();
  const { flags, anyFlagOn } = useSuperuser();
  const { seed } = useSeed();
  const client = anyFlagOn ? null : supabase;
  const userId = anyFlagOn ? null : (user?.id ?? null);
  const { retryState, retryNow } = useRetryPush(client, userId);
  const storageVersion = useLocalStorageKey(SESSION_STORAGE_KEY);
  const [cards, setCards] = useState<ReviewableCard[] | null>(null);
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
  const [practiceSessionsCount, setPracticeSessionsCount] = useState<number | null>(null);

  useEffect(() => {
    if (seed === null) return;
    const currentSeed = seed; // capture non-null reference for async closure
    async function load() {
      // Load settings first so the protection pass can evaluate `today` in
      // the user's timezone - the `streakDates` set is populated using the
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
      let sessionCards: ReviewableCard[];
      if (saved !== null) {
        const { cards: hydrated, anyHealed } = hydrateSession(saved.cards, currentSeed.seedPokemon, currentSeed.seedEvolutionCards, undefined, { reverseEnabled: true, nameEnabled: true, evolutionEnabled: settings.evolutionCardsEnabled });
        // Persist healed cards so the fixed point is durable across all entry
        // points, not only Practice (#1506).
        if (anyHealed) {
          await saveSession({ cards: hydrated, limits: saved.limits });
        }
        sessionCards = hydrated;
      } else {
        sessionCards = buildSession(currentSeed.seedPokemon, currentSeed.seedEvolutionCards, undefined, { reverseEnabled: true, nameEnabled: true, evolutionEnabled: settings.evolutionCardsEnabled });
      }
      setCards(sessionCards);
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
      // Defensive: older mocks and pre-#1668 settings blobs may omit `onboarding`.
      setPracticeSessionsCount(settings.onboarding?.practiceSessionsCount ?? 0);
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
      // silently - no toast. The reveal toast only fires on the grade event
      // that crosses the threshold (`ReviewSession.handleGrade`). We never
      // award retroactively while a superuser flag is on; the catalog-wide
      // overlay on Journey covers that QA case without touching persisted state.
      // This check is idempotent: `checkBadges` only returns badges not already
      // in `earnedIdSet`, so running it on both Stats and Journey is safe.
      if (!anyFlagOn) {
        // Scoped to the active pokemonNameLocale (#1851) so ja/zh learners'
        // mastery counts toward badges; previously the implicit "en" default
        // evaluated English-only mastery.
        const masteredIds = masteredSpeciesIds(
          sessionCards,
          false,
          settings.pokemonNameLocale,
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
              currentSeed.seedPokemon,
              currentSeed.seedEvolutionCards,
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
  }, [storageVersion, anyFlagOn, supabase, user, seed]);

  // Per-game mastery breakdown (#1313). Recomputed whenever cards change or
  // the superuser flag toggles. Locale-scoped (#1851) so the panel reflects
  // the active learning language like the rest of the page.
  const perGame = useMemo<GameStats[]>(() => {
    if (cards === null || seed === null) return [];
    return computePerGameStats(
      cards,
      seed.seedPokemon,
      flags.pretendAllMastered,
      pokemonNameLocale,
    );
  }, [cards, flags.pretendAllMastered, seed, pokemonNameLocale]);

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
    forceAllMastered: flags.pretendAllMastered,
    retentionTarget,
    locale: pokemonNameLocale,
  }), [flags.pretendAllMastered, retentionTarget, pokemonNameLocale]);

  const snapshotInput = useMemo(() => {
    if (cards === null) return null;
    return {
      cards,
      settings: snapshotSettings,
      limits: sessionLimits,
      today: todayString(new Date()),
      options: snapshotOptions,
    };
  }, [cards, snapshotSettings, sessionLimits, snapshotOptions]);

  useProvideDashboardSnapshotInput(snapshotInput);

  // Read the memoised snapshot from context - computed once per unique input set (#1139).
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
              flags.pretendAllMastered,
              pokemonNameLocale,
            ),
          };
        })()
      : null;

  return (
    <PageShell width="reading">
        <h1 className={`mb-2 ${pageTitle}`}>
          {t("title")}
        </h1>
        {user !== null && (
          <div className="mb-1">
            <SyncStatusLine
              retryState={retryState}
              retryNow={retryNow}
              superuserPaused={anyFlagOn}
              tz={userTimezone}
            />
          </div>
        )}
        {/*
          "Restore from cloud" link - visible only when signed in (#1732 / #1729).
          Telegraphs that recovery options are in Settings and links there directly.
          Does NOT duplicate the ForcePullSection action (which has moved to Settings).
          Gated on user !== null && supabase !== null && !anyFlagOn to match the
          former ForcePullSection gate.
        */}
        {user !== null && supabase !== null && !anyFlagOn && (
          <p className="mb-8 text-sm text-zinc-500 dark:text-zinc-400">
            {t("restoreFromCloudDescription")}{" "}
            <Link
              href="/settings"
              className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
            >
              {t("restoreFromCloud")}
            </Link>
          </p>
        )}

        {user === null && !flags.pretendAllMastered && (
          <div className="mb-8">
            <GuestSignUpNudge
              masteredSpecies={snapshot?.mastery?.mastered ?? null}
              practiceSessionsCount={practiceSessionsCount}
            />
          </div>
        )}

        {snapshot === null ? (
          <LoadingSkeleton ariaLabel={t("loadingAriaLabel")} />
        ) : (
          <div className="flex flex-col gap-10">

            {/* Accuracy section - single column (max-w-3xl reading width, #1732 / #1729) */}
            <section aria-labelledby="accuracy-section-heading" className="flex flex-col gap-6">
              <SectionHeading level={2} id="accuracy-section-heading">
                {t("accuracyHeading")}
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
              <SectionHeading level={2} id="activity-section-heading">
                {t("activityHeading")}
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

            {/* Progress section - per-game mastery breakdown */}
            {perGame.length > 0 && (
              <section aria-labelledby="progress-section-heading" className="flex flex-col gap-6">
                <SectionHeading level={2} id="progress-section-heading">
                  {t("progressHeading")}
                </SectionHeading>
                <GameBreakdown perGame={perGame} />
              </section>
            )}

            {/* Languages section - per-enrolled-locale mastery summary; hidden when single locale (#1619) */}
            {cards !== null && (
              <LanguageBreakdown
                cards={cards}
                today={todayString(new Date(), userTimezone)}
                dateFormat={userDateFormat}
                timezone={userTimezone}
              />
            )}

            {/* Scheduling section */}
            <section aria-labelledby="scheduling-section-heading" className="flex flex-col gap-6">
              <SectionHeading level={2} id="scheduling-section-heading">
                {t("schedulingHeading")}
              </SectionHeading>
              <OnboardingHint id="statsHintDismissed" title={t("masteryMeaning.title")}>
                <p>
                  {t.rich("masteryMeaning.body", { em: (chunks) => <em>{chunks}</em> })}
                </p>
              </OnboardingHint>
              {snapshot.firstMasteryDays !== null && (
                <FirstMasteryHint
                  days={snapshot.firstMasteryDays}
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

          </div>
        )}
    </PageShell>
  );
}
