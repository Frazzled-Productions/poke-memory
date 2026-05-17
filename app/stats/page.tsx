"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useCountUp } from "@/lib/stats/useCountUp";
import { buildSession, hydrateSession, todayString, DEFAULT_LIMITS, type ReviewableCard } from "@/lib/review/session";
import { formatDate, type DateFormat } from "@/lib/utils/format-date";
import { loadSession, saveSession, bumpSessionStorageKey } from "@/lib/review/persistence";
import { SEED_POKEMON, SEED_EVOLUTION_CARDS } from "@/lib/pokemon/seed";
import { computeStats } from "@/lib/stats/derive";
import type { StatsResult } from "@/lib/stats/derive";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { BADGE_CATALOG, type BadgeDefinition } from "@/lib/badges/catalog";
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
import { TypeBreakdown } from "@/components/stats/TypeBreakdown";
import { RecordsCard } from "@/components/stats/RecordsCard";
import { DirectionBadge } from "@/components/review/DirectionBadge";
import { computeRecords, type Records } from "@/lib/stats/records";
import { ReviewHeatmap } from "@/components/stats/ReviewHeatmap";
import { computeReviewHeatmap } from "@/lib/stats/heatmap";
import { ActivityHistoryChart } from "@/components/stats/ActivityHistoryChart";
import { computeActivityHistory } from "@/lib/stats/activity-history";
import { TrainerCard } from "@/components/stats/TrainerCard";
import { BadgeGallery } from "@/components/badges/BadgeGallery";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";
import { SyncStatusLine } from "@/components/stats/SyncStatusLine";
import { useAuth } from "@/lib/auth/AuthContext";
import { useRetryPush } from "@/lib/sync/useRetryPush";
import { useSessionStorageKey } from "@/lib/review/useSessionStorageKey";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { pullSession, applyCloudAuthoritative, maxCloudUpdatedAt } from "@/lib/sync/cloud";
import { seedOptsFromSettings } from "@/lib/review/seedOpts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

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
// useReducedMotion — reads prefers-reduced-motion via useSyncExternalStore so
// the value is always current without subscribing to a separate effect.
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
    // Server snapshot — false (no motion suppression) until client hydrates.
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
// RadialRing — single SVG progress ring used in MasteryRings and IntroducedRing
// ---------------------------------------------------------------------------

// RING_R is the radius at the default size (72). Geometry is scaled
// proportionally from this baseline inside RadialRing.
const RING_R = 28;
const RING_STROKE = 7;

function RadialRing({
  pct: fillPct,
  colour,
  label,
  size = 72,
}: {
  pct: number;    // 0..100
  colour: string; // CSS colour for the filled arc
  label: string;  // aria-label on the wrapping <svg>
  size?: number;  // viewBox / rendered size
}) {
  const reducedMotion = useReducedMotion();
  // Derive geometry proportionally from size so the ring is self-consistent
  // at any size (not just the default 72px).
  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 72) * RING_R;
  const circumference = 2 * Math.PI * r;
  // Clamp to [0, 100] to guard against rounding artefacts.
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
      {/* Track */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        strokeWidth={RING_STROKE}
        className="stroke-zinc-200 dark:stroke-zinc-700"
      />
      {/* Filled arc — rotated so 0% starts at the top */}
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
// MasteryRings — replaces the flat MasteryBar with three radial gauges
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
      colour: "#a1a1aa", // zinc-400
      dotClass: "bg-zinc-400",
    },
    {
      key: "learning",
      label: "Learning",
      count: learningAnimated,
      rawCount: learning,
      pct: learningPct,
      colour: "#fbbf24", // amber-400
      dotClass: "bg-amber-400",
    },
    {
      key: "mastered",
      label: "Mastered",
      count: masteredAnimated,
      rawCount: mastered,
      pct: masteredPct,
      colour: "#10b981", // emerald-500
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
            colour="#3b82f6" /* blue-500 */
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
      <div className="rounded-xl border border-zinc-200 bg-background p-4 dark:border-zinc-800">
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
          No struggling cards yet. Keep it up!
        </p>
      ) : (
        <ul className="flex flex-col gap-2" role="list">
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
      // Pull every user-visible cloud-backed table in parallel. Only cards are
      // "required" — if the card pull fails the recovery is meaningless. The
      // other four are best-effort: a null result leaves that table's local
      // value untouched. This matches the per-table policy in pullAndMerge.
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

      // Apply settings first so the seed opts below pick up the cloud-side
      // reverse/cry/etc. flags, otherwise applyCloudAuthoritative would drop
      // cloud rows for disabled card types (#391 lesson applied to recovery).
      //
      // Known small cost: `saveSettings` dispatches SETTINGS_SAVED_EVENT,
      // which AutoSyncOnChange responds to by pushing the (cloud-origin)
      // settings right back via merge_user_settings. The RPC is idempotent at
      // the JSONB-content level, so the round-trip is just one wasted write
      // per force-pull. Not worth a fromCloud flag for now.
      if (pulledSettings !== null) {
        saveSettings(pulledSettings.settings);
      }

      // Overlay regional prefs onto whatever settings are now in local. Cloud
      // null values leave the local field untouched (regional-prefs convention).
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

      // The recovery contract is "cloud truth replaces local" — streak and
      // grade_log get the cloud copy verbatim, not a union. The button's
      // confirm dialog already warns the user that local progress is replaced.
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

      // Advance the sync cursors. Without `lastPullAt` and `lastSettingsPullAt`
      // being stamped, the next background `pullAndMerge` runs with a null
      // anchor → `mergeCloudIntoLocalSilent` treats every local-with-progress
      // card as authoritative, silently dropping any cloud change that arrives
      // between now and the next user interaction. This is the #293 lesson
      // applied to the recovery path: mirror what `pullAndMerge` does at the
      // end of its own cycle.
      const status = loadSyncStatus();
      saveSyncStatus({
        ...status,
        lastPullAt: maxCloudUpdatedAt(cloudRows),
        ...(pulledSettings?.updatedAt !== undefined &&
        pulledSettings.updatedAt !== null
          ? { lastSettingsPullAt: pulledSettings.updatedAt }
          : {}),
      });

      // saveSession dispatches a synthetic StorageEvent so same-tab
      // subscribers (useSessionStorageKey) re-read automatically. Stats
      // re-reads streakDates and gradeLog inside that same effect, so the
      // cloud-applied values for those auxiliary tables surface in the same
      // tick. bumpSessionStorageKey is redundant here but cheap insurance if
      // saveSession is ever refactored to skip its dispatch.
      bumpSessionStorageKey();

      onSuccess(cards);
      setStatus("success");
      // Reset to idle after a short display window.
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
      <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
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
// Page
// ---------------------------------------------------------------------------

export default function StatsPage() {
  const { user, supabase } = useAuth();
  const { flags, anyFlagOn } = useSuperuser();
  const client = anyFlagOn ? null : supabase;
  const userId = anyFlagOn ? null : (user?.id ?? null);
  const { retryState, retryNow } = useRetryPush(client, userId);
  const storageVersion = useSessionStorageKey();
  const [cards, setCards] = useState<ReviewableCard[] | null>(null);
  const [masteryRepetitions, setMasteryRepetitions] = useState<number | null>(null);
  const [nameCardsEnabled, setNameCardsEnabled] = useState(true);
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
  const [currentStreak, setCurrentStreak] = useState<number | null>(null);
  const [userTimezone, setUserTimezone] = useState("UTC");
  const [userDateFormat, setUserDateFormat] = useState<DateFormat>("dmy");
  const [gradeTotals, setGradeTotals] = useState<GradeTotals>(() => computeGradeTotals([]));
  const [accuracyPoints, setAccuracyPoints] = useState<AccuracyPoint[]>([]);
  const [rolling7d, setRolling7d] = useState<number | null>(null);
  const [rolling30d, setRolling30d] = useState<number | null>(null);
  const [rolling365d, setRolling365d] = useState<number | null>(null);
  const [accuracyPoints365, setAccuracyPoints365] = useState<AccuracyPoint[]>([]);
  const [streakDates, setStreakDates] = useState<string[]>([]);
  const [gradeLog, setGradeLog] = useState<Awaited<ReturnType<typeof loadGradeLog>>>([]);
  const [retentionTarget, setRetentionTarget] = useState(0.9);
  const [earnedBadgeIds, setEarnedBadgeIds] = useState<readonly string[]>([]);

  useEffect(() => {
    async function load() {
      const settings = loadSettings();
      // Load regional prefs — these are in the local settings blob (not cloud-only)
      // so they're available immediately without a Supabase round trip.
      if (settings.timezone) setUserTimezone(settings.timezone);
      if (settings.dateFormat) setUserDateFormat(settings.dateFormat);
      const saved = await loadSession();
      const sessionCards = saved !== null
        ? hydrateSession(saved.cards, SEED_POKEMON, SEED_EVOLUTION_CARDS, undefined, { reverseEnabled: settings.reverseCardsEnabled, nameEnabled: settings.nameCardsEnabled, evolutionEnabled: settings.evolutionCardsEnabled })
        : buildSession(SEED_POKEMON, SEED_EVOLUTION_CARDS, undefined, { reverseEnabled: settings.reverseCardsEnabled, nameEnabled: settings.nameCardsEnabled, evolutionEnabled: settings.evolutionCardsEnabled });
      // Render local first for a fast first paint, then overlay cloud below.
      setCards(sessionCards);
      setMasteryRepetitions(settings.masteryRepetitions);
      setNameCardsEnabled(settings.nameCardsEnabled);
      setCardTypeSettings({
        nameCardsEnabled: settings.nameCardsEnabled,
        evolutionCardsEnabled: settings.evolutionCardsEnabled,
        reverseEvolutionCardsEnabled: settings.reverseEvolutionCardsEnabled,
        reverseCardsEnabled: settings.reverseCardsEnabled,
        cryCardsEnabled: settings.cryCardsEnabled,
      });
      setRetentionTarget(settings.retentionTarget);
      const dates = loadStreakData();
      setStreakDates(dates);
      const tz = settings.timezone ?? "UTC";
      const today = todayString(new Date(), tz);
      setCurrentStreak(computeStreak(dates, today));
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
      // overlay below covers that QA case without touching persisted state.
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
          setEarnedBadgeIds(nextEntries.map((e) => e.id));
        } else {
          setEarnedBadgeIds(settings.earnedBadges.map((e) => e.id));
        }
      } else {
        setEarnedBadgeIds(settings.earnedBadges.map((e) => e.id));
      }

      // If signed in (and superuser flags are off), overlay the cloud data
      // on top of the local render. This ensures stats reflect cloud truth
      // even when local IDB is stale or corrupted.
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
          // Network failure — stay on local render, do not break the page.
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
          todayString(new Date(), userTimezone),
          10,
          masteryRepetitions,
          flags.pretendAllMastered,
        )
      : null;
  // Resolve which badge definitions to render on the trainer card. With
  // `pretendAllMastered` on, every catalog badge is shown without touching
  // persisted state — exit cleanup will pull the real cloud list back and
  // the synthetic StorageEvent in `saveSettings` triggers a re-read here.
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

  const completionProjection =
    nameCards !== null && masteryRepetitions !== null
      ? computeCompletionProjection(
          nameCards,
          todayString(new Date(), userTimezone),
          masteryRepetitions,
          flags.pretendAllMastered,
        )
      : null;

  // Per-card-direction breakdown (#761) and retention-vs-target (#765) both
  // derive from review history, not mastery state, so neither is affected
  // by the pretendAllMastered superuser flag.
  //
  // The FSRS difficulty histogram (#764) DOES honour pretendAllMastered: the
  // helper zeroes the population when the flag is on, consistent with
  // computeStats clearing the struggling list.
  //
  // These are computed only once `cards` has loaded. Doing the work behind
  // the `cards !== null` gate keeps `new Date()` out of the static prerender
  // (Cache Components rejects `new Date()` reached during a client-component
  // render without a Suspense boundary).
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
            // Grade distribution and weekly trend — derive from review history,
            // NOT mastery state, so they are unaffected by pretendAllMastered.
            gradeDistribution: computeGradeDistribution(gradeLog),
            gradeTrend: computeGradeTrend(gradeLog, today, 12),
            // Activity history — reviews per day and new cards introduced per
            // day over the rolling year. Derives from review history, NOT
            // mastery state, so it is unaffected by pretendAllMastered.
            activityHistory: computeActivityHistory(gradeLog, today, 365),
            // Mastery over time IS mastery-derived and MUST honour
            // pretendAllMastered (canonical pattern: forceAllMastered goes
            // through to the pure helper as an optional param).
            masteryOverTime: computeMasteryOverTime(
              // nameCards is non-null here: the IIFE is only reached when
              // cards !== null, which is the same condition that sets nameCards.
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

        {stats === null || currentStreak === null ? (
          <LoadingSkeleton />
        ) : (
          <div className="flex flex-col gap-10">
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
            <BadgeGallery
              earnedBadges={badgesToShow}
              forceAllMastered={flags.pretendAllMastered}
            />
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
            {records !== null ? <RecordsCard records={records} /> : null}
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
                <MasteryOverTimeChart
                  series={reviewCharts.masteryOverTime}
                  totalCards={stats.totalCards}
                  dateFormat={userDateFormat}
                  forceAllMastered={flags.pretendAllMastered}
                />
              </>
            )}
            <ReviewHeatmap
              columns={computeReviewHeatmap(gradeLog, todayString(new Date(), userTimezone))}
            />
            {reviewCharts !== null && (
              <ActivityHistoryChart
                series={reviewCharts.activityHistory}
                dateFormat={userDateFormat}
              />
            )}
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
            <MasteryRings stats={stats} nameCardsEnabled={nameCardsEnabled} />
            <IntroducedRing stats={stats} />
            {completionProjection !== null && (
              <CompletionProjection
                projection={completionProjection}
                fmt={userDateFormat}
                tz={userTimezone}
              />
            )}
            <DueForecast stats={stats} fmt={userDateFormat} tz={userTimezone} />
            <GenerationBreakdown stats={stats} />
            <TypeBreakdown perType={stats.perType} />
            <StrugglingCards stats={stats} />
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
