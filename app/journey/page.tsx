"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useCountUp } from "@/lib/stats/useCountUp";
import { buildSession, hydrateSession, todayString } from "@/lib/review/session";
import { loadSession } from "@/lib/review/persistence";
import { SEED_POKEMON, SEED_EVOLUTION_CARDS } from "@/lib/pokemon/seed";
import { computeStats } from "@/lib/stats/derive";
import type { StatsResult } from "@/lib/stats/derive";
import { loadSettings } from "@/lib/settings/persistence";
import { BADGE_CATALOG, type BadgeDefinition } from "@/lib/badges/catalog";
import { checkBadges } from "@/lib/badges/check";
import { masteredSpeciesIds } from "@/lib/badges/derive";
import { computeStreak, loadStreakData } from "@/lib/streak";
import { loadGradeLog } from "@/lib/gradelog/persistence";
import { TrainerCard } from "@/components/stats/TrainerCard";
import { BadgeGallery } from "@/components/badges/BadgeGallery";
import { TypeBreakdown } from "@/components/stats/TypeBreakdown";
import { RecordsCard } from "@/components/stats/RecordsCard";
import { computeRecords, type Records } from "@/lib/stats/records";
import { useAuth } from "@/lib/auth/AuthContext";
import { useSessionStorageKey } from "@/lib/review/useSessionStorageKey";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { pullSession, applyCloudAuthoritative } from "@/lib/sync/cloud";
import { seedOptsFromSettings } from "@/lib/review/seedOpts";
import Link from "next/link";

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

function LoadingSkeleton() {
  return (
    <div
      className="flex flex-col gap-8"
      aria-busy="true"
      aria-label="Loading journey"
    >
      <SkeletonBlock className="h-20 w-full" />
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
  const animated = useCountUp(value);
  return (
    <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
      <p
        className={`text-2xl font-bold tabular-nums ${accent ?? "text-foreground"}`}
        aria-label={`${value.toLocaleString("en-GB")} ${label}`}
      >
        {animated.toLocaleString("en-GB")}
      </p>
      <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
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

function MasteryRings({ stats, nameCardsEnabled }: { stats: StatsResult; nameCardsEnabled: boolean }) {
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
      label: "Locked",
      count: lockedAnimated,
      rawCount: locked,
      pct: lockedPct,
      colour: "#a1a1aa",
      dotClass: "bg-zinc-400",
    },
    {
      key: "learning",
      label: "Learning",
      count: learningAnimated,
      rawCount: learning,
      pct: learningPct,
      colour: "#fbbf24",
      dotClass: "bg-amber-400",
    },
    {
      key: "mastered",
      label: "Mastered",
      count: masteredAnimated,
      rawCount: mastered,
      pct: masteredPct,
      colour: "#10b981",
      dotClass: "bg-emerald-500",
    },
  ] as const;

  return (
    <section aria-labelledby="mastery-heading">
      <h2
        id="mastery-heading"
        className="mb-4 text-lg font-semibold text-foreground"
      >
        Mastery distribution
        {!nameCardsEnabled && (
          <span className="ml-2 text-sm font-normal text-zinc-400 dark:text-zinc-500">
            (disabled)
          </span>
        )}
      </h2>

      <div
        className="grid grid-cols-3 gap-3"
        role="img"
        aria-label={`Mastery distribution: ${mastered} mastered, ${learning} learning, ${locked} locked`}
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
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {label}
                </span>
              </div>
              <p className="text-xl font-bold tabular-nums text-foreground">
                {count.toLocaleString("en-GB")}
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

function IntroducedRing({ stats }: { stats: StatsResult }) {
  const { introduced, totalCards } = stats;
  const introPct = pct(introduced, totalCards);
  const introducedAnimated = useCountUp(introduced);

  return (
    <section aria-labelledby="introduced-heading">
      <h2
        id="introduced-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        Introduced
      </h2>
      <div className="flex items-center gap-5 rounded-xl border border-zinc-200 bg-background p-4 dark:border-zinc-800">
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
            <span>{introducedAnimated.toLocaleString("en-GB")}</span>
            <span className="text-base font-normal text-zinc-400 dark:text-zinc-500">
              {" / "}{totalCards.toLocaleString("en-GB")}
            </span>
          </p>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            species seen at least once
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// GenerationBreakdown
// ---------------------------------------------------------------------------

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
        <div className="grid grid-cols-[1fr_auto] items-center border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          <span>Generation</span>
          <span className="text-right">Mastered / Total</span>
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
                  aria-label={`View ${gen.name} in Pokédex`}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:hover:bg-zinc-900 dark:focus:bg-zinc-900"
                >
                  <span className="text-foreground">{gen.name}</span>
                  <span className="flex items-center justify-end gap-3">
                    <span
                      className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
                      aria-hidden="true"
                    >
                      <span
                        className="block h-full bg-emerald-500"
                        style={{ width: `${masteredPct}%` }}
                      />
                    </span>
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
  const { user, supabase } = useAuth();
  const { flags, anyFlagOn } = useSuperuser();
  const storageVersion = useSessionStorageKey();
  const [cards, setCards] = useState<Awaited<ReturnType<typeof buildSession>> | null>(null);
  const [masteryRepetitions, setMasteryRepetitions] = useState<number | null>(null);
  const [nameCardsEnabled, setNameCardsEnabled] = useState(true);
  const [currentStreak, setCurrentStreak] = useState<number | null>(null);
  const [streakDates, setStreakDates] = useState<string[]>([]);
  const [gradeLog, setGradeLog] = useState<Awaited<ReturnType<typeof loadGradeLog>>>([]);
  const [earnedBadgeIds, setEarnedBadgeIds] = useState<readonly string[]>([]);

  useEffect(() => {
    async function load() {
      const settings = loadSettings();
      const saved = await loadSession();
      const sessionCards = saved !== null
        ? hydrateSession(saved.cards, SEED_POKEMON, SEED_EVOLUTION_CARDS, undefined, { reverseEnabled: settings.reverseCardsEnabled, nameEnabled: settings.nameCardsEnabled, evolutionEnabled: settings.evolutionCardsEnabled })
        : buildSession(SEED_POKEMON, SEED_EVOLUTION_CARDS, undefined, { reverseEnabled: settings.reverseCardsEnabled, nameEnabled: settings.nameCardsEnabled, evolutionEnabled: settings.evolutionCardsEnabled });
      setCards(sessionCards);
      setMasteryRepetitions(settings.masteryRepetitions);
      setNameCardsEnabled(settings.nameCardsEnabled);
      const dates = loadStreakData();
      setStreakDates(dates);
      const tz = settings.timezone ?? "UTC";
      const today = todayString(new Date(), tz);
      setCurrentStreak(computeStreak(dates, today));
      const log = await loadGradeLog();
      setGradeLog(log);

      // Retroactive badge award — mirrors the same logic in stats/page.tsx.
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
          console.warn("[journey] cloud hydration failed, falling back to local", err);
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

  const records: Records | null =
    nameCards !== null && masteryRepetitions !== null
      ? computeRecords(
          nameCards,
          gradeLog,
          streakDates,
          masteryRepetitions,
          flags.pretendAllMastered,
        )
      : null;

  return (
    <div className="flex flex-1 flex-col items-center bg-background px-4 py-10 sm:py-14">
      <div className="w-full max-w-3xl">
        <h1 className="mb-8 text-2xl font-bold tracking-tight text-foreground">
          Journey
        </h1>

        {stats === null || currentStreak === null ? (
          <LoadingSkeleton />
        ) : (
          <div className="flex flex-col gap-10">
            {/* Trainer card */}
            <TrainerCard
              handle={
                ((user?.user_metadata?.user_name as string | undefined) ??
                  (user?.user_metadata?.preferred_username as string | undefined) ??
                  null)
              }
              totalMastered={stats.mastered}
              perGeneration={stats.perGeneration}
              earnedBadges={badgesToShow}
            />

            {/* Badges */}
            <BadgeGallery
              earnedBadges={badgesToShow}
              forceAllMastered={flags.pretendAllMastered}
            />

            {/* Streak */}
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
                  No active streak. Review some cards to start one!
                </p>
              )}
            </section>

            {/* Records */}
            {records !== null ? <RecordsCard records={records} /> : null}

            {/* Mastery rings */}
            <MasteryRings stats={stats} nameCardsEnabled={nameCardsEnabled} />

            {/* Introduced ring */}
            <IntroducedRing stats={stats} />

            {/* Generation breakdown */}
            <GenerationBreakdown stats={stats} />

            {/* Type breakdown */}
            <TypeBreakdown perType={stats.perType} />
          </div>
        )}
      </div>
    </div>
  );
}
