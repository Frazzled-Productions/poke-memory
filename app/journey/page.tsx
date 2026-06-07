"use client";

import { useEffect, useState, useSyncExternalStore, useMemo } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { useCountUp } from "@/lib/stats/useCountUp";
import { buildSession, hydrateSession, todayString, DEFAULT_LIMITS } from "@/lib/review/session";
import { loadSession, saveSession, STORAGE_KEY as SESSION_STORAGE_KEY } from "@/lib/review/persistence";
import { useSeed } from "@/lib/pokemon/SeedContext";
import type { MasterySnapshot } from "@/lib/stats/dashboard-snapshot";
import { useDashboardSnapshot, useProvideDashboardSnapshotInput } from "@/components/stats/DashboardSnapshotContext";
import { EMPTY_SCOPE, type EligibilitySettings } from "@/lib/review/scope";
import { loadSettings } from "@/lib/settings/persistence";
import { BADGE_CATALOG, type BadgeDefinition } from "@/lib/badges/catalog";
import { checkBadges } from "@/lib/badges/check";
import { masteredSpeciesIds } from "@/lib/badges/derive";
import { computeStreak, effectiveStreakDates, loadStreakData } from "@/lib/streak";
import { loadGradeLog } from "@/lib/gradelog/persistence";
import { buildCollectionTimeline, type CollectionTimeline } from "@/lib/timeline/reconstruct";
import { CollectionTimeline as CollectionTimelineWidget } from "@/components/journey/CollectionTimeline";
import { EvolutionWall } from "@/components/journey/EvolutionWall";
import { MilestoneShareButton } from "@/components/journey/MilestoneShareButton";
import { deriveEvolutionFamilies, type EvolutionFamily } from "@/lib/evolution/chains";
import type { ReviewableCard } from "@/lib/review/session";
import { TrainerCard } from "@/components/stats/TrainerCard";
import { BadgeGallery } from "@/components/badges/BadgeGallery";
import { TypeBreakdown } from "@/components/stats/TypeBreakdown";
import { RecordsCard } from "@/components/stats/RecordsCard";
import { computeRecords, type Records } from "@/lib/stats/records";
import { useAuth } from "@/lib/auth/AuthContext";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { pullSession, applyCloudAuthoritative } from "@/lib/sync/cloud";
import { seedOptsFromSettings } from "@/lib/review/seedOpts";
import { detectTopMilestone } from "@/lib/journey/milestones";
import { deriveCloseToMastery, type CloseToMasteryEntry } from "@/lib/journey/closeToMastery";
import { CloseToMastery } from "@/components/journey/CloseToMastery";
import { LanguageBreakdown } from "@/components/journey/LanguageBreakdown";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";
import { GuestSignUpNudge } from "@/components/onboarding/GuestSignUpNudge";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { cardPanel, cardPanelPadded, mutedText, pageTitle, sectionHeading, sectionHeadingLg, sectionLabel } from "@/lib/utils/class-names";
import { PageShell } from "@/components/ui/PageShell";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { MeterBar } from "@/components/ui/MeterBar";
import type { AppLocale } from "@/i18n/locales";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

// ---------------------------------------------------------------------------
// useReducedMotion
// ---------------------------------------------------------------------------

function canMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function subscribeToMotionQuery(cb: () => void): () => void {
  if (!canMatchMedia()) return () => undefined;
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToMotionQuery,
    () => (canMatchMedia() ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false),
    () => false,
  );
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

function LoadingSkeleton({ ariaLabel }: { ariaLabel: string }) {
  return (
    <div
      className="flex flex-col gap-8"
      aria-busy="true"
      aria-label={ariaLabel}
    >
      <SkeletonBlock className="h-20 w-full" />
      {/* Timeline skeleton */}
      <SkeletonBlock className="h-40 w-full" />
      {/* Evolution wall skeleton */}
      <SkeletonBlock className="h-28 w-full" />
      <SkeletonBlock className="h-12 w-full" />
      <div className="grid grid-cols-2 gap-4">
        <SkeletonBlock className="h-20" />
        <SkeletonBlock className="h-20" />
      </div>
      <SkeletonBlock className="h-32 w-full" />
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
  const format = useFormatter();
  const animated = useCountUp(value);
  return (
    <div className={cardPanelPadded}>
      <p
        className={`text-2xl font-bold tabular-nums ${accent ?? "text-foreground"}`}
        aria-label={`${format.number(value)} ${label}`}
      >
        {format.number(animated)}
      </p>
      <p className={cn("mt-0.5", mutedText)}>{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RadialRing
// ---------------------------------------------------------------------------

const RING_R = 28;
const RING_STROKE = 7;

function RadialRing({
  pct: fillPct,
  colour,
  label,
  size = 72,
}: {
  pct: number;
  colour: string;
  label: string;
  size?: number;
}) {
  const reducedMotion = useReducedMotion();
  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 72) * RING_R;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, fillPct));
  const dash = (clamped / 100) * circumference;
  const gap = circumference - dash;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      aria-label={label}
      role="img"
    >
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        strokeWidth={RING_STROKE}
        className="stroke-zinc-200 dark:stroke-zinc-700"
      />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={colour}
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={`${dash.toFixed(2)} ${gap.toFixed(2)}`}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={
          reducedMotion
            ? undefined
            : { transition: "stroke-dasharray 0.6s cubic-bezier(0.22, 1, 0.36, 1)" }
        }
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// MasteryRings
// ---------------------------------------------------------------------------

function MasteryRings({ stats }: { stats: MasterySnapshot }) {
  const t = useTranslations("journey");
  const format = useFormatter();
  const { totalCards, locked, learning, mastered } = stats;
  const masteredPct = pct(mastered, totalCards);
  const learningPct = pct(learning, totalCards);
  const lockedPct = Math.max(0, 100 - masteredPct - learningPct);

  const masteredAnimated = useCountUp(mastered);
  const learningAnimated = useCountUp(learning);
  const lockedAnimated = useCountUp(locked);

  const rings = [
    {
      key: "locked",
      label: t("masteryLocked"),
      count: lockedAnimated,
      rawCount: locked,
      pct: lockedPct,
      colour: "#a1a1aa",
      dotClass: "bg-zinc-400",
    },
    {
      key: "learning",
      label: t("masteryLearning"),
      count: learningAnimated,
      rawCount: learning,
      pct: learningPct,
      colour: "#fbbf24",
      dotClass: "bg-amber-400",
    },
    {
      key: "mastered",
      label: t("masteryMastered"),
      count: masteredAnimated,
      rawCount: mastered,
      pct: masteredPct,
      colour: "#10b981",
      dotClass: "bg-emerald-500",
    },
  ] as const;

  return (
    <section aria-labelledby="mastery-heading">
      <SectionHeading level={3} id="mastery-heading" className="mb-4">
        {t("masteryDistribution")}
      </SectionHeading>

      <div
        className="grid grid-cols-3 gap-3"
        role="img"
        aria-label={`${t("masteryDistribution")}: ${mastered} ${t("masteryMastered")}, ${learning} ${t("masteryLearning")}, ${locked} ${t("masteryLocked")}`}
      >
        {rings.map(({ key, label, count, rawCount, pct: ringPct, colour, dotClass }) => (
          <div
            key={key}
            className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-background px-3 py-4 dark:border-zinc-800"
            aria-hidden="true"
          >
            <RadialRing
              pct={ringPct}
              colour={colour}
              label={`${label}: ${rawCount} (${ringPct}%)`}
              size={72}
            />
            <div className="text-center">
              <div className="mb-0.5 flex items-center justify-center gap-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
                <span className={sectionLabel}>
                  {label}
                </span>
              </div>
              <p className="text-xl font-bold tabular-nums text-foreground">
                {format.number(count)}
              </p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">{ringPct}%</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// IntroducedRing
// ---------------------------------------------------------------------------

function IntroducedRing({ stats }: { stats: MasterySnapshot }) {
  const t = useTranslations("journey");
  const format = useFormatter();
  const { introduced, totalCards } = stats;
  const introPct = pct(introduced, totalCards);
  const introducedAnimated = useCountUp(introduced);

  return (
    <section aria-labelledby="introduced-heading">
      <SectionHeading level={3} id="introduced-heading" className="mb-3">
        {t("introduced")}
      </SectionHeading>
      <div className={cn("flex items-center gap-5", cardPanel)}>
        <div className="shrink-0" aria-hidden="true">
          <RadialRing
            pct={introPct}
            colour="#3b82f6"
            label={`${introduced} of ${totalCards} Pokémon introduced (${introPct}%)`}
            size={72}
          />
        </div>
        <div>
          <p
            className="text-2xl font-bold tabular-nums text-blue-600 dark:text-blue-400"
            aria-label={`${introduced} of ${totalCards} introduced`}
          >
            <span>{format.number(introducedAnimated)}</span>
            <span className="text-base font-normal text-zinc-400 dark:text-zinc-500">
              {" / "}{format.number(totalCards)}
            </span>
          </p>
          <p className={cn("mt-0.5", mutedText)}>
            {t("speciesSeenAtLeastOnce")}
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// GenerationBreakdown
// ---------------------------------------------------------------------------

function GenerationBreakdown({ stats }: { stats: MasterySnapshot }) {
  const t = useTranslations("journey");
  const tCommon = useTranslations("common");
  return (
    <section aria-labelledby="gen-heading">
      <SectionHeading level={3} id="gen-heading" className="mb-3">
        {t("byGeneration")}
      </SectionHeading>
      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="grid grid-cols-[1fr_auto] items-center border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          <span>{t("byGenerationColumn")}</span>
          <span className="text-right">{t("byGenerationMasteredTotal")}</span>
        </div>
        <ul role="list" className="text-sm">
          {stats.perGeneration.map((gen, idx) => {
            const masteredPct = pct(gen.mastered, gen.total);
            const isLast = idx === stats.perGeneration.length - 1;
            return (
              <li
                key={gen.gen}
                className={
                  isLast
                    ? ""
                    : "border-b border-zinc-100 dark:border-zinc-800/60"
                }
              >
                <Link
                  href={`/pokedex?gen=${gen.gen}`}
                  aria-label={tCommon("viewInPokedex", { name: gen.name })}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:hover:bg-zinc-900 dark:focus:bg-zinc-900"
                >
                  <span className="text-foreground">{gen.name}</span>
                  <span className="flex items-center justify-end gap-3">
                    <MeterBar
                      value={gen.mastered}
                      max={gen.total}
                      fillClass="bg-emerald-500"
                      label={`${gen.name}: ${gen.mastered} of ${gen.total} mastered (${masteredPct}%)`}
                      trackClass="dark:bg-zinc-800"
                      transitionClass=""
                      className="w-20"
                    />
                    <span className="min-w-[64px] text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                      {gen.mastered} / {gen.total}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function JourneyPage() {
  const t = useTranslations("journey");
  const { user, supabase } = useAuth();
  const { flags, anyFlagOn } = useSuperuser();
  const { seed } = useSeed();
  const storageVersion = useLocalStorageKey(SESSION_STORAGE_KEY);
  const [cards, setCards] = useState<Awaited<ReturnType<typeof buildSession>> | null>(null);
  const [masteryRepetitions, setMasteryRepetitions] = useState<number | null>(null);
  const [pokemonNameLocale, setPokemonNameLocale] = useState<AppLocale>("en");
  const [eligibilitySettings, setEligibilitySettings] = useState<EligibilitySettings>({
    evolutionCardsEnabled: true,
    reverseEvolutionCardsEnabled: false,
    cryCardsEnabled: false,
    alternateFormsEnabled: false,
    practiceScope: EMPTY_SCOPE,
  });
  const [currentStreak, setCurrentStreak] = useState<number | null>(null);
  const [streakDates, setStreakDates] = useState<string[]>([]);
  const [gradeLog, setGradeLog] = useState<Awaited<ReturnType<typeof loadGradeLog>>>([]);
  const [earnedBadgeIds, setEarnedBadgeIds] = useState<readonly string[]>([]);
  const [timeline, setTimeline] = useState<CollectionTimeline | null>(null);
  const [evolutionFamilies, setEvolutionFamilies] = useState<EvolutionFamily[] | null>(null);
  const [closeToMasteryEntries, setCloseToMasteryEntries] = useState<readonly CloseToMasteryEntry[] | null>(null);
  const [practiceSessionsCount, setPracticeSessionsCount] = useState<number | null>(null);

  useEffect(() => {
    if (seed === null) return; // wait for seed to load
    const currentSeed = seed; // capture non-null reference for async closure
    async function load() {
      const settings = loadSettings();
      const saved = await loadSession();
      const localOpts = seedOptsFromSettings(settings);
      let sessionCards: ReviewableCard[];
      if (saved !== null) {
        const { cards: hydrated, anyHealed } = hydrateSession(saved.cards, currentSeed.seedPokemon, currentSeed.seedEvolutionCards, undefined, localOpts);
        // Persist healed cards so the fixed point is durable across all entry
        // points, not only Practice (#1506).
        if (anyHealed) {
          await saveSession({ cards: hydrated, limits: saved.limits });
        }
        sessionCards = hydrated;
      } else {
        sessionCards = buildSession(currentSeed.seedPokemon, currentSeed.seedEvolutionCards, undefined, localOpts);
      }
      setCards(sessionCards);
      setMasteryRepetitions(settings.masteryRepetitions);
      setPokemonNameLocale(settings.pokemonNameLocale);
      // Defensive: older mocks and pre-#1668 settings blobs may omit `onboarding`.
      setPracticeSessionsCount(settings.onboarding?.practiceSessionsCount ?? 0);
      setEligibilitySettings({
        evolutionCardsEnabled: settings.evolutionCardsEnabled,
        reverseEvolutionCardsEnabled: settings.reverseEvolutionCardsEnabled,
        cryCardsEnabled: settings.cryCardsEnabled,
        alternateFormsEnabled: settings.alternateFormsEnabled,
        practiceScope: settings.practiceScope,
      });
      const dates = loadStreakData();
      // Compose review dates with any token-spend bridges so both the
      // current-streak counter and the longest-streak record reflect
      // preserved days (#1227). Defensive ?? covers test mocks that omit
      // the field.
      const effectiveDates = effectiveStreakDates(
        dates,
        settings.streakProtection?.spendDates ?? [],
      );
      setStreakDates(effectiveDates);
      const tz = settings.timezone ?? "UTC";
      const today = todayString(new Date(), tz);
      setCurrentStreak(computeStreak(effectiveDates, today));
      const log = await loadGradeLog();
      setGradeLog(log);

      // Retroactive badge award - mirrors the same logic in stats/page.tsx.
      // Never award retroactively while a superuser flag is on.
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
          const { saveSettings } = await import("@/lib/settings/persistence");
          saveSettings({ ...settings, earnedBadges: nextEntries });
          setEarnedBadgeIds(nextEntries.map((e) => e.id));
        } else {
          setEarnedBadgeIds(settings.earnedBadges.map((e) => e.id));
        }
      } else {
        setEarnedBadgeIds(settings.earnedBadges.map((e) => e.id));
      }

      // Use local cards by default; may be replaced by cloud cards below.
      let finalCards = sessionCards;

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
            finalCards = cloudCards;
          }
        } catch (err) {
          console.warn("[journey] cloud hydration failed, falling back to local", err);
        }
      }

      // Build the collection timeline with the final card set (local or cloud).
      const nameCardMap = new Map(
        finalCards
          .filter((c) => c.cardType === "name")
          .map((c) => [c.subjectKey, c.state]),
      );
      const tl = buildCollectionTimeline({
        log,
        currentNameCards: nameCardMap,
        totalSpecies: currentSeed.seedPokemon.filter((p) => p.isDefaultForm).length,
        masteryRepetitions: settings.masteryRepetitions,
        retentionTarget: settings.retentionTarget,
        forceAllMastered: flags.pretendAllMastered,
      });
      setTimeline(tl);

      // Derive evolution families from the final card set.
      const evoFamilies = deriveEvolutionFamilies(
        finalCards as readonly ReviewableCard[],
        settings.masteryRepetitions,
        flags.pretendAllMastered,
      );
      setEvolutionFamilies(evoFamilies);

      // Derive close-to-mastery entries from the final card set.
      const ctm = deriveCloseToMastery(
        finalCards as readonly ReviewableCard[],
        settings.masteryRepetitions,
        flags.pretendAllMastered,
      );
      setCloseToMasteryEntries(ctm);
    }
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageVersion, anyFlagOn, supabase, user, seed]);

  // Provide the full snapshot input to the shared DashboardSnapshotContext.
  // Journey reads only the mastery axis from the returned snapshot (#1139,
  // simplified in #1151 - the include-filter abstraction was dropped).
  const snapshotOptions = useMemo(() => ({
    masteryRepetitions: masteryRepetitions ?? undefined,
    forceAllMastered: flags.pretendAllMastered,
    locale: pokemonNameLocale,
  }), [masteryRepetitions, flags.pretendAllMastered, pokemonNameLocale]);

  const snapshotInput = useMemo(() => {
    if (cards === null || masteryRepetitions === null) return null;
    return {
      cards,
      settings: eligibilitySettings,
      limits: DEFAULT_LIMITS,
      today: todayString(new Date()),
      options: snapshotOptions,
    };
  }, [cards, masteryRepetitions, eligibilitySettings, snapshotOptions]);

  useProvideDashboardSnapshotInput(snapshotInput);

  // Read the shared snapshot from context and extract the mastery axis.
  const dashboardSnapshot = useDashboardSnapshot();
  const masterySnapshot: MasterySnapshot | null = dashboardSnapshot?.mastery ?? null;

  const badgesToShow: readonly BadgeDefinition[] = flags.pretendAllMastered
    ? BADGE_CATALOG
    : (() => {
        const byId = new Map(BADGE_CATALOG.map((b) => [b.id, b]));
        const out: BadgeDefinition[] = [];
        for (const id of earnedBadgeIds) {
          const def = byId.get(id);
          if (def) out.push(def);
        }
        return out;
      })();

  // Mastered species IDs for the proximity hint in BadgeGallery.
  // When forceAllMastered is on, every badge is earned and no hint is needed
  // (BadgeGallery skips the hint when forceAllMastered is true).
  const masteredIds: ReadonlySet<number> | undefined =
    cards !== null && masteryRepetitions !== null
      ? masteredSpeciesIds(cards, masteryRepetitions, flags.pretendAllMastered)
      : undefined;

  // Pass the full card array so computeRecords can apply species-level
  // (both-legs) mastery counting (#1448).
  const records: Records | null =
    cards !== null && masteryRepetitions !== null
      ? computeRecords(
          cards,
          gradeLog,
          streakDates,
          masteryRepetitions,
          flags.pretendAllMastered,
          pokemonNameLocale,
        )
      : null;

  return (
    <PageShell width="reading">
      <h1 className={`mb-8 ${pageTitle}`}>
        {t("title")}
      </h1>

      {masterySnapshot === null || currentStreak === null ? (
        <LoadingSkeleton ariaLabel={t("loadingAriaLabel")} />
      ) : (
        <div className="flex flex-col gap-12">

          {/* ──────────────────────────────────────────────────────────────
              1. YOUR PROGRESS super-section
              TrainerCard, GuestSignUpNudge (guest-only, after TrainerCard and
              before MilestoneShareButton), MilestoneShareButton,
              CollectionTimeline, Streak, Records.
          ─────────────────────────────────────────────────────────────── */}
          <section aria-labelledby="journey-progress-heading">
            <SectionHeading
              level={2}
              id="journey-progress-heading"
              className="mb-6 border-b border-zinc-200 pb-2 dark:border-zinc-800"
            >
              {t("superSectionProgress")}
            </SectionHeading>

            <div className="flex flex-col gap-10">
              {/* Trainer card */}
              <TrainerCard
                handle={
                  ((user?.user_metadata?.user_name as string | undefined) ??
                    (user?.user_metadata?.preferred_username as string | undefined) ??
                    null)
                }
                totalMastered={masterySnapshot.mastered}
                perGeneration={masterySnapshot.perGeneration}
                earnedBadges={badgesToShow}
              />

              {/* Guest sign-up value-prop nudge - shown to guests with real progress,
                  immediately after TrainerCard and before MilestoneShareButton so it
                  catches the eye (#1731 / #1729). Gate: masteredSpecies >= 10 OR
                  sessions >= 3 (#1668). Hidden for signed-in users and superuser mode. */}
              {user === null && !flags.pretendAllMastered && (
                <GuestSignUpNudge
                  masteredSpecies={masterySnapshot.mastered}
                  practiceSessionsCount={practiceSessionsCount}
                />
              )}

              {/* Milestone share - hidden during superuser sessions so fake
                  mastery cannot produce a real share card (#917). */}
              <MilestoneShareButton
                milestone={
                  anyFlagOn
                    ? null
                    : detectTopMilestone(masterySnapshot.mastered, masterySnapshot.perGeneration)
                }
              />

              {/* Collection timeline - the hero scrubber.
                  CollectionTimelineWidget owns its own <section aria-labelledby>
                  so we do NOT re-wrap it here (avoids duplicate heading ids).
                  Show a placeholder while the cloud pull is in flight so the
                  section's layout slot is reserved and nothing shifts when the
                  data lands (fixes #961). */}
              {timeline !== null ? (
                <CollectionTimelineWidget timeline={timeline} />
              ) : (
                <section aria-labelledby="timeline-heading">
                  <SectionHeading level={3} id="timeline-heading" className="mb-4">
                    {t("collectionTimeline")}
                  </SectionHeading>
                  <SkeletonBlock className="h-[200px] w-full" />
                </section>
              )}

              {/* Streak */}
              <section aria-labelledby="streak-heading">
                <SectionHeading level={3} id="streak-heading" className="mb-3">
                  {t("currentStreak")}
                </SectionHeading>
                {currentStreak > 0 ? (
                  <StatCard
                    label={t("daysInARow", { count: currentStreak })}
                    value={currentStreak}
                    accent="text-amber-500 dark:text-amber-400"
                  />
                ) : (
                  <p className={mutedText}>
                    {t("noStreak")}
                  </p>
                )}
              </section>

              {/* Records - RecordsCard owns its own <section aria-labelledby>
                  so we do NOT re-wrap it here. */}
              {records !== null ? (
                <RecordsCard records={records} />
              ) : null}
            </div>
          </section>

          {/* ──────────────────────────────────────────────────────────────
              2. COLLECTION super-section
              EvolutionWall, CloseToMastery, BadgeGallery.
          ─────────────────────────────────────────────────────────────── */}
          <section aria-labelledby="journey-collection-heading">
            <SectionHeading
              level={2}
              id="journey-collection-heading"
              className="mb-6 border-b border-zinc-200 pb-2 dark:border-zinc-800"
            >
              {t("superSectionCollection")}
            </SectionHeading>

            <div className="flex flex-col gap-10">
              {/* Evolution wall.
                  EvolutionWall owns its own <section aria-labelledby> (using
                  useId() for the heading id) so we do NOT re-wrap it here.
                  Per-section skeleton approach to avoid layout shift
                  while evolutionFamilies is still null (fixes #961). */}
              {evolutionFamilies !== null ? (
                <EvolutionWall families={evolutionFamilies} />
              ) : (
                <section aria-labelledby="evo-wall-heading">
                  <SectionHeading level={3} id="evo-wall-heading" className="mb-3">
                    {t("evolutionWall")}
                  </SectionHeading>
                  <SkeletonBlock className="h-10 w-full" />
                </section>
              )}

              {/* Close to mastery.
                  CloseToMastery owns its own <section aria-labelledby> so we
                  do NOT re-wrap it here.
                  Shown whenever the entries are loaded (even if empty - the
                  empty state is informative). Same skeleton approach used for
                  other deferred sections to avoid layout shift. */}
              {closeToMasteryEntries !== null ? (
                <CloseToMastery entries={closeToMasteryEntries} />
              ) : (
                <section aria-labelledby="ctm-heading">
                  <SectionHeading level={3} id="ctm-heading" className="mb-3">
                    {t("closeToMastery")}
                  </SectionHeading>
                  <SkeletonBlock className="h-10 w-full" />
                </section>
              )}

              {/* Badges */}
              <BadgeGallery
                earnedBadges={badgesToShow}
                forceAllMastered={flags.pretendAllMastered}
                masteredSpeciesIds={masteredIds}
              />
            </div>
          </section>

          {/* ──────────────────────────────────────────────────────────────
              3. BREAKDOWN super-section
              MasteryRings + explainer hint (immediately after), IntroducedRing,
              GenerationBreakdown, TypeBreakdown, LanguageBreakdown.
          ─────────────────────────────────────────────────────────────── */}
          <section aria-labelledby="journey-breakdown-heading">
            <SectionHeading
              level={2}
              id="journey-breakdown-heading"
              className="mb-6 border-b border-zinc-200 pb-2 dark:border-zinc-800"
            >
              {t("superSectionBreakdown")}
            </SectionHeading>

            <div className="flex flex-col gap-10">
              {/* Mastery rings */}
              <MasteryRings stats={masterySnapshot} />

              {/* Mastery-explainer hint - immediately after MasteryRings (#1731).
                  Renders for all users (empty and populated) until explicitly dismissed.
                  Uses a dedicated flag so existing users who pre-date this feature see
                  it on their next Journey visit (#1441). */}
              <OnboardingHint
                id="journeyMasteryExplainerDismissed"
                title={t("masteryExplainer.title")}
              >
                <p>{t("masteryExplainer.lockedBody")}</p>
                <p className="mt-1">{t("masteryExplainer.learningBody")}</p>
                <p className="mt-1">
                  {t.rich("masteryExplainer.masteredBody", { reps: masteryRepetitions ?? 3, em: (chunks) => <em>{chunks}</em> })}
                </p>
                <p className="mt-1">{t("masteryExplainer.introducedNote")}</p>
              </OnboardingHint>

              {/* Introduced ring */}
              <IntroducedRing stats={masterySnapshot} />

              {/* Generation breakdown */}
              <GenerationBreakdown stats={masterySnapshot} />

              {/* Type breakdown */}
              <TypeBreakdown perType={masterySnapshot.perType} />

              {/* Language breakdown - only renders when >1 locale enrolled */}
              {cards !== null && masteryRepetitions !== null ? (
                <LanguageBreakdown
                  cards={cards}
                  gradeLog={gradeLog}
                  today={todayString(new Date())}
                  masteryRepetitions={masteryRepetitions}
                />
              ) : null}
            </div>
          </section>

        </div>
      )}
    </PageShell>
  );
}
