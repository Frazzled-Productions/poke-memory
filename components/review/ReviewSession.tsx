"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PokemonCard } from "@/components/review/PokemonCard";
import { TypedEntryNameCard } from "@/components/review/TypedEntryNameCard";
import { MultipleChoiceNameCard } from "@/components/review/MultipleChoiceNameCard";
import { EvolutionCard } from "@/components/review/EvolutionCard";
import { SpritePicker } from "@/components/review/SpritePicker";
import { SpritePreloader, type SizedSpriteUrl } from "@/components/sprites/SpritePreloader";
import { preloadableSpriteUrls, PICKER_SPRITE_SIZE, PRACTICE_SPRITE_SIZE } from "@/lib/review/sprites";
import { decodeSpriteUrls, DECODE_GRADE_TIMEOUT_MS } from "@/lib/sprites/decode";
import { DirectionBadge } from "@/components/review/DirectionBadge";
import { QueueStateBadge } from "@/components/review/QueueStateBadge";
import { GradeButtons, KeyboardShortcutsOverlay } from "@/components/review/GradeButtons";
import { useSwipeGrade } from "@/components/review/useSwipeGrade";
import { SwipeHint } from "@/components/review/SwipeHint";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";
import type { SeedPokemon, EvolutionCard as SeedEvolutionCard } from "@/lib/pokemon/seed";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed-constants";
import { useSeed } from "@/lib/pokemon/SeedContext";
import { reconcileHiddenState } from "@/lib/review/filters";
import { pickDistractors } from "@/lib/pokemon/distractors";
import { buildMcOptions } from "@/lib/srs/multipleChoiceDistractors";
import {
  buildSession,
  buildSessionQueues,
  countDueTomorrow,
  getNextCardId,
  hydrateSession,
  limitBucket,
  todayString,
  cardTypeIsEnabled,
  type DailyLimits,
  type ReviewableCard,
  type Grade,
  DEFAULT_LIMITS,
} from "@/lib/review/session";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { useStorageQuota } from "@/lib/review/useStorageQuota";
import { StorageQuotaBanner } from "@/components/review/StorageQuotaBanner";
import { GradeErrorBanner } from "@/components/review/GradeErrorBanner";
import { recordReview } from "@/lib/streak";
import { loadSettings, saveSettings, type UserSettings } from "@/lib/settings/persistence";
// SETTINGS_SAVED_EVENT is now consumed inside useSessionReloadListeners (#1520).
import { LOCALE_ENDONYMS, type AppLocale } from "@/i18n/locales";
import { nextReview, type ReviewState } from "@/lib/srs/scheduler";
import { learningStepsFor, relearningStepsFor } from "@/lib/srs/constants";
import { getPokemonFacts, selectFact, loadFlavorTexts, type PokemonFact } from "@/lib/pokemon/facts";
import { playCry } from "@/lib/audio/cry";
import { speakName, warmupTts } from "@/lib/audio/tts";
import { waitForAudio } from "@/lib/audio/waitForAudio";
import { useAuth } from "@/lib/auth/AuthContext";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { usePerGradeSync } from "@/lib/sync/usePerGradeSync";
import { useSyncOnUnload } from "@/lib/sync/useSyncOnUnload";
// SYNC_PULL_APPLIED_EVENT is now consumed inside useSessionReloadListeners (#1520).
import { appendGradeEntry, loadGradeLog, removeGradeEntry, todayGradeSequence } from "@/lib/gradelog/persistence";
import { GradeBreakdownBar } from "@/components/stats/GradeBreakdownBar";
import {
  computeSessionDirectionAccuracy,
  type SessionDirectionTally,
} from "@/lib/stats/direction-breakdown";
import { ReviewCardLayout } from "@/components/review/ReviewCardLayout";
import { ShareTodayButton } from "@/components/review/ShareTodayButton";
import { previewIntervals } from "@/lib/srs/intervalPreview";
import { isMastered } from "@/lib/stats/derive";
import { BADGE_CATALOG, type BadgeDefinition } from "@/lib/badges/catalog";
import { checkBadges } from "@/lib/badges/check";
import { masteredSpeciesIds } from "@/lib/badges/derive";
import { BadgeToast } from "@/components/badges/BadgeToast";
import { triggerHaptic } from "@/lib/review/haptic";
import { markSessionActive, markSessionInactive, markCardRevealed } from "@/lib/review/sessionActive";
import { KEY_HAS_MASTERED, KEY_OFFLINE_DOWNLOADED_AT } from "@/lib/storage/keys";
// KEY_SETTINGS is now consumed inside useSessionReloadListeners (#1520).
import { writeMasteredCountForLocale } from "@/lib/profile/masteredCountCache";
import {
  writeDueCounts,
  writeHasHistory,
  readDueCountCache,
  type DueCountByLocale,
  type HasHistoryByLocale,
} from "@/lib/profile/dueCountCache";
import { filterMastered } from "@/lib/pasture/arrivals";
import { type DailySummaryParts } from "@/lib/review/share";
// formatDailySummary is now consumed inside useShareSheet (#1520).
import {
  loadDailySummary,
  saveDailySummary,
} from "@/lib/review/dailySummaryPersistence";
// computeStreak / effectiveStreakDates / loadStreakData are now consumed
// inside useShareSheet (#1520).
import {
  EMPTY_SCOPE,
  cardIsEligible,
  cardMatchesScope,
  computeEligibleCardIds,
  isScopeEmpty,
  type PracticeScope,
  type ScopeMatchContext,
} from "@/lib/review/scope";
import { ScopeControl } from "@/components/review/ScopeControl";
import { HigherOrLowerGame } from "@/components/review/HigherOrLowerGame";
import { getSeenPokemon } from "@/lib/minigame/higherOrLower";
import { incompleteChainSpeciesIds } from "@/lib/evolution/chains";
import { computeSpeciesLegStatuses } from "@/lib/stats/legStatus";
import { mutedText, mutedTextXs, sectionLabel, colStack } from "@/lib/utils/class-names";
import { getOrCreateClientSalt } from "@/lib/identity/clientSalt";
import { addDaysToIsoDate } from "@/lib/utils/dates";
import { useShareSheet } from "@/components/review/useShareSheet";
import { useSessionReloadListeners } from "@/components/review/useSessionReloadListeners";
import { useLearningQueueTimer } from "@/components/review/useLearningQueueTimer";


// Pull learning cards forward when due within this window (Anki default: 20 min).
const LEARN_AHEAD_MS = 20 * 60_000;

// Number of completed practice sessions required before the scope nudge shows (#1482).
// Consistent with the appVisitCount threshold used by PwaInstallNudge.
const SCOPE_NUDGE_SESSION_THRESHOLD = 3;

// sessionStorage key guarding the per-session practice-count increment (#1482).
// A new key (not reusing PwaInstallNudge's visit key) because this counts
// sessions with at least one grade, not page visits.
const SCOPE_NUDGE_SESSION_KEY = "poke-memory:practice-session-counted:v1";

// Thresholds for the offline-download discovery nudge (#1538).
// The nudge shows when EITHER signal crosses its threshold.
const OFFLINE_NUDGE_SLOW_LOAD_THRESHOLD = 3;
const OFFLINE_NUDGE_SESSION_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EndState = "SESSION_COMPLETE" | "REVIEW_SOFT_WALL" | "NEW_CARDS_LOCKED";

type LearningQueueEntry = { cardId: number; dueAt: number };

type UndoSnapshot = {
  /** Locale-filtered card view to restore into React state (#1562). */
  cards: ReviewableCard[];
  /**
   * Complete multi-locale card array for `saveSession` (#1562).
   * MULTI-LOCALE: saveSession always receives the full array; `cards` is only
   * the active-locale view restored into React state.
   */
  fullCards: ReviewableCard[];
  sessionGrades: Record<Grade, number>;
  sessionGradeSeq: Grade[];
  sessionDirectionGrades: SessionDirectionTally;
  newCardsThisSession: number;
  masteredThisSession: number;
  learningQueue: LearningQueueEntry[];
  cardId: number;
  // `occurredAt` of the grade-log entry written by this grade - used to
  // pop the entry back out on undo. `null` if appendGradeEntry failed.
  gradeLogOccurredAt: number | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stepDurationMs(
  lastReview: string | null,
  stepIndex: number,
  difficulty: number,
): number {
  const steps =
    lastReview === null
      ? learningStepsFor(difficulty)
      : relearningStepsFor(difficulty);
  return steps[Math.min(stepIndex, steps.length - 1)];
}

function limitsFromSettings(settings: UserSettings): DailyLimits {
  return {
    name: {
      maxNewPerDay: settings.maxNewPerDay,
      maxReviewsPerDay: settings.maxReviewsPerDay,
    },
    evolution: {
      maxNewPerDay: settings.maxNewEvolutionPerDay,
      maxReviewsPerDay: settings.maxReviewsEvolutionPerDay,
    },
    reverse: {
      maxNewPerDay: settings.maxNewReversePerDay,
      maxReviewsPerDay: settings.maxReviewsReversePerDay,
    },
    cry: {
      maxNewPerDay: settings.maxNewCryPerDay,
      maxReviewsPerDay: settings.maxReviewsCryPerDay,
    },
  };
}

/**
 * Determine whether a grade on `gradedCard` caused a species to transition from
 * NOT-species-mastered to species-mastered (#1448/#1234).
 *
 * A species is mastered when BOTH its name card AND its paired reverse card have
 * cleared the FSRS gate. This helper checks:
 *   1. After the grade (`newCards`), is the species now fully mastered?
 *   2. Before the grade (using `preGradeState` for the graded card, `newCards`
 *      for all others which are unchanged), was it NOT fully mastered?
 *
 * Only name and reverse cards can trigger a species mastery crossing.
 */
function speciesBecameMastered(
  gradedCard: ReviewableCard,
  preGradeState: ReviewState,
  newCards: ReviewableCard[],
): boolean {
  let nameCardId: number;
  let reverseCardId: number;

  if (gradedCard.cardType === "name") {
    nameCardId = gradedCard.id;
    reverseCardId = REVERSE_ID_OFFSET + gradedCard.id;
  } else if (gradedCard.cardType === "reverse") {
    reverseCardId = gradedCard.id;
    nameCardId = gradedCard.id - REVERSE_ID_OFFSET;
  } else {
    // Evolution / cry cards cannot complete species mastery.
    return false;
  }

  // After the grade: both legs must be mastered in newCards.
  const nameCardAfter = newCards.find((c) => c.id === nameCardId && c.cardType === "name");
  const reverseCardAfter = newCards.find((c) => c.id === reverseCardId && c.cardType === "reverse");

  if (nameCardAfter === undefined || reverseCardAfter === undefined) return false;
  const nameAfterMastered = isMastered(nameCardAfter.state);
  const reverseAfterMastered = isMastered(reverseCardAfter.state);
  if (!nameAfterMastered || !reverseAfterMastered) return false;

  // Before the grade: the graded card used preGradeState; all other cards are
  // unchanged in newCards (same object reference for non-graded entries).
  const nameBeforeMastered =
    gradedCard.id === nameCardId
      ? isMastered(preGradeState)
      : isMastered(nameCardAfter.state);
  const reverseBeforeMastered =
    gradedCard.id === reverseCardId
      ? isMastered(preGradeState)
      : isMastered(reverseCardAfter.state);

  // Species transition: was NOT species-mastered before, IS now.
  return !(nameBeforeMastered && reverseBeforeMastered);
}

/**
 * Format milliseconds as "Xm Ys" (e.g. "1m 23s") or just "Xs" when under 1m.
 */
function formatCountdown(ms: number): string {
  const totalSecs = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSecs / 60);
  const seconds = totalSecs % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/**
 * Write the lightweight "has mastered at least one species" flag to
 * localStorage and dispatch a `StorageEvent` so same-tab subscribers
 * (`NavLinks`, `BottomTabBar`) update without needing to re-parse the whole
 * session blob from IDB (#1191 Class A item 3).
 *
 * Only called when the flag value actually changes (false → true on the first
 * mastery, or true → false if the session is reset). Skips when any superuser
 * flag is on so QA sessions don't pollute local state.
 */
function writeHasMasteredFlag(val: boolean): void {
  if (typeof window === "undefined") return;
  const storage = window.localStorage;
  if (!storage) return;
  const str = val ? "true" : "false";
  try {
    storage.setItem(KEY_HAS_MASTERED, str);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: KEY_HAS_MASTERED,
        newValue: str,
        storageArea: storage,
      }),
    );
  } catch {
    // Quota or non-standard environment - silently skip.
  }
}

/**
 * Write the per-locale mastered-species count to the lightweight localStorage
 * cache after a grade changes mastery state. Called by the handleGrade
 * persistence chain (where `newCards` is the post-grade card array) and on
 * session mount (to populate the cache for existing users on upgrade).
 *
 * Uses `filterMastered` - the same authoritative derivation as
 * `computeStats` - so the parity contract test in
 * `components/profile/useProfileStatus.test.tsx` can hold.
 *
 * Only fires when not superuser-guarded (consistent with other localStorage
 * writes in ReviewSession).
 */
function writeMasteredCountCache(
  cards: ReviewableCard[],
  locale: AppLocale,
): void {
  const count = filterMastered(cards, false, locale).length;
  writeMasteredCountForLocale(locale, count);
}

/**
 * Computes per-locale due-today review counts from the hydrated card array and
 * writes them to the due-count cache read by the LanguageSwitcher badges
 * (#1484). Purely additive + read-only - it does not touch the queue logic.
 * Counts graduated cards (learningStep === null) that have been reviewed before
 * and are due on or before today, excluding cards already reviewed today.
 */
function writeDueCountCacheFromCards(
  cards: ReviewableCard[],
  today: string,
): void {
  const counts: DueCountByLocale = { en: 0, ja: 0, "zh-Hans": 0, "zh-Hant": 0 };
  const hasHistory: HasHistoryByLocale = {
    en: false,
    ja: false,
    "zh-Hans": false,
    "zh-Hant": false,
  };
  for (const c of cards) {
    const loc = c.locale ?? "en";
    const s = c.state;
    if (s.lastReview !== null) {
      hasHistory[loc] = true;
    }
    if (
      s.lastReview !== null &&
      s.learningStep === null &&
      s.dueDate <= today &&
      s.lastReview !== today
    ) {
      counts[loc] += 1;
    }
  }
  writeDueCounts(counts);
  writeHasHistory(hasHistory);
}

// ---------------------------------------------------------------------------
// Sub-components: end states
// ---------------------------------------------------------------------------

type PerTypeTodayCounts = {
  name: { newIntroducedToday: number; reviewsDoneToday: number };
  evolution: { newIntroducedToday: number; reviewsDoneToday: number };
  reverse: { newIntroducedToday: number; reviewsDoneToday: number };
  cry: { newIntroducedToday: number; reviewsDoneToday: number };
};

/**
 * `TodayPill` receives only primitive/plain-object props from `ReviewSession`.
 * `React.memo` skips re-renders when none of the props have shallowly changed
 * - primarily useful between grading batches when the card flips but the daily
 * counters haven't changed yet (#1191 Class B item 8).
 */
const TodayPill = React.memo(function TodayPill({
  perType,
  nameEnabled,
  evolutionEnabled,
  reverseEnabled,
  reverseEvolutionEnabled,
  cryEnabled,
  activeLocaleEndonym,
}: {
  perType: PerTypeTodayCounts;
  nameEnabled: boolean;
  evolutionEnabled: boolean;
  reverseEnabled: boolean;
  reverseEvolutionEnabled: boolean;
  cryEnabled: boolean;
  /**
   * When more than one language is enrolled, show the active language endonym
   * in the "Done today" heading (#1562). `null` when only English is active
   * (single-language user - heading stays plain "Done today").
   */
  activeLocaleEndonym: string | null;
}) {
  const t = useTranslations("practice");
  // Passive hint (#880): when more than one card direction is enabled, a user
  // will often see the review queue dominated by a single direction (typically
  // reverse / sprite-picker). This is correct behaviour - the review queue
  // surfaces only graduated cards, and recognition cards graduate from the
  // learning steps sooner than recall cards. Surface a one-line explanation so
  // the user can discover why without reading the docs. Only shown when 2+
  // directions are on, since there is nothing to explain with a single one.
  // The count must include every card direction the user can enable - all five
  // tracked in ReviewSession (name, evolution, reverse, reverse-evolution, cry).
  const enabledDirections = [
    nameEnabled,
    evolutionEnabled,
    reverseEnabled,
    reverseEvolutionEnabled,
    cryEnabled,
  ].filter(Boolean).length;
  const showGraduatedHint = enabledDirections > 1;
  return (
    <div className={`${mutedTextXs} tabular-nums text-center`}>
      <p className={`mb-1 ${sectionLabel}`}>
        {activeLocaleEndonym !== null
          ? t("todayDoneHeadingWithLanguage", { language: activeLocaleEndonym })
          : t("todayDoneHeading")}
      </p>
      {nameEnabled && (
        <p>
          <span className="text-zinc-600 dark:text-zinc-300">{t("cardTypeName")}:</span>{" "}
          <span className="font-medium text-foreground">
            {perType.name.newIntroducedToday} {t("todayNew")}
          </span>
          {" · "}
          <span className="font-medium text-foreground">
            {perType.name.reviewsDoneToday} {t("todayReviewed")}
          </span>
        </p>
      )}
      {evolutionEnabled && (
        <p>
          <span className="text-zinc-600 dark:text-zinc-300">{t("cardTypeEvolution")}:</span>{" "}
          <span className="font-medium text-foreground">
            {perType.evolution.newIntroducedToday} {t("todayNew")}
          </span>
          {" · "}
          <span className="font-medium text-foreground">
            {perType.evolution.reviewsDoneToday} {t("todayReviewed")}
          </span>
        </p>
      )}
      {reverseEnabled && (
        <p>
          <span className="text-zinc-600 dark:text-zinc-300">{t("cardTypeReverse")}:</span>{" "}
          <span className="font-medium text-foreground">
            {perType.reverse.newIntroducedToday} {t("todayNew")}
          </span>
          {" · "}
          <span className="font-medium text-foreground">
            {perType.reverse.reviewsDoneToday} {t("todayReviewed")}
          </span>
        </p>
      )}
      {cryEnabled && (
        <p>
          <span className="text-zinc-600 dark:text-zinc-300">{t("cardTypeCry")}:</span>{" "}
          <span className="font-medium text-foreground">
            {perType.cry.newIntroducedToday} {t("todayNew")}
          </span>
          {" · "}
          <span className="font-medium text-foreground">
            {perType.cry.reviewsDoneToday} {t("todayReviewed")}
          </span>
        </p>
      )}
      {showGraduatedHint && (
        <p className="mt-2 max-w-xs text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
          {t("graduatedHint")}
        </p>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Per-direction accuracy row (#994)
// ---------------------------------------------------------------------------

/**
 * A compact inline row showing session accuracy per card direction, e.g.
 * "Name 91% · Evo 74% · Cry 58%". Only directions that received at least one
 * grade this session are shown. Omitted when the tally is empty (the user
 * graded nothing, so there is nothing to show).
 *
 * Accuracy is defined as the share of grades that were Good (4) or Easy (5)
 * - the same pass/fail convention used in `computeDirectionBreakdown` on the
 * Stats page, so both surfaces are consistent.
 */
function DirectionAccuracyRow({ tally }: { tally: SessionDirectionTally }) {
  const rows = computeSessionDirectionAccuracy(tally);
  if (rows.length === 0) return null;

  /** Short display label for each direction. */
  const shortLabel: Record<string, string> = {
    name: "Name",
    reverse: "Reverse",
    cry: "Cry",
    evolution: "Evo",
    "reverse-evolution": "Reverse evo",
  };

  const parts = rows.map((row) => {
    const pct = Math.round((row.accuracy ?? 0) * 100);
    return `${shortLabel[row.direction] ?? row.direction} ${pct}%`;
  });

  return (
    <p
      className={`${mutedTextXs} tabular-nums`}
      aria-label={`Session accuracy by direction: ${parts.join(", ")}`}
    >
      {parts.join(" · ")}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Unified end-of-session screen (#926)
// ---------------------------------------------------------------------------

type EndOfSessionVariant =
  | { kind: "complete" }
  | { kind: "new-locked" }
  | { kind: "review-wall"; onKeepReviewing: () => void };

/**
 * Single component that covers all three end-of-session states:
 * "all caught up" (SESSION_COMPLETE), "new cards locked" (NEW_CARDS_LOCKED),
 * and "daily review limit reached" (REVIEW_SOFT_WALL). Shared affordances - 
 * the "N cards due tomorrow" teaser (#914), the TodayPill, the Share button,
 * and the card-types onboarding nudge - render on every variant when applicable.
 */
function EndOfSessionScreen({
  variant,
  perType,
  nameEnabled,
  evolutionEnabled,
  reverseEnabled,
  reverseEvolutionEnabled,
  cryEnabled,
  shareText,
  shareParts,
  dueTomorrow,
  showCardTypesHint,
  directionGrades,
  activeLocale,
  learningLocales,
  dueCountByLocale,
  onSwitchLocale,
  onClearScope,
}: {
  variant: EndOfSessionVariant;
  perType: PerTypeTodayCounts;
  nameEnabled: boolean;
  evolutionEnabled: boolean;
  reverseEnabled: boolean;
  reverseEvolutionEnabled: boolean;
  cryEnabled: boolean;
  /** Pre-formatted share summary; null when the user has not graded anything today. */
  shareText: string | null;
  /** Structured parts for image card generation; always present when shareText is not null. */
  shareParts: DailySummaryParts | null;
  /** Count of graduated cards whose dueDate falls exactly on tomorrow. 0 hides the teaser. */
  dueTomorrow: number;
  /**
   * True when at least one off-by-default card type is still disabled, so the
   * one-time card-types nudge (#702) is worth showing here. The hint itself
   * still self-suppresses once dismissed via `OnboardingFlags`.
   */
  showCardTypesHint: boolean;
  /** Per-direction grade tally from the current session, for the accuracy row. */
  directionGrades: SessionDirectionTally;
  /** The currently active locale for this session (#1562). */
  activeLocale: AppLocale;
  /** All enrolled learning locales (#1562). */
  learningLocales: AppLocale[];
  /** Per-locale due counts from the cache (#1562). */
  dueCountByLocale: DueCountByLocale;
  /** Called when the user taps the "switch to language with due cards" button (#1562). */
  onSwitchLocale: (locale: AppLocale) => void;
  /**
   * When a practice scope filter is active, this callback clears it so the
   * user can keep practising the full card set. Its presence signals that a
   * filter is active; absence means no filter is set (#1797).
   */
  onClearScope?: () => void;
}) {
  const t = useTranslations("practice");

  // Find another enrolled locale that has due cards (#1562). Used by the
  // "all caught up in X" end-screen to offer a one-tap language switch.
  const localeWithDue = learningLocales.find(
    (loc) => loc !== activeLocale && (dueCountByLocale[loc] ?? 0) > 0,
  ) ?? null;

  // When more than one language is enrolled, show the language endonym in the
  // "Done today" heading. Single-locale users get the plain heading.
  const activeLocaleEndonym =
    learningLocales.length > 1 ? LOCALE_ENDONYMS[activeLocale] : null;

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {variant.kind === "complete" && (
        <>
          <p className="text-2xl font-semibold text-foreground">
            {learningLocales.length > 1
              ? t("allCaughtUpInLanguage", { language: LOCALE_ENDONYMS[activeLocale] })
              : t("allCaughtUp")}
          </p>
          <p className="text-zinc-500 dark:text-zinc-400">
            {t("nothingDueBody")}
          </p>
          {onClearScope !== undefined && (
            <button
              type="button"
              className="min-h-[44px] rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              onClick={onClearScope}
            >
              {t("clearFilterToPractise")}
            </button>
          )}
          {localeWithDue !== null && (
            <button
              type="button"
              className="min-h-[44px] rounded-lg bg-theme-accent px-6 py-2 text-sm font-semibold text-theme-fg-on-primary transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2"
              onClick={() => onSwitchLocale(localeWithDue)}
            >
              {t("switchToLanguageWithDue", {
                count: dueCountByLocale[localeWithDue],
                language: LOCALE_ENDONYMS[localeWithDue],
              })}
            </button>
          )}
        </>
      )}
      {variant.kind === "new-locked" && (
        <>
          <p className="text-2xl font-semibold text-foreground">{t("newCardsLocked")}</p>
          <p className="text-zinc-500 dark:text-zinc-400 max-w-xs">
            {t("newCardsLockedBody")}
          </p>
          {onClearScope !== undefined && (
            <button
              type="button"
              className="min-h-[44px] rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              onClick={onClearScope}
            >
              {t("clearFilterToPractise")}
            </button>
          )}
        </>
      )}
      {variant.kind === "review-wall" && (
        <>
          <p className="text-2xl font-semibold text-foreground">{t("reviewWall")}</p>
          <p className="text-zinc-500 dark:text-zinc-400 max-w-xs">
            {t("reviewWallBody")}
          </p>
        </>
      )}
      {dueTomorrow > 0 && (
        <p className={mutedText}>
          {t("dueTomorrow", { count: dueTomorrow })}
        </p>
      )}
      <TodayPill
        perType={perType}
        nameEnabled={nameEnabled}
        evolutionEnabled={evolutionEnabled}
        reverseEnabled={reverseEnabled}
        reverseEvolutionEnabled={reverseEvolutionEnabled}
        cryEnabled={cryEnabled}
        activeLocaleEndonym={activeLocaleEndonym}
      />
      <DirectionAccuracyRow tally={directionGrades} />
      {shareText !== null && shareParts !== null ? (
        <ShareTodayButton parts={shareParts} text={shareText} />
      ) : null}
      {variant.kind === "review-wall" && (
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            className="min-h-[44px] rounded-lg bg-zinc-100 px-8 py-2 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            onClick={() => {
              // "Done for today" - reload the page so the session resets cleanly.
              window.location.reload();
            }}
          >
            {t("doneForToday")}
          </button>
          <button
            type="button"
            className="min-h-[44px] rounded-lg bg-theme-accent px-8 py-2 text-sm font-semibold text-theme-fg-on-primary transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2"
            onClick={variant.onKeepReviewing}
          >
            {t("keepReviewing")}
          </button>
        </div>
      )}
      {showCardTypesHint && (
        <div className="w-full max-w-xs text-left">
          <OnboardingHint
            id="cardTypesHintDismissed"
            title={t("readyForMoreVariety")}
            ctaHref="/settings#card-types-heading"
            ctaLabel={t("openPracticeSettings")}
          >
            <p>{t("readyForMoreVarietyBody")}</p>
          </OnboardingHint>
        </div>
      )}
    </div>
  );
}

function CountdownScreen({
  dueAt,
  perType,
  nameEnabled,
  evolutionEnabled,
  reverseEnabled,
  reverseEvolutionEnabled,
  cryEnabled,
}: {
  dueAt: number;
  perType: PerTypeTodayCounts;
  nameEnabled: boolean;
  evolutionEnabled: boolean;
  reverseEnabled: boolean;
  reverseEvolutionEnabled: boolean;
  cryEnabled: boolean;
}) {
  const t = useTranslations("practice");
  const [remaining, setRemaining] = useState(() => dueAt - Date.now());

  useEffect(() => {
    setRemaining(dueAt - Date.now());
    const id = setInterval(() => {
      setRemaining(dueAt - Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [dueAt]);

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="text-2xl font-semibold text-foreground">{t("nextCardIn")}</p>
      <p
        className="text-4xl font-bold tabular-nums text-foreground"
        aria-live="polite"
        aria-atomic="true"
      >
        {formatCountdown(remaining)}
      </p>
      <p className="text-zinc-500 dark:text-zinc-400 max-w-xs">
        {t("nextCardHangTight")}
      </p>
      <TodayPill perType={perType} nameEnabled={nameEnabled} evolutionEnabled={evolutionEnabled} reverseEnabled={reverseEnabled} reverseEvolutionEnabled={reverseEvolutionEnabled} cryEnabled={cryEnabled} activeLocaleEndonym={null} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReviewSession() {
  const t = useTranslations("practice");
  const { seed: seedData, error: seedError, retry: seedRetry } = useSeed();
  const seedPokemon: readonly SeedPokemon[] = seedData?.seedPokemon ?? [];
  const seedEvolutionCards: readonly SeedEvolutionCard[] = seedData?.seedEvolutionCards ?? [];
  // null = SSR / not-yet-hydrated. Same pattern as before.
  //
  // MULTI-LOCALE: `cards` is the ACTIVE-LOCALE-FILTERED view of the session.
  // The complete multi-locale array lives in `fullSessionRef`. Every saveSession
  // call must write the full array - never the filtered `cards`. See the invariant
  // comment at each saveSession call site in this file.
  const [cards, setCards] = useState<ReviewableCard[] | null>(null);
  // MULTI-LOCALE: holds the complete multi-locale card array from the last load
  // or grade. `cards` state is always a subset: full.filter(c => locale matches).
  // Initialised to [] before the load effect fires; never null (avoids conditional
  // branches inside the update helpers).
  const fullSessionRef = useRef<ReviewableCard[]>([]);
  const [limits, setLimits] = useState<DailyLimits>(DEFAULT_LIMITS);
  const [reverseEnabled, setReverseEnabled] = useState(true);
  const [reverseEvolutionEnabled, setReverseEvolutionEnabled] = useState(false);
  const [evolutionCardsEnabled, setEvolutionCardsEnabled] = useState(true);
  const [cryCardsEnabled, setCryCardsEnabled] = useState(false);
  const [alternateFormsEnabled, setAlternateFormsEnabled] = useState(false);
  // Active Pokémon-name locale (#1562). Read once from settings at mount so a
  // mid-session locale switch (via the language switcher) cannot swap cards
  // mid-render. The storage-event handler already triggers a full page reload
  // on settings changes, so the next session will pick up the new locale exactly
  // as it does for card-type toggles.
  const [activeLocale, setActiveLocale] = useState<AppLocale>("en");
  // All enrolled learning locales (#1562). Read from settings at mount.
  // Used by the end-of-session "switch language" button and TodayPill label.
  const [learningLocales, setLearningLocales] = useState<AppLocale[]>(["en"]);
  // Verified typed-entry mode (#1251). Read into state on session load via the
  // session-load effect. Same-tab toggles take effect on the next session via the
  // storage event; the in-flight card always uses the value captured at load time.
  const [verifiedTypedEntryMode, setVerifiedTypedEntryMode] = useState(false);
  // Default true pre-hydration so the banner doesn't flash for users whose
  // persisted setting is true. The session-load effect (~line 939) overwrites
  // this with the actual persisted value (default false for new users).
  const [mcCardOnboardingShown, setMcCardOnboardingShown] = useState(true);
  // Whether the first-visit onboarding modal has been dismissed (#1103).
  // Defaults true so a returning user (firstVisitOnboardingDismissed = true in
  // storage) sees no blank gap while settings load. Brand-new users will briefly
  // see the scope nudge until the session-load effect fires and sets this to
  // false - acceptable given the short hydration window.
  const [firstVisitDone, setFirstVisitDone] = useState(true);
  // Scope-nudge gate signals (#1482). Read from settings on session load.
  // `scopeEverOpened` is true when the user has previously interacted with
  // ScopeControl; `practiceSessionsCount` counts completed practice sessions
  // (sessionStorage-guarded, incremented on first grade). Both default to the
  // suppressing value (true / large number) so the nudge never flashes before
  // settings are loaded. The session-load effect replaces them with real values.
  const [scopeEverOpened, setScopeEverOpened] = useState(true);
  // Default to SESSION_THRESHOLD so nudge is hidden before hydration.
  const [practiceSessionsCount, setPracticeSessionsCount] = useState(SCOPE_NUDGE_SESSION_THRESHOLD);
  // Offline-download nudge signals (#1538). Both default to suppressing values
  // so the nudge never flashes before settings are loaded.
  const [slowSpriteLoadCount, setSlowSpriteLoadCount] = useState(OFFLINE_NUDGE_SLOW_LOAD_THRESHOLD);
  // true = user already has a download, or settings haven't loaded yet.
  const [offlineDownloaded, setOfflineDownloaded] = useState(true);
  // Onboarding nudges (#702). `cardTypesAllOn` is true when every
  // off-by-default card type is enabled - when that holds there is nothing
  // left to nudge towards on the session-complete screen.
  // Note: `audioFeaturesOff` was removed in #1103 (consolidated into the
  // one-time first-visit modal). `cardTypesAllOn` remains for the end-of-session
  // card-types nudge, which is still shown in EndOfSessionScreen.
  const [cardTypesAllOn, setCardTypesAllOn] = useState(false);
  const [revealed, setRevealed] = useState(false);
  // True while decode-ahead is running for an evolution/reverse-evolution
  // reveal flip. Guards against double-taps during the brief async window.
  const [revealing, setRevealing] = useState(false);
  const [grading, setGrading] = useState(false);
  // Transient flag: user chose "Keep reviewing" at the soft wall.
  // Not persisted - resets on every page load by design.
  const [extendedReview, setExtendedReview] = useState(false);

  // Keyboard shortcuts overlay - opened by the `?` key or the `?` hint button
  // on the GradeButtons panel. Controlled here so the keydown handler can open
  // it without going through a ref or event bus.
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);

  // Fact shown after card reveal - randomised on each reveal.
  const [currentFact, setCurrentFact] = useState<PokemonFact | null>(null);

  // In-memory learning queue: cards currently in a learning or relearning step.
  // Initialized at mount from learningCardIds; updated on every grade.
  const [learningQueue, setLearningQueue] = useState<LearningQueueEntry[]>([]);

  // Live session grade tally - resets on page navigation by design. Labelled
  // "this session" in the UI to set expectations.
  const [sessionGrades, setSessionGrades] = useState<Record<Grade, number>>({ 1: 0, 2: 0, 4: 0, 5: 0 });
  // Per-direction grade tally for the session-end accuracy breakdown row.
  // Only directions that received at least one grade appear in this map.
  const [sessionDirectionGrades, setSessionDirectionGrades] = useState<SessionDirectionTally>(new Map());
  // Per-card grade history for the daily share card. Wiped on session
  // reload; not persisted (the share is a one-tap end-of-session affordance).
  const [sessionGradeSeq, setSessionGradeSeq] = useState<Grade[]>([]);
  const [newCardsThisSession, setNewCardsThisSession] = useState(0);
  const [masteredThisSession, setMasteredThisSession] = useState(0);
  const [scope, setScope] = useState<PracticeScope>({ gens: [], types: [], presets: [] });
  // Card ids that pass the active scope. Recomputed in the session-load
  // effect; empty + active scope → the empty-state branch fires. Counters in
  // `buildSessionQueues` still see the full card set, so daily caps stay
  // stable when scope changes mid-day (#333).
  const [eligibleCardIds, setEligibleCardIds] = useState<Set<number>>(new Set());
  const [timezone, setTimezone] = useState("UTC");
  // Queue of newly-earned badges awaiting their reveal toast (#420). One is
  // rendered at a time; dismiss shifts the head off. Persisting is handled
  // in handleGrade - this queue only drives the in-session UI.
  const [pendingBadgeToasts, setPendingBadgeToasts] = useState<BadgeDefinition[]>([]);
  // Render the head of the queue - `position: fixed` on the toast itself, so
  // it doesn't matter which branch renders this node. Shared between every
  // user-facing return below so the reveal fires on session-complete too.
  const badgeToastSlot = pendingBadgeToasts.length > 0 ? (
    <BadgeToast
      key={pendingBadgeToasts[0].id}
      badgeName={pendingBadgeToasts[0].name}
      badgeDescription={pendingBadgeToasts[0].description}
      onDismiss={() => setPendingBadgeToasts((prev) => prev.slice(1))}
    />
  ) : null;

  // Scope nudge (#1443, refined #1482): one-shot hint explaining the practice
  // scope filter. Gate (in priority order):
  //   1. practiceScope non-empty -> suppress (user already uses scope).
  //   2. scopeEverOpened true    -> suppress (user has already opened scope).
  //   3. sessions < threshold    -> suppress (new user, not yet engaged enough).
  //   4. firstVisitDone false    -> suppress (first-visit modal still showing).
  //   5. Otherwise: show.
  // The OnboardingHint component handles the practiceScopeNudgeDismissed flag.
  const scopeNudge = (
    !isScopeEmpty(scope) ||
    scopeEverOpened ||
    practiceSessionsCount < SCOPE_NUDGE_SESSION_THRESHOLD ||
    !firstVisitDone
  ) ? null : (
    <div className="mb-3">
      <OnboardingHint id="practiceScopeNudgeDismissed" title={t("practiceScopeNudge.title")}>
        <p>{t("practiceScopeNudge.body")}</p>
      </OnboardingHint>
    </div>
  );

  // "Almost mastered" preset discovery nudge (#1767): one-shot hint pointing
  // users with blocked species to the mastery-blockers scope preset.
  // The "Almost mastered" preset nudge (masteryBlockersNudge) is defined below,
  // after the masteryBlockingSpeciesIds useMemo it depends on.

  function handleScopeChange(next: PracticeScope) {
    setScope(next);
    // Persist scope through user settings so it syncs cross-device (#333).
    // Read the latest settings before patching to avoid clobbering other
    // fields that may have been updated since this component mounted.
    // Also dismiss the scope nudge and mark scope as ever-opened - the user
    // has found the feature, so the nudge must not show again (#1482).
    const current = loadSettings();
    saveSettings({
      ...current,
      practiceScope: next,
      onboarding: {
        ...current.onboarding,
        practiceScopeNudgeDismissed: true,
        scopeEverOpened: true,
      },
    });
    setScopeEverOpened(true);
    // Recompute eligibility from the new scope against the current card
    // set + apply snooze reconciliation so hiddenSince / dueDate updates
    // are durable. Persist if any card mutated.
    if (cards !== null) {
      const today = todayString(new Date());
      // `changed` is intentionally unused here - handleScopeChange always
      // persists the full session after a scope change (line below) regardless
      // of whether reconcile modified any card state. Pass the current
      // incompleteChains context so the "Incomplete evolution chains" scope
      // correctly identifies in-scope species during snooze reconciliation.
      reconcileHiddenState(cards, next, today, { incompleteChainSpeciesIds: incompleteChains, masteryBlockingSpeciesIds });
      // `alternateFormsEnabled` and the card-type flags are captured from
      // component state set at mount. The Settings page triggers a full page
      // reload when toggling card-type gates, so the state is always current.
      // Context for progress-dependent presets (#995, #1767): both incomplete-chain
      // and mastery-blocker sets are derived from the current card set, which has
      // not changed here (only the scope did), so both are current.
      const eligibleIds = computeEligibleCardIds(
        cards,
        {
          evolutionCardsEnabled,
          reverseEvolutionCardsEnabled: reverseEvolutionEnabled,
          cryCardsEnabled: cryCardsEnabled,
          alternateFormsEnabled,
          practiceScope: next,
        },
        { incompleteChainSpeciesIds: incompleteChains, masteryBlockingSpeciesIds },
      );
      setEligibleCardIds(eligibleIds);
      // Clear the displayed-card render lock (#1088). The lock pins the
      // currently-displayed card across re-renders so a learning card whose
      // dueAt passes mid-render cannot displace it (#839). When the user
      // changes scope, the locked card may no longer be in scope, and keeping
      // the lock would leave the displayed card frozen on a now-out-of-scope
      // entry until the user grades it. The render-side override below also
      // checks scope-eligibility as a self-healing belt-and-braces guard, but
      // clearing here documents intent at the source of the change.
      setDisplayedCardId(null);
      // MULTI-LOCALE: save the full array, never the filtered view.
      void saveSession({ cards: fullSessionRef.current, limits }).then(notifySaveResult);
    }
  }

  // Monotonically-incrementing counter for each card presentation. Used to
  // force SpritePicker to remount (fresh shuffle) when the same reverse card
  // reappears via a learning-step replay or within-session review (#496).
  const [cardPresentationCount, setCardPresentationCount] = useState(0);

  // Single-step undo: snapshot of pre-grade state. Captured in handleGrade
  // and consumed by handleUndo. Cleared when the next grade fires. Held in a
  // ref because it is only read by the undo handler, never by render - moving
  // to a ref avoids forcing React to retain two full card-list copies in state
  // and re-rendering undo-snapshot consumers on every grade (#1191).
  const undoSnapshotRef = useRef<UndoSnapshot | null>(null);
  // Separate boolean state so the undo-button visibility can trigger a render
  // when the snapshot changes, without passing the full snapshot into state.
  const [hasUndoSnap, setHasUndoSnap] = useState(false);

  const { quotaExceeded, dismiss, notifySaveResult } = useStorageQuota();

  // Non-fatal grade error: set when nextReview throws (e.g. a corrupt grade
  // value that slips past TypeScript at runtime). The session remains usable - 
  // the corrupt grade is skipped and the user can continue.
  const [gradeError, setGradeError] = useState<string | null>(null);

  // Note: countdown timeout management moved to useLearningQueueTimer (#1520).
  // Locks the card the user clicked Reveal on so a learning-queue re-render
  // can't swap it out before the user submits a grade.
  const revealedCardId = useRef<number | null>(null);
  // Locks the card being displayed from the moment it first appears on screen
  // until the user explicitly advances by grading. Without this lock a learning
  // card whose dueAt passes mid-render can displace the current card before the
  // user has had a chance to tap Reveal, causing a mis-click (#839).
  //
  // Held as state (not a ref) so render reads are pure and writes from
  // event handlers / effects don't trip react-hooks/immutability. The
  // first-render auto-pin lives in a useEffect below; handlers
  // (handleGrade / handleUndo / handleScopeChange) call
  // setDisplayedCardId(...) directly. The "no extra render on lock change"
  // property the original ref had is preserved because every lock-write site
  // already batches with other setState calls in the same handler.
  const [displayedCardId, setDisplayedCardId] = useState<number | null>(null);
  // Guards against advancing to the next card after the component has unmounted
  // (e.g. the user navigates away during the waitForAudio delay).
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Kick off flavor-text fetch in the background so it is warm by the time
  // the user reveals their first card. Non-blocking: the critical render path
  // does not wait for this.
  useEffect(() => {
    void loadFlavorTexts();
  }, []);

  // Serialises background persistence work across rapid grades (#1191).
  // Each grade chains its saveSession + appendGradeEntry work onto this
  // promise so concurrent IDB reads inside appendGradeEntry never miss a
  // preceding write from the current grade.
  const persistenceChainRef = useRef<Promise<void>>(Promise.resolve());

  // Ref attached to the swipeable card container. Swipe-to-grade is active
  // only for flip-card types (name / evolution / cry) - reverse cards use
  // SpritePicker and have their own tap interaction (#1052).
  const cardRef = useRef<HTMLDivElement | null>(null);
  // Stable refs to the latest handleReveal / handleGrade so the keyboard
  // keydown effect never captures stale closures. handleReveal and handleGrade
  // are function-declarations (hoisted), so they can be referenced here even
  // though they appear lower in the file. The refs are updated synchronously
  // every render - no effect needed.
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  const handleRevealRef = useRef<() => Promise<void>>(handleReveal);
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  const handleGradeRef = useRef<(grade: Grade) => Promise<void>>(handleGrade);
  // Sync: per-grade debounced upserts (primary path) + unload safety-net.
  const { user, supabase } = useAuth();
  const { anyFlagOn: superuserGuarded, flags: superuserFlags } = useSuperuser();
  // When any superuser flag is on, suppress cloud writes by treating sync as
  // signed-out. Per-grade enqueue, debounced drain, and unload sendBeacon all
  // short-circuit on null client/userId. Background pulls (SyncOnVisible /
  // SignInPull) keep running so local stays consistent with cloud.
  const syncClient = superuserGuarded ? null : supabase;
  const syncUserId = superuserGuarded ? null : user?.id ?? null;
  const { enqueueGrade, flushPending } = usePerGradeSync(syncClient, syncUserId);
  useSyncOnUnload(syncClient, syncUserId, flushPending);

  // Per-user shuffle salt: authenticated users use their stable Supabase UUID;
  // guests use a per-device UUID persisted to localStorage.  This ensures the
  // daily card order is deterministic per (user, day) but differs across users.
  //
  // Wrapped in useMemo so the localStorage read/write only fires when the
  // identity changes, not on every render - avoids a side effect during render
  // that React 19 strict-mode would double-invoke.
  const shuffleSalt = useMemo(
    () => user?.id ?? getOrCreateClientSalt(),
    [user?.id],
  );

  // Lookup map from Pokémon id to SeedPokemon. Built once per seed load rather
  // than once at module load so that the JSON is NOT bundled into the boot chunk
  // (#1677). Returns an empty Map while the seed is loading.
  const seedById = useMemo(
    () => new Map(seedPokemon.map((p) => [p.id, p])),
    [seedPokemon],
  );

  // Runtime context for the "Incomplete evolution chains" scope preset (#995).
  // An incomplete chain is one the user has started but not finished mastering;
  // membership shifts as progress is made, so it is recomputed from the current
  // card set rather than stored as a static id list. Reuses the exact predicate
  // the Journey tab's Evolution Wall "In progress" filter uses, so the preset
  // and the wall always agree.
  //
  // Superuser: under `pretendAllMastered` every edge counts as mastered, so
  // every family is `completed` and the set is empty - the preset legitimately
  // matches nothing. `incompleteChainSpeciesIds` threads the flag through.
  const incompleteChains = useMemo(
    () =>
      cards !== null
        ? incompleteChainSpeciesIds(
            cards,
            superuserFlags.pretendAllMastered,
          )
        : new Set<number>(),
    [cards, superuserFlags.pretendAllMastered],
  );

  // Runtime context for the "Almost mastered" scope preset (#1767).
  // A species is "mastery-blocking" when exactly one of its name/reverse legs
  // has cleared the FSRS gate. Under pretendAllMastered every leg is treated as
  // mastered, so nothing is blocked and the preset correctly matches nothing.
  const masteryBlockingSpeciesIds = useMemo((): ReadonlySet<number> => {
    if (cards === null || superuserFlags.pretendAllMastered) return new Set<number>();
    const legStatuses = computeSpeciesLegStatuses(cards, activeLocale, false);
    return new Set(
      [...legStatuses.values()].filter((s) => s.isBlocked).map((s) => s.speciesId),
    );
  }, [cards, activeLocale, superuserFlags.pretendAllMastered]);

  // "Almost mastered" preset nudge (#1767). Gate (in priority order):
  //   1. firstVisitDone false             -> suppress (onboarding still showing).
  //   2. masteryBlockingSpeciesIds empty  -> suppress (nothing is blocked; nudge would be misleading).
  //   3. preset already active            -> suppress (user already knows about it).
  //   4. Otherwise: show.
  // OnboardingHint handles the masteryBlockersNudgeDismissed flag.
  const masteryBlockersNudge = (
    !firstVisitDone ||
    masteryBlockingSpeciesIds.size === 0 ||
    scope.presets.includes("mastery-blockers")
  ) ? null : (
    <div className="mb-3">
      <OnboardingHint id="masteryBlockersNudgeDismissed" title={t("masteryBlockersNudge.title")}>
        <p>{t("masteryBlockersNudge.body")}</p>
      </OnboardingHint>
    </div>
  );

  // Derive seen Pokémon for the Higher-or-Lower mini-game. Rendered on every
  // end-of-session variant (not just SESSION_COMPLETE) alongside the unified
  // EndOfSessionScreen. Apply the same two-tier gate as the practice session:
  // alternate-forms toggle first, then the gens/types/presets scope. Must stay
  // unconditional (hooks rule).
  const seenPokemon = useMemo(
    () =>
      cards !== null
        ? getSeenPokemon(cards, seedPokemon, alternateFormsEnabled, scope, {
            incompleteChainSpeciesIds: incompleteChains,
            masteryBlockingSpeciesIds,
          })
        : [],
    [cards, alternateFormsEnabled, scope, incompleteChains, masteryBlockingSpeciesIds],
  );

  // Higher-or-Lower signpost nudge (#1573): one-shot hint teasing the
  // post-session mini-game. Gate (in priority order):
  //   1. seenPokemon.length < 2  -> suppress. The game itself only renders at
  //      seenPokemon.length >= 2 (the end-of-session screen), so teasing it
  //      before then promises a game the user cannot yet reach (#1696).
  //   2. firstVisitDone false    -> suppress (first-visit modal still showing).
  //   3. Otherwise: show.
  // The OnboardingHint component handles the higherOrLowerNudgeDismissed flag.
  const higherOrLowerNudge = (
    seenPokemon.length < 2 ||
    !firstVisitDone
  ) ? null : (
    <div className="mb-3">
      <OnboardingHint id="higherOrLowerNudgeDismissed" title={t("higherOrLowerNudge.title")}>
        <p>{t("higherOrLowerNudge.body")}</p>
      </OnboardingHint>
    </div>
  );

  // Derive share parts/text unconditionally (hooks rule). Used only in the
  // end-of-session branch but must be called before any early return (#1520).
  const { shareParts, shareText } = useShareSheet(
    sessionGradeSeq,
    newCardsThisSession,
    masteredThisSession,
    timezone,
  );

  const cardMap = useMemo(
    () => new Map(cards !== null ? cards.map((c) => [c.id, c]) : []),
    [cards],
  );

  useEffect(() => {
    // Do not attempt to build a session until the async seed has loaded.
    if (seedData === null) return;
    async function load() {
      const settings = loadSettings();
      const saved = await loadSession();
      const now = new Date();
      let sessionCards: ReviewableCard[];
      let sessionLimits: DailyLimits;

      // Name and reverse are always on since #1234.
      const enabled = true;
      const nameEnabled = true;
      const evolutionEnabled = settings.evolutionCardsEnabled;
      const reverseEvolutionEnabledLocal = settings.reverseEvolutionCardsEnabled;
      const cryEnabled = settings.cryCardsEnabled;

      // poke-memory:settings:v1 is the source of truth for limits.
      // saved.limits (from the session) is intentionally ignored - settings
      // take effect on the next page load, which is the definition of "next session".
      const settingsLimits = limitsFromSettings(settings);

      // Read the session locale BEFORE hydrate/build so it is passed into opts
      // (#1562). The locale is read once and captured; a mid-session switch takes
      // effect on the next page load (same as card-type toggles).
      const sessionLocale = (settings.activePokemonNameLocale ?? "en") as AppLocale;
      const sessionLearningLocales = (settings.learningLocales as AppLocale[] | undefined) ?? ["en"];

      if (saved !== null) {
        // Merge any seed cards added since the last save, and heal any invalid
        // FSRS states written by older app versions (#1506).
        const { cards: hydrated, anyHealed } = hydrateSession(
          saved.cards,
          seedPokemon,
          seedEvolutionCards,
          now,
          {
            reverseEnabled: enabled,
            nameEnabled,
            evolutionEnabled,
            reverseEvolutionEnabled: reverseEvolutionEnabledLocal,
            cryEnabled,
            locale: sessionLocale,
          },
        );
        sessionLimits = settingsLimits;
        if (hydrated.length !== saved.cards.length || anyHealed) {
          // MULTI-LOCALE: save the full array, never the filtered view.
          notifySaveResult(await saveSession({ cards: hydrated, limits: sessionLimits }));
        }
        sessionCards = hydrated;
      } else {
        const fresh = buildSession(seedPokemon, seedEvolutionCards, now, {
          reverseEnabled: enabled,
          nameEnabled,
          evolutionEnabled,
          reverseEvolutionEnabled: reverseEvolutionEnabledLocal,
          cryEnabled,
          locale: sessionLocale,
        });
        // MULTI-LOCALE: save the full array, never the filtered view.
        notifySaveResult(await saveSession({ cards: fresh, limits: settingsLimits }));
        sessionCards = fresh;
        sessionLimits = settingsLimits;
      }

      // Stamp a concrete stepStartedAt for any in-learning card still missing one.
      // Sessions saved before this field was tracked have stepStartedAt: null for
      // learning cards. Persisting the stamp here ensures subsequent reloads compute
      // the countdown from the same fixed anchor instead of a fresh window each time.
      const stampNow = Date.now();
      let stampedAny = false;
      sessionCards = sessionCards.map((c) => {
        if (c.state.learningStep !== null && c.state.stepStartedAt === null) {
          stampedAny = true;
          return { ...c, state: { ...c.state, stepStartedAt: stampNow } };
        }
        return c;
      });
      if (stampedAny) {
        // MULTI-LOCALE: save the full array, never the filtered view.
        notifySaveResult(await saveSession({ cards: sessionCards, limits: sessionLimits }));
      }

      // --- Scope load + snooze reconciliation (#333) -------------------------
      // Scope now persists in user settings (synced cross-device). Reconcile
      // each card's hiddenSince/dueDate against the current scope before the
      // queue builder sees it; persist any state changes (set/clear of
      // hiddenSince and any forward-shift of dueDate on un-hide).
      const persistedScope = settings.practiceScope;
      const formsEnabled = settings.alternateFormsEnabled;
      const today = todayString(now);
      // Three-tier eligibility: card-type-enabled gate, then
      // `alternateFormsEnabled` gate, then scope filter (#658, #835).
      // Context for the "Incomplete evolution chains" preset (#995): derive
      // chain progress from the freshly-built/hydrated card set. The
      // `scopeContext` memo cannot be used here - it depends on `cards` state
      // which has not been set yet at this point in the load effect.
      // Computed before reconcileHiddenState so the same context is passed to
      // both - avoids a second pass over all cards and ensures reconciliation
      // uses the correct in-progress set when the scope is "incomplete-chains".
      // Derive mastery-blocking species at load time using the freshly-built
      // card set (same pattern as incompleteChainSpeciesIds above). Under
      // pretendAllMastered nothing is blocked so the set is empty.
      const loadMasteryBlockingSpeciesIds = superuserFlags.pretendAllMastered
        ? new Set<number>()
        : new Set(
            [...computeSpeciesLegStatuses(sessionCards, settings.pokemonNameLocale ?? "en", false).values()]
              .filter((s) => s.isBlocked)
              .map((s) => s.speciesId),
          );
      const loadScopeContext: ScopeMatchContext = {
        incompleteChainSpeciesIds: incompleteChainSpeciesIds(
          sessionCards,
          superuserFlags.pretendAllMastered,
        ),
        masteryBlockingSpeciesIds: loadMasteryBlockingSpeciesIds,
      };
      const { changed: reconcileChanged } = reconcileHiddenState(sessionCards, persistedScope, today, loadScopeContext);
      const eligibleIds = computeEligibleCardIds(
        sessionCards,
        {
          evolutionCardsEnabled: evolutionEnabled,
          reverseEvolutionCardsEnabled: reverseEvolutionEnabledLocal,
          cryCardsEnabled: cryEnabled,
          alternateFormsEnabled: formsEnabled,
          practiceScope: persistedScope,
        },
        loadScopeContext,
      );
      // Only persist when reconcileHiddenState actually mutated card state
      // (stamped or cleared hiddenSince, shifted dueDate). Skipping the save
      // when nothing changed avoids a redundant ~600 KB IDB write on every
      // page load - the main cause of hydration slowness after #1234 doubled
      // the card count to ~2 050 (#1262).
      if (reconcileChanged) {
        // MULTI-LOCALE: save the full array, never the filtered view.
        notifySaveResult(await saveSession({ cards: sessionCards, limits: sessionLimits }));
      }

      // MULTI-LOCALE: store the complete session in the ref, then expose only
      // the active-locale filtered view to React state. All downstream renders
      // (cardMap, currentCard, buildSessionQueues) operate on the filtered set,
      // keeping id-keyed lookups collision-free. Every saveSession call reads
      // fullSessionRef.current so the other locale's progress is never lost.
      fullSessionRef.current = sessionCards;
      setCards(sessionCards.filter((c) => (c.locale ?? "en") === sessionLocale));

      setLimits(sessionLimits);
      setReverseEvolutionEnabled(reverseEvolutionEnabledLocal);
      setEvolutionCardsEnabled(evolutionEnabled);
      setCryCardsEnabled(cryEnabled);
      setAlternateFormsEnabled(formsEnabled);
      setCardTypesAllOn(
        reverseEvolutionEnabledLocal && formsEnabled,
      );
      setScope(persistedScope);
      setEligibleCardIds(eligibleIds);
      setTimezone(settings.timezone ?? "UTC");
      // Capture the active locale and enrolled locales once at mount.
      setActiveLocale(sessionLocale);
      setLearningLocales(sessionLearningLocales);
      setVerifiedTypedEntryMode(settings.verifiedTypedEntryMode ?? false);
      setMcCardOnboardingShown(settings.mcCardOnboardingShown ?? false);
      setFirstVisitDone(settings.onboarding?.firstVisitOnboardingDismissed === true);
      // Scope-nudge gate signals (#1482). Read from persisted settings.
      setScopeEverOpened(settings.onboarding?.scopeEverOpened === true);
      setPracticeSessionsCount(settings.onboarding?.practiceSessionsCount ?? 0);
      // Offline-download nudge gate signals (#1538).
      setSlowSpriteLoadCount(settings.onboarding?.slowSpriteLoadCount ?? 0);
      // Check whether a download already exists - if so, suppress the nudge.
      // The typeof + optional-chain guards cover SSR and test environments
      // where window.localStorage may be undefined.
      const hasDownload = typeof window !== "undefined"
        && window.localStorage != null
        && window.localStorage.getItem(KEY_OFFLINE_DOWNLOADED_AT) !== null;
      setOfflineDownloaded(hasDownload);

      // Hydrate the daily summary so the "Share today" button survives a page
      // reload, a navigation away and back, or reopening the app later in the
      // day (#685, #896). Prefer the persisted daily-summary record - it also
      // carries the new-card and mastered counts. When that record is absent
      // (e.g. its best-effort write hit a quota error, or the user finished
      // their cards in an earlier browsing session), fall back to the grade
      // log, which is the durable append-only record of every grade. The grade
      // log lacks new/mastered counts, so those stay at their defaults of 0 in
      // the fallback path; the grade grid and reviewed total still reconstruct.
      const storedSummary = loadDailySummary(settings.timezone ?? "UTC");
      if (storedSummary !== null) {
        setSessionGradeSeq(storedSummary.gradeSequence);
        setNewCardsThisSession(storedSummary.newCards);
        setMasteredThisSession(storedSummary.mastered);
      } else if (!superuserGuarded) {
        // Grade-log entries are stamped with the user's-timezone day (see
        // handleGrade, #1853), so reconstruct against the same boundary.
        // Skipped while a superuser flag is on, mirroring the saveDailySummary
        // write-guard: a QA session must not drive the Share affordance.
        const gradeLog = await loadGradeLog();
        const todaysGrades = todayGradeSequence(
          gradeLog,
          todayString(now, settings.timezone ?? "UTC"),
        );
        if (todaysGrades.length > 0) {
          setSessionGradeSeq(todaysGrades);
        }
      }

      // Initialize the learning queue from persisted learning-step cards.
      // Use stepStartedAt from persisted state so the countdown resumes correctly
      // after navigation instead of resetting to the full step duration.
      const { learningCardIds } = buildSessionQueues(sessionCards, sessionLimits, today, undefined, shuffleSalt, (settings.activePokemonNameLocale ?? "en") as AppLocale);

      const initialLearning: LearningQueueEntry[] = learningCardIds.map((cardId) => {
        const card = sessionCards.find((c) => c.id === cardId)!;
        const stepMs = stepDurationMs(
          card.state.lastReview,
          card.state.learningStep ?? 0,
          card.state.difficulty,
        );
        const stepStartedAt = card.state.stepStartedAt ?? Date.now();
        return { cardId, dueAt: stepStartedAt + stepMs };
      });

      setLearningQueue(initialLearning);

      // Populate the per-locale mastered-count cache on mount so
      // `useProfileStatus` returns an accurate count even before the first
      // grade in this session (#1489). Skipped while superuser-guarded so QA
      // sessions don't pollute local state.
      if (!superuserGuarded) {
        writeMasteredCountCache(
          sessionCards,
          (settings.activePokemonNameLocale ?? "en") as AppLocale,
        );
        writeDueCountCacheFromCards(sessionCards, today);
      }
    }
    void load();
  // notifySaveResult is stable (useCallback with no deps). seedData gates the
  // effect - re-runs when the seed first resolves (null → SeedData) so the
  // session builds immediately after the async fetch completes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedData, notifySaveResult]);

  // Reload on settings changes (cross-tab), same-tab locale switch, and cloud
  // pull events. Extracted to useSessionReloadListeners (#1520).
  useSessionReloadListeners(activeLocale);

  // Publish a "review session active" flag while this component is mounted so
  // background side-effects can avoid yanking state mid-card (#1162 / #1163).
  // Consumers: `useVisibilityPull` skips its visibility-triggered pull, and
  // `ServiceWorkerProvider`'s silent activator defers the SKIP_WAITING dispatch
  // to the next quiet visibilitychange tick.
  useEffect(() => {
    markSessionActive();
    return () => {
      markSessionInactive();
      // Clear the card-revealed flag on unmount so LanguageSwitcher
      // does not stay locked after navigation (#1562).
      markCardRevealed(false);
    };
  }, []);

  // Schedule a timeout to re-render when the earliest pending learning card is due.
  // Extracted to useLearningQueueTimer (#1520).
  useLearningQueueTimer(
    learningQueue,
    useCallback(() => setLearningQueue((q) => [...q]), []),
  );

  // Auto-play the cry when a cry card first becomes the current card.
  // Drives the "audio as prompt" loop without requiring a tap. Skipped
  // on already-revealed cards (the cry plays separately via handleReveal).
  useEffect(() => {
    // Resolve the would-be current card by re-running the queue logic in
    // the effect; doing it here (above the early returns) keeps the hook
    // unconditional. If anything is null or the card isn't a cry, exit.
    if (cards === null) return;
    if (revealed) return;
    if (!cards.length) return;
    // Mirror the priority used downstream: locked > learning > review > new.
    let cardId: number | null = revealedCardId.current;
    if (cardId === null) {
      // Re-evaluate cheaply: just look for an in-step or due card.
      const found = cards.find(
        (c) =>
          c.cardType === "cry" &&
          (c.state.learningStep !== null ||
            (c.state.lastReview !== null && c.state.dueDate <= todayString(new Date()) && c.state.lastReview !== todayString(new Date())) ||
            c.state.lastReview === null),
      );
      cardId = found?.id ?? null;
    }
    if (cardId === null) return;
    const card = cards.find((c) => c.id === cardId);
    if (!card || card.cardType !== "cry") return;
    playCry(card.cryUrl ?? null);
    // Re-fire only when the underlying card id changes (next cry card up).
  }, [cards, revealed]);

  // Cmd/Ctrl+Z triggers undo while an undo snapshot is live. Listener is
  // attached unconditionally so the hook order stays stable across early
  // returns; the body short-circuits when there is nothing to undo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (undoSnapshotRef.current === null || grading) return;
      if (
        (e.key === "z" || e.key === "Z") &&
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey
      ) {
        e.preventDefault();
        // Inline async undo: mirrors handleUndo below. The keyboard handler
        // cannot be async itself, so we call void on an immediately-invoked
        // async arrow that awaits saveSession and removeGradeEntry.
        void (async () => {
          const snapshot = undoSnapshotRef.current;
          if (snapshot === null) return;
          setCards(snapshot.cards);
          setSessionGrades(snapshot.sessionGrades);
          setSessionGradeSeq(snapshot.sessionGradeSeq);
          setSessionDirectionGrades(snapshot.sessionDirectionGrades);
          setNewCardsThisSession(snapshot.newCardsThisSession);
          setMasteredThisSession(snapshot.masteredThisSession);
          setLearningQueue(snapshot.learningQueue);
          // MULTI-LOCALE: save the full array, never the filtered view.
          fullSessionRef.current = snapshot.fullCards;
          notifySaveResult(await saveSession({ cards: snapshot.fullCards, limits }));
          if (snapshot.gradeLogOccurredAt !== null) {
            await removeGradeEntry(snapshot.gradeLogOccurredAt);
          }
          // Roll back persisted daily summary to match reverted state (#685).
          // Skipped while a superuser flag is on so QA grade sequences never
          // reach localStorage - consistent with the cloud write-guard.
          if (!superuserGuarded) {
            const kbSeq = snapshot.sessionGradeSeq;
            saveDailySummary({
              date: todayString(new Date(), timezone),
              gradeSequence: kbSeq,
              reviewed: kbSeq.length,
              newCards: snapshot.newCardsThisSession,
              mastered: snapshot.masteredThisSession,
            });
          }
          setDisplayedCardId(snapshot.cardId);
          revealedCardId.current = snapshot.cardId;
          setRevealed(true);
          // Undo re-reveals the card, so set the flag accordingly (#1562).
          markCardRevealed(true);
          // Bump presentation counter so SpritePicker remounts with fresh
          // shuffle if the user re-grades this reverse card (#496).
          setCardPresentationCount((n) => n + 1);
          undoSnapshotRef.current = null;
          setHasUndoSnap(false);
        })();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // notifySaveResult and limits are stable inside the same render;
    // timezone starts as "UTC" and is set once on mount, so including it
    // causes exactly one extra registration (UTC → real tz) and is otherwise
    // stable - the dep is needed so the persist call sees the real timezone.
    // undoSnapshotRef is a stable ref object - its identity never changes, so
    // it is intentionally omitted from deps. The closure reads .current at
    // call time, which is always the latest snapshot.
    // superuserGuarded is included so the undo handler always reads the
    // current guard value: the superuser chord fires on the Practice page,
    // and flags also sync cross-tab via the storage listener, so the guard
    // can change while ReviewSession stays mounted (#1854 F54).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grading, limits, timezone, superuserGuarded]);

  // Update stable callback refs every render so the keyboard handler below
  // always dispatches to the latest handleReveal / handleGrade without needing
  // to re-register the listener on every render.
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  handleRevealRef.current = handleReveal;
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  handleGradeRef.current = handleGrade;

  // Swipe-to-grade: active only after the card is revealed and not mid-grade.
  // The hook attaches pointer listeners to `cardRef` which wraps the card
  // display for flip-card types (name / evolution / cry). `handleGrade` is
  // accessed via a stable ref (handleGradeRef) inside useSwipeGrade so the
  // listener never captures stale closures.
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  const { swipeState } = useSwipeGrade({
    targetRef: cardRef,
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    onGrade: handleGrade,
    enabled: revealed,
    grading,
  });

  // Space/Enter → reveal; 1/2/4/5 → grade; ? → open shortcut overlay.
  // Deps: only the state values used as guards inside the handler (`revealed`,
  // `grading`, `revealing`). handleReveal / handleGrade are accessed via stable
  // refs (updated every render above) so adding them here would cause a new
  // listener registration on every render without any benefit.
  useEffect(() => {
    function isTextInputFocused(): boolean {
      const el = document.activeElement;
      if (!el) return false;
      const tag = (el as HTMLElement).tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    }

    function onKey(e: KeyboardEvent) {
      // Never fire while a text field is focused (superuser chord, sign-in
      // fields, search boxes, etc.).
      if (isTextInputFocused()) return;

      // Never fire grade keys while the language-switcher panel is open
      // so keystrokes don't fire through it (#1562). The keyboard-shortcuts
      // overlay is handled separately (Escape closes it above).
      if (document.querySelector('[aria-labelledby="language-switcher-heading"]') !== null) return;

      // Escape closes the shortcut overlay.
      if (e.key === "Escape") {
        setShowKeyboardShortcuts(false);
        return;
      }

      // ? opens the shortcut overlay (Shift+/ on US-ANSI). Guard against
      // modifier combos that use ? (e.g. Shift+? still fires "?" as e.key).
      if (e.key === "?") {
        e.preventDefault();
        setShowKeyboardShortcuts(true);
        return;
      }

      // Space / Enter → reveal the current card (only when not yet revealed).
      if ((e.key === " " || e.key === "Enter") && !revealed && !revealing) {
        // Prevent the default scroll-on-space behaviour.
        e.preventDefault();
        void handleRevealRef.current();
        return;
      }

      // 1/2/4/5 → grade Again/Hard/Good/Easy. Only active after reveal and
      // while not mid-grade. Also accept 3 as an alias for 4 (Good) to support
      // the common 1/2/3/4 muscle memory from other SRS apps.
      if (revealed && !grading) {
        const GRADE_MAP: Record<string, Grade> = {
          "1": 1,
          "2": 2,
          "3": 4,
          "4": 4,
          "5": 5,
        };
        const grade = GRADE_MAP[e.key];
        if (grade !== undefined) {
          e.preventDefault();
          // Fire haptic on keyboard-driven grades. The iOS switch technique
          // is omitted here (null) - keyboard users are on desktop and the
          // Vibration API path covers Android/Chromium where it applies.
          triggerHaptic(grade, null);
          void handleGradeRef.current(grade);
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleReveal / handleGrade are accessed via stable refs (updated every
    // render above) so they do not belong in deps. Only the state values used
    // as guards inside the handler - `revealed`, `grading`, `revealing` - need
    // to be listed so the listener is re-registered when those values change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, grading, revealing]);

  // Auto-pin the display lock when a card is on screen and the lock has not
  // been claimed by a handler (#839). The lock pins the currently-displayed
  // card across re-renders so a learning card whose dueAt passes mid-render
  // cannot displace it. The effect recomputes currentCardId from the same
  // inputs the render block uses and assigns it to displayedCardId when the
  // lock is null; releases the lock when the session has no current card.
  // Skipped while cards has not loaded yet.
  useEffect(() => {
    if (cards === null) return;
    const today = todayString(new Date());
    const effLimits: DailyLimits = extendedReview
      ? {
          name: { ...limits.name, maxReviewsPerDay: Number.POSITIVE_INFINITY },
          evolution: { ...limits.evolution, maxReviewsPerDay: Number.POSITIVE_INFINITY },
          reverse: { ...limits.reverse, maxReviewsPerDay: Number.POSITIVE_INFINITY },
          cry: { ...limits.cry, maxReviewsPerDay: Number.POSITIVE_INFINITY },
        }
      : limits;
    const { reviewQueue: rQ, newQueue: nQ } = buildSessionQueues(
      cards,
      effLimits,
      today,
      eligibleCardIds,
      shuffleSalt,
      activeLocale,
    );
    const nowMs = Date.now();
    const dueLearningEntries = learningQueue
      .filter((e) => e.dueAt <= nowMs)
      .sort((a, b) => a.dueAt - b.dueAt);
    let currentId: number | null;
    if (dueLearningEntries.length > 0) {
      currentId = dueLearningEntries[0].cardId;
    } else {
      currentId = getNextCardId(rQ, nQ);
      if (currentId === null) {
        const ahead = learningQueue
          .filter((e) => e.dueAt > nowMs && e.dueAt <= nowMs + LEARN_AHEAD_MS)
          .sort((a, b) => a.dueAt - b.dueAt);
        if (ahead.length > 0) currentId = ahead[0].cardId;
      }
    }
    if (currentId !== null && displayedCardId === null) {
      setDisplayedCardId(currentId);
    } else if (currentId === null && displayedCardId !== null) {
      setDisplayedCardId(null);
    }
    // Re-run on any input that affects currentCardId. Deps deliberately list
    // only the React state inputs; recomputing on `displayedCardId` itself
    // would race with the setState call inside this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, learningQueue, eligibleCardIds, limits, extendedReview]);

  // --- Seed error state ---
  // If the async seed fetch failed, surface a retry prompt. This is distinct
  // from the loading skeleton: the skeleton is shown while the seed OR session
  // is loading normally; the error state is only shown after a confirmed failure.
  if (seedError !== null) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-4 text-center"
      >
        <p className="text-lg font-semibold text-foreground">
          {t("seedLoadError")}
        </p>
        <p className={mutedText}>
          {t("seedLoadErrorBody")}
        </p>
        <button
          type="button"
          onClick={seedRetry}
          className="min-h-[44px] rounded-lg bg-theme-accent px-8 py-2 text-sm font-semibold text-theme-fg-on-primary transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2"
        >
          {t("seedLoadRetry")}
        </button>
      </div>
    );
  }

  // --- Loading skeleton (SSR + first client tick + waiting for async seed) ---
  if (cards === null) {
    return (
      <div
        className="flex flex-col items-center gap-6 animate-pulse"
        aria-busy="true"
        aria-label={t("loadingAriaLabel")}
      >
        <div className="rounded-xl bg-zinc-200 dark:bg-zinc-800" style={{ width: PRACTICE_SPRITE_SIZE, height: PRACTICE_SPRITE_SIZE }} />
        <div className="h-10 w-40 rounded-md bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-11 w-32 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </div>
    );
  }

  // Offline-download discovery nudge (#1538). Gate (in priority order):
  //   1. offlineDownloadNudgeDismissed (handled by OnboardingHint itself).
  //   2. offlineDownloaded true   -> suppress (already downloaded; nudge served its purpose).
  //   3. firstVisitDone false     -> suppress (first-visit modal still showing).
  //   4. superuserGuarded true    -> suppress (QA sessions must not fire).
  //   5. Show if: slowSpriteLoadCount >= threshold OR practiceSessionsCount >= threshold.
  const offlineNudge = (
    offlineDownloaded ||
    !firstVisitDone ||
    superuserGuarded ||
    (slowSpriteLoadCount < OFFLINE_NUDGE_SLOW_LOAD_THRESHOLD &&
      practiceSessionsCount < OFFLINE_NUDGE_SESSION_THRESHOLD)
  ) ? null : (
    <div className="mb-3">
      <OnboardingHint
        id="offlineDownloadNudgeDismissed"
        title={t("offlineDownloadNudge.title")}
        ctaHref="/settings#offline-download-heading"
        ctaLabel={t("offlineDownloadNudge.cta")}
      >
        <p>{t("offlineDownloadNudge.body")}</p>
      </OnboardingHint>
    </div>
  );

  // --- All opt-in card types disabled ---
  // Name and reverse are always on since #1234, so this guard covers only
  // the unlikely case where evolution, reverse-evolution, and cry are all off
  // AND the practiceScope has no cards. In practice, name+reverse being always
  // on means the session will always have at least some cards unless the scope
  // explicitly excludes everything (handled below). We keep the guard for
  // correctness but it will only fire for the evolution/cry-only opt-in combos.
  if (
    !evolutionCardsEnabled &&
    !reverseEnabled &&
    !reverseEvolutionEnabled &&
    !cryCardsEnabled
  ) {
    // This branch is unreachable with default settings since reverseEnabled is
    // always true. Kept as a safety net.
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-2xl font-semibold text-foreground">{t("noCardTypesEnabled")}</p>
        <p className="text-zinc-500 dark:text-zinc-400 max-w-xs">
          {t.rich("noCardTypesEnabledBody", {
            link: (chunks) => (
              <a href="/settings" className="underline text-foreground">{chunks}</a>
            ),
          })}
        </p>
      </div>
    );
  }

  // --- Practice scope excludes everything (#333) ---
  // Distinct from "no card types enabled": here a non-empty scope has been
  // applied that matches zero species. Surface a one-tap "Clear scope" CTA
  // rather than showing the generic "all caught up" complete screen.
  if (!isScopeEmpty(scope) && eligibleCardIds.size === 0) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-2xl font-semibold text-foreground">{t("noScopeMatch")}</p>
        <p className="text-zinc-500 dark:text-zinc-400 max-w-xs">
          {t("noScopeMatchBody")}
        </p>
        <button
          type="button"
          onClick={() => handleScopeChange(EMPTY_SCOPE)}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          {t("clearScope")}
        </button>
      </div>
    );
  }

  // --- Derived state (recomputed every render - cheap, pure) ---
  const today = todayString(new Date());

  // While extendedReview is active, uncap all per-type review limits so all
  // due cards are visible. Uncapping new cards is not allowed (per srs-expert
  // policy).
  const effectiveLimits: DailyLimits = extendedReview
    ? {
        name: { ...limits.name, maxReviewsPerDay: Number.POSITIVE_INFINITY },
        evolution: { ...limits.evolution, maxReviewsPerDay: Number.POSITIVE_INFINITY },
        reverse: { ...limits.reverse, maxReviewsPerDay: Number.POSITIVE_INFINITY },
        cry: { ...limits.cry, maxReviewsPerDay: Number.POSITIVE_INFINITY },
      }
    : limits;

  // Practice scope is enforced via the eligibility set passed into the queue
  // builder, not by pre-filtering the cards array. This way the counters
  // (`newIntroducedToday`, `reviewsDoneToday`) still see the full card set - 
  // changing scope mid-day cannot reset daily caps (#333). Out-of-scope cards
  // are snoozed by `reconcileHiddenState` at session-load time, so their
  // dueDate doesn't drift while they're hidden.
  //
  // `eligibleCardIds` also gates out disabled-type cards (#835): saved progress
  // is preserved in storage but excluded from the active queue. We always pass
  // the set (even when scope is empty) so that disabled types are never queued.
  const { reviewQueue, newQueue, perType, learningCardIds, outOfScopeLearningIds } = buildSessionQueues(
    cards,
    effectiveLimits,
    today,
    eligibleCardIds,
    shuffleSalt,
    activeLocale,
  );

  // Cards that are mid-learning-step but fall outside the active scope.
  // Shown to the user as a subtle hint so the behaviour reads as intentional
  // rather than a broken filter. Built inline (not a useMemo) because
  // buildSessionQueues is already called every render.
  const outOfScopeLearningSet = new Set(outOfScopeLearningIds);

  // --- Learning-queue priority (with learn-ahead) ---
  const now = Date.now();
  const dueLearning = learningQueue
    .filter((e) => e.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt);

  let currentLearningEntry = dueLearning.length > 0 ? dueLearning[0] : null;

  // Resolve the current card: learning first, then review/new.
  let currentCardId: number | null;
  if (currentLearningEntry !== null) {
    currentCardId = currentLearningEntry.cardId;
  } else {
    currentCardId = getNextCardId(reviewQueue, newQueue);

    // Learn-ahead: only when there are no other cards to show. Pull the
    // earliest learning card forward if it's within LEARN_AHEAD_MS.
    // This avoids the "wait N minutes" screen when the queue is otherwise
    // empty (matches Anki's default 20-minute learn-ahead behaviour).
    if (currentCardId === null) {
      const ahead = learningQueue
        .filter((e) => e.dueAt > now && e.dueAt <= now + LEARN_AHEAD_MS)
        .sort((a, b) => a.dueAt - b.dueAt);
      if (ahead.length > 0) {
        currentLearningEntry = ahead[0];
        currentCardId = ahead[0].cardId;
      }
    }
  }

  const currentCard =
    currentCardId !== null ? cards.find((c) => c.id === currentCardId) ?? null : null;

  // Maintain the display lock: once a card is on screen, keep it there until
  // the user explicitly advances by grading (#839). The lock is held in the
  // `displayedCardId` state. This render block reads it once and never
  // mutates it - writes happen only in event handlers / effects.
  //
  // Drop the lock when the locked id is no longer scope-eligible (#1088). This
  // is the read-only belt-and-braces guard that pairs with handleScopeChange
  // clearing the lock explicitly: if any future code path mutates
  // eligibleCardIds without remembering to release the lock, we still fall
  // through to the freshly-computed currentCard so the user never sees a
  // frozen out-of-scope card. The check only kicks in when a scope is active - 
  // an empty scope means every card is eligible, so the eligibleCardIds set
  // is intentionally empty and is not consulted (see the
  // `isScopeEmpty(scope)` gate at line 1211).
  const lockedId = displayedCardId;
  const lockHonoured =
    lockedId !== null &&
    (isScopeEmpty(scope) || eligibleCardIds.has(lockedId));

  // Prefer the honoured lock over the freshly computed current card.
  // This prevents a learning card whose dueAt passes mid-render from
  // displacing the card the user is currently looking at.
  const lockedDisplayCard = lockHonoured
    ? (cards.find((c) => c.id === lockedId) ?? null)
    : null;

  // If the user has clicked Reveal, additionally lock that card for the
  // duration of the grading window so the grade buttons act on the right card.
  const lockedRevealCard =
    revealed && revealedCardId.current !== null
      ? (cards.find((c) => c.id === revealedCardId.current) ?? null)
      : null;
  const effectiveCard = lockedRevealCard ?? lockedDisplayCard ?? currentCard;

  // --- Sprite preloading (#705, extended in #708) ---
  // Warm the browser cache for the current card's reveal-face sprite(s) and
  // the sprites of whatever cards are likely to come next, so neither pops
  // in on grade/reveal. The exact next card depends on how grading mutates
  // state, so preload the heads of every queue that could resolve next.
  // Two heads are taken from each queue so that at least one look-ahead
  // survives after the current card's ID is excluded.
  //
  // Computed inline rather than via useMemo on purpose: reviewQueue,
  // newQueue and dueLearning are themselves rebuilt on every render (see
  // buildSessionQueues above), so a useMemo keyed on them would never hit.
  // The cost is a handful of Set ops and O(1) cardMap lookups, and
  // SpritePreloader keys its <Image> children by a composite `${width}:${url}`
  // string, so handing it a fresh array reference each render triggers no refetch.
  //
  // Reverse cards render as a four-tile SpritePicker at 150 px - a different
  // optimiser variant from the 320 px flip cards. They are expanded into
  // `preloadPickerUrls` (passed as `sizedUrls` to SpritePreloader) so the
  // correct variant is warmed. `preloadableSpriteUrls` returns [] for reverse
  // cards deliberately; the expansion here covers that gap.
  const preloadSpriteUrls: string[] = [];
  const preloadPickerUrls: SizedSpriteUrl[] = [];

  (() => {
    const ids = new Set<number>();
    for (const id of reviewQueue.slice(0, 2)) ids.add(id);
    if (newQueue.length > 0) ids.add(newQueue[0]);
    for (const e of dueLearning.slice(0, 2)) ids.add(e.cardId);
    if (effectiveCard !== null) ids.delete(effectiveCard.id);

    // The current card's front face is already on screen; including it here
    // warms its reveal-face sprite (evolution answer / cry sprite).
    if (effectiveCard !== null) {
      preloadSpriteUrls.push(...preloadableSpriteUrls(effectiveCard));
    }

    for (const id of ids) {
      const c = cardMap.get(id);
      if (!c) continue;
      if (c.cardType === "reverse") {
        // Expand the reverse card into its four picker tile sprites at the
        // same size SpritePicker renders them (PICKER_SPRITE_SIZE = 150 px).
        const target = seedById.get(c.pokemonId);
        if (target) {
          const distractors = pickDistractors(c.pokemonId, seedPokemon, 3, String(c.id));
          for (const pokemon of [target, ...distractors]) {
            preloadPickerUrls.push({ src: pokemon.spriteUrl, width: PICKER_SPRITE_SIZE });
          }
        }
      } else {
        preloadSpriteUrls.push(...preloadableSpriteUrls(c));
      }
    }
  })();

  // Per-button interval previews - computed for every render (O(1) per grade, cheap).
  const gradePreviewsOrNull =
    effectiveCard !== null
      ? previewIntervals(effectiveCard.state, new Date(), (() => {
          const s = loadSettings();
          return { retentionTarget: s.retentionTarget, weights: s.fsrsWeights };
        })())
      : null;

  // Queue counters: sourced from buildSessionQueues so newCount and reviewCount
  // reflect the daily-capped queue sizes, matching what actually gets served.
  const newCount = newQueue.length;
  const learningCount = learningCardIds.length;
  const reviewCount = reviewQueue.length;

  // --- Determine end state when there is no current card ---
  function resolveEndState(): EndState {
    // Per-type checks: a wall fires only when *that* type's cap is hit AND
    // *that* type has more candidates. Mixed-type sessions therefore keep
    // serving cards from the type that still has budget; the end-state UI
    // appears only when no type has any work left.
    // Compare by limit bucket, not raw cardType - reverse-evolution cards
    // count under "evolution" so the wall-detection matches the per-type
    // counters in `perType`.
    // Card-type gate for end-state checks: disabled-type cards must never
    // drive the wall. We check card-type enablement directly - not via
    // eligibleCardIds - so that alternate-form and scope filters do not
    // suppress the wall for genuinely-enabled card types (#835).
    const endStateTypeOpts = {
      nameEnabled: true,
      evolutionEnabled: evolutionCardsEnabled,
      reverseEnabled,
      reverseEvolutionEnabled,
      cryEnabled: cryCardsEnabled,
    };

    function hasMoreDueReviewsOf(type: "name" | "evolution" | "reverse" | "cry"): boolean {
      // Mirror the candidate filter in buildSessionQueues - cards in a
      // learning/relearning step are served via the in-memory learning
      // queue, not the review queue, and must not count toward "more due
      // reviews exist" or the soft-wall would fire spuriously.
      // Disabled-type cards must not drive end-state; check card-type enablement
      // directly rather than eligibleCardIds so alternate-form and scope
      // filters do not suppress the wall for enabled card types (#835).
      return cards!.some(
        (c) =>
          cardTypeIsEnabled(c, endStateTypeOpts) &&
          limitBucket(c.cardType) === type &&
          c.state.learningStep === null &&
          c.state.lastReview !== null &&
          c.state.dueDate <= today &&
          c.state.lastReview !== today,
      );
    }
    function hasMoreNewCardsOf(type: "name" | "evolution" | "reverse" | "cry"): boolean {
      // Disabled-type cards must not keep the session in NEW_CARDS_LOCKED
      // after that type is turned off. Check card-type enablement directly
      // rather than eligibleCardIds so alternate-form and scope filters do
      // not suppress the wall for enabled card types (#835).
      return cards!.some(
        (c) =>
          cardTypeIsEnabled(c, endStateTypeOpts) &&
          limitBucket(c.cardType) === type &&
          c.state.lastReview === null &&
          c.state.learningStep === null,
      );
    }

    const reviewWall = (["name", "evolution", "reverse", "cry"] as const).some(
      (type) =>
        perType[type].reviewsDoneToday >= limits[type].maxReviewsPerDay &&
        hasMoreDueReviewsOf(type),
    );
    if (!extendedReview && reviewWall) return "REVIEW_SOFT_WALL";

    const newWall = (["name", "evolution", "reverse", "cry"] as const).some(
      (type) =>
        perType[type].newIntroducedToday >= limits[type].maxNewPerDay &&
        hasMoreNewCardsOf(type),
    );
    if (newWall) return "NEW_CARDS_LOCKED";

    return "SESSION_COMPLETE";
  }

  if (effectiveCard === null) {
    // If there are pending (future-due) learning cards beyond the learn-ahead
    // window, show the countdown. Cards within LEARN_AHEAD_MS are already
    // served via currentLearningEntry above and won't reach this branch.
    if (learningQueue.length > 0) {
      const futureLearning = learningQueue.filter((e) => e.dueAt > now);
      if (futureLearning.length > 0) {
        const earliestDueAt = Math.min(...futureLearning.map((e) => e.dueAt));
        return (
          <ReviewCardLayout
            variant="countdown"
            queueCounts={{ newCount, learningCount, reviewCount }}
            hasUndoSnapshot={hasUndoSnap}
            onUndo={handleUndo}
            showOutOfScopeHint={false}
            cardRegion={
              <CountdownScreen
                dueAt={earliestDueAt}
                perType={perType}
                nameEnabled={true}
                evolutionEnabled={evolutionCardsEnabled}
                reverseEnabled={reverseEnabled}
                reverseEvolutionEnabled={reverseEvolutionEnabled}
                cryEnabled={cryCardsEnabled}
              />
            }
          />
        );
      }
      // futureLearning is empty: all entries are overdue. Overdue entries
      // populate dueLearning → currentLearningEntry → a non-null effectiveCard,
      // so reaching this branch with effectiveCard === null is unreachable.
      // Fall through to resolveEndState() safely.
    }

    const endState = resolveEndState();

    // today is UTC (scheduler-internal - card dues, streak); tomorrow uses the
    // user's timezone (state var loaded from settings) because it is a calendar
    // label for a user-facing count. Derive tomorrow from the tz-aware calendar
    // date rather than adding 86 400 s, which is wrong on DST-change nights.
    // Hoisted so every end-of-session variant (#926) can show the teaser and
    // share button, not just SESSION_COMPLETE.
    const today = todayString(new Date());
    const todayTz = todayString(new Date(), timezone);
    // Use addDaysToIsoDate so tomorrow is derived the same way as other callers
    // in lib/stats - replaces the inline setUTCDate arithmetic (#1522).
    const tomorrow = addDaysToIsoDate(todayTz, 1);
    const dueTomorrow = countDueTomorrow(cards, tomorrow, eligibleCardIds, activeLocale);
    // shareParts / shareText are derived unconditionally by useShareSheet above
    // (hooks must be called before early returns). They are used here in the
    // end-of-session branch (#1520).
    const variant: EndOfSessionVariant =
      endState === "REVIEW_SOFT_WALL"
        ? { kind: "review-wall", onKeepReviewing: () => setExtendedReview(true) }
        : endState === "NEW_CARDS_LOCKED"
          ? { kind: "new-locked" }
          : { kind: "complete" };
    // Switching locale writes activePokemonNameLocale to settings, which fires
    // SETTINGS_SAVED_EVENT; the same-tab handler above reloads when the active
    // locale changed, rebuilding the session for the new language (#1562).
    function handleSwitchLocale(next: AppLocale) {
      const current = loadSettings();
      saveSettings({ ...current, activePokemonNameLocale: next });
    }

    return (
      <div className="flex flex-col flex-1 min-h-0 w-full items-center overflow-y-auto">
        {/* When a scope filter is active, show ScopeControl so the user can
            see what filter is set and modify or clear it. This mirrors the
            card-practice path where ScopeControl is always visible (#1797). */}
        {!isScopeEmpty(scope) && (
          <div className="w-full max-w-xl px-4 pt-4">
            <ScopeControl
              scope={scope}
              onChange={handleScopeChange}
              alternateFormsEnabled={alternateFormsEnabled}
              incompleteChainSpeciesIds={incompleteChains}
              masteryBlockingSpeciesIds={masteryBlockingSpeciesIds}
            />
          </div>
        )}
        <EndOfSessionScreen
          variant={variant}
          perType={perType}
          nameEnabled={true}
          evolutionEnabled={evolutionCardsEnabled}
          reverseEnabled={reverseEnabled}
          reverseEvolutionEnabled={reverseEvolutionEnabled}
          cryEnabled={cryCardsEnabled}
          shareText={shareText}
          shareParts={shareParts}
          dueTomorrow={dueTomorrow}
          showCardTypesHint={!cardTypesAllOn}
          directionGrades={sessionDirectionGrades}
          activeLocale={activeLocale}
          learningLocales={learningLocales}
          dueCountByLocale={readDueCountCache()}
          onSwitchLocale={handleSwitchLocale}
          onClearScope={!isScopeEmpty(scope) ? () => handleScopeChange(EMPTY_SCOPE) : undefined}
        />
        {seenPokemon.length >= 2 && (
          <HigherOrLowerGame seenPokemon={seenPokemon} />
        )}
        {badgeToastSlot}
      </div>
    );
  }

  // --- Handlers ---

  async function handleReveal() {
    // Use effectiveCard rather than currentCard so the reveal always acts on
    // the card currently displayed (#839). After a learning-queue re-render,
    // currentCard may have shifted to a newly-due learning card while the
    // displayedCardId lock keeps effectiveCard pointing to the original card.
    if (effectiveCard === null || revealing) return;

    // Warm up speechSynthesis synchronously inside the gesture handler. This
    // must run before any `await` - after the first await the browser's gesture
    // context is lost and warmupTts() would not count for Chromium / WebKit,
    // causing speakNameOnReveal to silently fail on the very first Reveal of a
    // session (before any card has been graded via handleGrade). Mirror of the
    // same call in handleGrade (#479).
    warmupTts();

    if (effectiveCard.cardType === "name") {
      const facts = getPokemonFacts(effectiveCard);
      setCurrentFact(selectFact(facts));
    } else if (effectiveCard.cardType === "evolution") {
      const evoPokemon = seedPokemon.find((p) => p.id === effectiveCard.postEvoId);
      if (evoPokemon) {
        setCurrentFact(selectFact(getPokemonFacts(evoPokemon)));
      } else {
        console.warn(`[handleReveal] seed data missing for evolution target: ${effectiveCard.postEvoName}`);
        setCurrentFact(null);
      }
    } else if (effectiveCard.cardType === "reverse-evolution") {
      // Reverse direction: the answer is the pre-evo, so surface its facts.
      const preEvo = seedPokemon.find((p) => p.id === effectiveCard.preEvoId);
      if (preEvo) {
        setCurrentFact(selectFact(getPokemonFacts(preEvo)));
      } else {
        console.warn(`[handleReveal] seed data missing for reverse-evolution source: ${effectiveCard.preEvoName}`);
        setCurrentFact(null);
      }
    } else {
      setCurrentFact(null);
    }

    // Decode-ahead: for evolution and reverse-evolution cards, the reveal flip
    // shows a sprite that `SpritePreloader` has already warmed into the network
    // cache but that the browser has not yet decoded into a GPU bitmap. Decoding
    // before `setRevealed(true)` eliminates the pop-in that would otherwise be
    // visible while the browser decodes on the render thread (#930).
    //
    // evolution:         hiddenSide="post" → reveal shows postEvoSpriteUrl
    // reverse-evolution: hiddenSide="pre"  → reveal shows preEvoSpriteUrl
    //
    // Audio (cry + TTS) is triggered below, after `setRevealed`, so this await
    // does not delay or reorder audio - it only defers the state swap briefly.
    // The 500 ms safety valve in `decodeSpriteUrls` ensures the UI is never
    // stuck even on a slow or absent decode path (e.g. test environments).
    if (
      effectiveCard.cardType === "evolution" ||
      effectiveCard.cardType === "reverse-evolution"
    ) {
      const revealUrl =
        effectiveCard.cardType === "evolution"
          ? effectiveCard.postEvoSpriteUrl
          : effectiveCard.preEvoSpriteUrl;
      setRevealing(true);
      try {
        await decodeSpriteUrls([revealUrl]);
      } finally {
        setRevealing(false);
      }
    }

    // Guard against running side-effects after the component has unmounted
    // (e.g. the user navigated away while the decode-ahead was in flight).
    // Symmetrical to the guard in handleGrade (~line 1598). The `finally`
    // above already cleared `revealing`, so we can safely return here.
    if (!isMountedRef.current) return;

    setRevealed(true);
    // Set the card-revealed flag so LanguageSwitcher blocks locale switches (#1562).
    markCardRevealed(true);
    revealedCardId.current = effectiveCard.id;
    const revealSettings = loadSettings();
    const cryOn = revealSettings.playCryOnReveal;
    const speakOn = revealSettings.speakNameOnReveal;

    // Pick the name to speak per direction (cry cards: speak the answer name; reverse
    // picker cards never reach handleReveal so they're absent here).
    let nameToSpeak: string | null = null;
    let idToSpeak: number | null = null;
    if (effectiveCard.cardType === "name") { nameToSpeak = effectiveCard.name; idToSpeak = effectiveCard.id; }
    else if (effectiveCard.cardType === "evolution") { nameToSpeak = effectiveCard.postEvoName; idToSpeak = effectiveCard.postEvoId; }
    else if (effectiveCard.cardType === "reverse-evolution") { nameToSpeak = effectiveCard.preEvoName; idToSpeak = effectiveCard.preEvoId; }
    else if (effectiveCard.cardType === "cry") { nameToSpeak = effectiveCard.name; idToSpeak = effectiveCard.pokemonId; }

    // Pick the cry URL per direction. Cry cards: the cry was the prompt, so don't
    // replay it on reveal.
    let cryUrlOnReveal: string | null = null;
    if (cryOn) {
      if (effectiveCard.cardType === "name") cryUrlOnReveal = effectiveCard.cryUrl ?? null;
      else if (effectiveCard.cardType === "evolution") {
        const target = seedPokemon.find((p) => p.id === effectiveCard.postEvoId);
        cryUrlOnReveal = target?.cryUrl ?? null;
      } else if (effectiveCard.cardType === "reverse-evolution") {
        const target = seedPokemon.find((p) => p.id === effectiveCard.preEvoId);
        cryUrlOnReveal = target?.cryUrl ?? null;
      }
    }

    const speakAfterCry =
      speakOn && nameToSpeak !== null ? () => speakName(nameToSpeak!, idToSpeak) : undefined;

    // Branch on whether a cry will play. If yes, chain TTS to fire after `ended`.
    // If no cry (toggle off or no url), fall through to TTS directly so they don't
    // both fire on the same tick.
    if (cryOn && (effectiveCard.cardType === "name" || effectiveCard.cardType === "evolution" || effectiveCard.cardType === "reverse-evolution")) {
      playCry(cryUrlOnReveal, 0.6, speakAfterCry);
    } else if (speakOn && nameToSpeak !== null) {
      speakName(nameToSpeak, idToSpeak);
    }
  }

  /**
   * Called when a grade-path `decodeSpriteUrls` call times out on the 150 ms
   * ceiling (#1538). Increments the `slowSpriteLoadCount` counter so the
   * offline-download nudge can surface after repeated slow loads. Skipped under
   * superuser so QA sessions do not inflate the counter.
   *
   * Cross-layer note: this updates `lib/settings/persistence.ts` state from
   * inside `ReviewSession`. The nudge trigger is directly tied to the grading
   * critical path (the exact point the user feels the slowness), making
   * `ReviewSession` the right call site per AGENTS.md "Cross-layer fixes".
   */
  function handleSlowSpriteLoad() {
    if (superuserGuarded) return;
    const settingsForSlowLoad = loadSettings();
    const current = settingsForSlowLoad.onboarding?.slowSpriteLoadCount ?? 0;
    // Cap at the nudge threshold to avoid unbounded loadSettings/saveSettings
    // calls on the grade critical path on persistently slow networks.
    if (current >= OFFLINE_NUDGE_SLOW_LOAD_THRESHOLD) return;
    const next = current + 1;
    saveSettings({
      ...settingsForSlowLoad,
      onboarding: { ...settingsForSlowLoad.onboarding, slowSpriteLoadCount: next },
    });
    setSlowSpriteLoadCount(next);
  }

  async function handleGrade(grade: Grade) {
    if (effectiveCard === null || grading) return;
    // Re-narrow cards inside the closure - TS doesn't carry the outer
    // null-check through a function that captures a useState variable.
    if (cards === null) return;

    // Increment the practice-sessions counter once per browser session (#1482).
    // Guarded by sessionStorage so a page reload or navigation within the same
    // tab does not double-count. Skipped under superuser so QA sessions do not
    // inflate the counter. The scope nudge gate checks practiceSessionsCount in
    // component state; update both localStorage and local state so the nudge
    // can appear within the same session once the threshold is crossed.
    if (!superuserGuarded && !sessionStorage.getItem(SCOPE_NUDGE_SESSION_KEY)) {
      sessionStorage.setItem(SCOPE_NUDGE_SESSION_KEY, "1");
      const settingsForCount = loadSettings();
      const newCount = (settingsForCount.onboarding?.practiceSessionsCount ?? 0) + 1;
      saveSettings({
        ...settingsForCount,
        onboarding: { ...settingsForCount.onboarding, practiceSessionsCount: newCount },
      });
      setPracticeSessionsCount(newCount);
    }

    // Warm up speechSynthesis on the first grade gesture. This satisfies the
    // browser's autoplay policy (Chromium / WebKit) so that speakNameOnReveal
    // fires on the very next card without requiring the user to manually tap
    // the speaker icon first. Must run synchronously here - after any `await`
    // the gesture context is lost and the warm-up would not count (#479).
    warmupTts();

    setGrading(true);

    // Snapshot the pre-grade state for single-step undo. The previous
    // snapshot (if any) is replaced - undo is one-deep, not a stack.
    const snapshot: UndoSnapshot = {
      cards,                           // locale-filtered view for setCards restore
      fullCards: fullSessionRef.current, // full array for saveSession
      sessionGrades,
      sessionGradeSeq,
      sessionDirectionGrades,
      newCardsThisSession,
      masteredThisSession,
      learningQueue,
      cardId: effectiveCard.id,
      gradeLogOccurredAt: null,
    };

    const now = new Date();
    const settings = loadSettings();
    let nextState: ReturnType<typeof nextReview>;
    try {
      nextState = nextReview(effectiveCard.state, grade, now, {
        retentionTarget: settings.retentionTarget,
        weights: settings.fsrsWeights,
      });
    } catch (err) {
      // nextReview throws a RangeError for invalid grades (e.g. corrupt
      // payload or future grade-log replay). Log, surface a non-fatal banner,
      // and unlock the session so the user can continue.
      console.error("[handleGrade] nextReview threw - skipping corrupt grade:", err);
      setGrading(false);
      setGradeError(t("gradeErrorMessage"));
      return;
    }
    // newCards = locale-filtered view with the graded card updated.
    const newCards = cards.map((card) =>
      card.id === effectiveCard.id ? { ...card, state: nextState } : card,
    );

    // MULTI-LOCALE: merge the updated card back into the full session by
    // (id, locale) key so the other locale's progress is never lost.
    // The graded card's locale is read from effectiveCard (stamped at load time).
    const gradedLocale = effectiveCard.locale ?? "en";
    const newFullCards = fullSessionRef.current.map((card) =>
      card.id === effectiveCard.id && (card.locale ?? "en") === gradedLocale
        ? { ...card, state: nextState }
        : card,
    );
    fullSessionRef.current = newFullCards;

    const today = todayString(now);
    // User-facing day stamp for the streak and the grade log (#1853). `today`
    // stays UTC for scheduling comparisons (dueDate / lastReview); the streak
    // and grade-log day must instead match the readers, which all anchor on
    // the user's timezone (StreakBadge, useStreakNavState, the Stats history
    // charts) - the same domain saveDailySummary below already uses.
    const localToday = todayString(now, timezone);

    // Derive new/mastered transitions now (while effectiveCard / nextState are
    // in scope) so the values are available for the visible swap below and for
    // the background persistence chain. Reuse `settings` already loaded at
    // the top of this handler (#1191).
    const wasNew = effectiveCard.state.firstSeen === null;
    const wasMastered = isMastered(effectiveCard.state);
    const nowMastered = isMastered(nextState);
    // Species-level mastery crossing: BOTH name + reverse must cross the gate.
    // Used for the share card "Mastered" count and the daily summary (#1448).
    const speciesJustMastered = speciesBecameMastered(
      effectiveCard,
      effectiveCard.state,
      newCards,
    );

    // Decode-ahead: fetch and decode the next card's sprite(s) before advancing
    // React state. `SpritePreloader` has already warmed the network cache - 
    // this call bridges the fetch→decode gap so the bitmap is GPU-ready by the
    // time the next <Image> mounts, eliminating the residual pop-in (#719).
    //
    // We peek at the post-grade queues (using `newCards`, which already reflects
    // the graded card's updated state, and `nextLearningQueue`, the post-grade
    // learning queue computed below) to find what card will be shown next.
    // `buildSessionQueues` is O(n) in the card list but is already called on
    // every render - one extra call here is negligible. The effective limits and
    // scope eligibility set are those captured from the current render closure.
    const nextQueues = buildSessionQueues(
      newCards,
      effectiveLimits,
      today,
      eligibleCardIds,
      shuffleSalt,
      activeLocale,
    );

    // Compute the post-grade learning queue here, mirroring the `setLearningQueue`
    // updater below. The decode-ahead prediction must run against the queue as it
    // will be *after* this grade - using the pre-grade `learningQueue` closure
    // would mispredict when the graded card re-enters a learning step (its new
    // `dueAt`) or graduates out (#719).
    const nextLearningQueue: LearningQueueEntry[] = (() => {
      if (nextState.learningStep !== null) {
        const stepMs = stepDurationMs(
          nextState.lastReview,
          nextState.learningStep,
          nextState.difficulty,
        );
        const newEntry: LearningQueueEntry = {
          cardId: effectiveCard.id,
          dueAt: nextState.stepStartedAt! + stepMs,
        };
        const exists = learningQueue.some((e) => e.cardId === effectiveCard.id);
        return exists
          ? learningQueue.map((e) => (e.cardId === effectiveCard.id ? newEntry : e))
          : [...learningQueue, newEntry];
      }
      return learningQueue.filter((e) => e.cardId !== effectiveCard.id);
    })();

    const nextLearningDue = nextLearningQueue
      .filter((e) => e.dueAt <= Date.now())
      .sort((a, b) => a.dueAt - b.dueAt);
    let nextCardId =
      nextLearningDue[0]?.cardId ??
      getNextCardId(nextQueues.reviewQueue, nextQueues.newQueue);

    // Learn-ahead fallback: when the queue is otherwise empty, the render-time
    // card picker pulls the earliest learning card forward if it falls within
    // LEARN_AHEAD_MS. Mirror that here so the card that actually renders is the
    // one we decode - otherwise the learn-ahead card pops in (#719).
    if (nextCardId === null) {
      const decodeNow = Date.now();
      const ahead = nextLearningQueue
        .filter((e) => e.dueAt > decodeNow && e.dueAt <= decodeNow + LEARN_AHEAD_MS)
        .sort((a, b) => a.dueAt - b.dueAt);
      if (ahead.length > 0) {
        nextCardId = ahead[0].cardId;
      }
    }

    if (nextCardId !== null) {
      const nextCard = newCards.find((c) => c.id === nextCardId);
      if (nextCard) {
        if (nextCard.cardType === "reverse") {
          // Reverse cards show a four-tile SpritePicker at PICKER_SPRITE_SIZE.
          // `preloadableSpriteUrls` returns [] for reverse cards (it feeds the
          // 320 px flip-card pipeline), so decode the picker tile sprites
          // directly here instead.
          // Use the tighter grade-path ceiling (#1191) - sprites are
          // self-hosted and already network-warmed, so 150 ms is sufficient.
          const target = seedById.get(nextCard.pokemonId);
          if (target) {
            const distractors = pickDistractors(nextCard.pokemonId, seedPokemon, 3, String(nextCard.id));
            await decodeSpriteUrls(
              [target, ...distractors].map((p) => p.spriteUrl),
              DECODE_GRADE_TIMEOUT_MS,
              handleSlowSpriteLoad,
            );
          }
        } else {
          await decodeSpriteUrls(preloadableSpriteUrls(nextCard), DECODE_GRADE_TIMEOUT_MS, handleSlowSpriteLoad);
        }
      }
    }

    // Optionally wait for any in-progress cry and/or TTS playback to finish
    // before swapping the visible card. When `waitForAudioOnGrade` is on
    // (default), today's behaviour is preserved - the swap is deferred until
    // audio finishes. When off, the swap fires immediately and audio continues
    // playing under the next card: cry/TTS are global and are not cut off,
    // only overlapped. This removes the ~1-3 s audio-wait lag from the grade
    // critical path for users who prefer speed (#1191 / #732).
    if (settings.waitForAudioOnGrade) {
      await waitForAudio();
    }

    // Guard against advancing after the component has unmounted (e.g. the user
    // navigated away during the audio wait). Clear the grading flag so it is
    // not stuck as `true` if the component somehow re-mounts or a stale
    // closure reads it.
    if (!isMountedRef.current) {
      setGrading(false);
      return;
    }

    // ── Visible swap ────────────────────────────────────────────────────────
    // Commit the grade to the cloud-sync queue and immediately update all
    // visible state (#1191 Class B item 5). Persistence (saveSession,
    // appendGradeEntry, recordReview) runs in the background so it does not
    // block the swap.
    //
    // The undo snapshot is NOT set here. It is set inside the persistence
    // chain only after saveSession confirms the write succeeded (#1209).
    // This keeps the undo button's enabled state consistent with persisted
    // state: a failed save leaves no snapshot, so undo stays disabled.
    enqueueGrade({ ...effectiveCard, state: nextState });

    // Persist the MC-card onboarding flag after the first grade from an MC
    // learning card (#1271). Runs once per user, then never again. Compute
    // the MC-active check inline (mirrors the render-time `isMcLearningActive`).
    const gradedCardIsInLearning =
      effectiveCard.cardType === "name" &&
      (effectiveCard.state.lastReview === null ||
        effectiveCard.state.learningStep !== null);
    if (verifiedTypedEntryMode && gradedCardIsInLearning && !mcCardOnboardingShown && !superuserGuarded) {
      setMcCardOnboardingShown(true);
      const updatedSettings = loadSettings();
      if (!updatedSettings.mcCardOnboardingShown) {
        saveSettings({ ...updatedSettings, mcCardOnboardingShown: true });
      }
    }

    setCards(newCards);
    setSessionGrades((prev) => ({ ...prev, [grade]: prev[grade] + 1 }));
    setSessionGradeSeq((prev) => [...prev, grade]);
    // Update the per-direction tally. Good (4) and Easy (5) count as passes;
    // Again (1) and Hard (2) do not. Only directions that receive at least one
    // grade appear in the map, so the session-end row omits directions with no
    // history - matching the convention in computeDirectionBreakdown.
    setSessionDirectionGrades((prev) => {
      const dir = effectiveCard.cardType;
      const existing = prev.get(dir) ?? { total: 0, passes: 0 };
      const next = new Map(prev);
      next.set(dir, {
        total: existing.total + 1,
        passes: existing.passes + (grade === 4 || grade === 5 ? 1 : 0),
      });
      return next;
    });
    // Track new / species-mastered transitions for the daily share card.
    // `speciesJustMastered` is true only when BOTH name + reverse legs crossed
    // the FSRS gate (species-level mastery, #1448/#1234).
    if (wasNew && nextState.firstSeen !== null) {
      setNewCardsThisSession((n) => n + 1);
    }
    if (speciesJustMastered) {
      setMasteredThisSession((n) => n + 1);
      // Write the lightweight "has mastered" flag so NavLinks / BottomTabBar
      // can reveal the Pasture tab without re-parsing the full session blob
      // from IDB on every SESSION_CHANGED_EVENT (#1191 Class A item 3).
      // The Pasture shows species-level mastered entries, so this flag is now
      // guarded on species mastery (both legs) rather than name-card-only (#1448).
      if (!superuserGuarded) {
        writeHasMasteredFlag(true);
      }
    }
    // Update the per-locale mastered-count cache whenever a name or reverse
    // card is graded (those are the only card types that affect mastery count).
    // Written regardless of speciesJustMastered so lapse events (count going
    // down) are also reflected, and so the cache is accurate for any grade.
    // Skipped while superuser-guarded (consistent with other localStorage
    // writes). Uses `filterMastered` - the same authoritative derivation as
    // `computeStats` - so the parity contract test can hold (#1489).
    if (
      !superuserGuarded &&
      (effectiveCard.cardType === "name" || effectiveCard.cardType === "reverse")
    ) {
      writeMasteredCountCache(
        newCards,
        (settings.activePokemonNameLocale ?? "en") as AppLocale,
      );
    }
    if (!superuserGuarded) {
      // MULTI-LOCALE: this writes the due-count + has-history cache for ALL
      // locales, so it must see the full multi-locale array - not the
      // active-locale-filtered `newCards`, which would zero every other
      // language's badge on each grade (#1484 clarity follow-up review).
      writeDueCountCacheFromCards(fullSessionRef.current, today);
    }

    // Update the learning queue based on the new state.
    setLearningQueue((prev) => {
      if (nextState.learningStep !== null) {
        // Card is in (or remains in) a learning/relearning step.
        // Distinction: new-card learning has lastReview === null after grading.
        const stepMs = stepDurationMs(
          nextState.lastReview,
          nextState.learningStep,
          nextState.difficulty,
        );
        const newEntry: LearningQueueEntry = {
          cardId: effectiveCard.id,
          dueAt: nextState.stepStartedAt! + stepMs,
        };

        // Replace existing entry or add new one.
        const exists = prev.some((e) => e.cardId === effectiveCard.id);
        if (exists) {
          return prev.map((e) =>
            e.cardId === effectiveCard.id ? newEntry : e,
          );
        }
        return [...prev, newEntry];
      } else {
        // Card has graduated or is in a non-learning state - remove from queue.
        return prev.filter((e) => e.cardId !== effectiveCard.id);
      }
    });

    setCurrentFact(null);
    setRevealed(false);
    // Clear the card-revealed flag so LanguageSwitcher unlocks (#1562).
    markCardRevealed(false);
    revealedCardId.current = null;
    // Release the display lock so the next card can be picked up on the
    // following render (#839).
    setDisplayedCardId(null);
    // Advance the presentation counter so the next card (or a replay of this
    // same card) gets a fresh SpritePicker mount with a re-shuffled option
    // grid (#496).
    setCardPresentationCount((n) => n + 1);
    // Clear any previous grade error - the user has successfully graded a card,
    // so the "please retry" banner is no longer relevant.
    setGradeError(null);
    setGrading(false);

    // ── Background persistence ───────────────────────────────────────────────
    // saveSession, recordReview, and appendGradeEntry run after the visible
    // swap so they do not delay the next card appearing on screen (#1191).
    //
    // Chained onto `persistenceChainRef` so that rapid back-to-back grades
    // never race inside appendGradeEntry: the second grade's IDB read waits
    // for the first grade's IDB write to commit, preserving the ordered log.
    //
    // snapshot.gradeLogOccurredAt is mutated in-place after appendGradeEntry
    // resolves. Undo reads it from undoSnapshotRef.current at click-time; if
    // the user undoes before persistence completes the entry is simply left in
    // the grade log (a minor non-critical omission in an extremely narrow race
    // window - the same behaviour as if IDB were slow under the old ordering).
    persistenceChainRef.current = persistenceChainRef.current.then(async () => {
      if (!isMountedRef.current) return;
      // saveSession resolves with { ok: true } or { ok: false } - it never
      // rejects. Only append to the grade log when the session blob persisted
      // successfully; writing the grade log on a failed session write would
      // create a split-write where the grade log advanced past the saved state
      // (#1196). Surface the failure via notifySaveResult so the user sees the
      // existing storage-error banner.
      // MULTI-LOCALE: save the full array, never the filtered view.
      // `newFullCards` was computed above (merged graded card into the full
      // session by (id, locale)) and stored in fullSessionRef.current.
      const saveResult = await saveSession({ cards: fullSessionRef.current, limits });
      notifySaveResult(saveResult);
      if (!saveResult.ok) {
        console.error(
          "[handleGrade] saveSession failed - skipping grade-log append to avoid split-write:",
          saveResult.reason,
        );
        // Do NOT set the undo snapshot on a failed save (#1209). The undo
        // button stays disabled so its enabled state matches persisted state.
        return;
      }
      // Session persisted successfully - arm the undo snapshot now so the
      // undo button only becomes active when there is a durable write to
      // revert (#1209).
      undoSnapshotRef.current = snapshot;
      setHasUndoSnap(true);
      const gradeLog = await loadGradeLog();
      // Count and stamp in the user's-timezone day domain (#1853): the streak
      // readers and Stats charts anchor on the tz-local day, so the writer
      // must too. dueDate/lastReview comparisons stay UTC (scheduling dates).
      const gradedToday = gradeLog.filter((e) => e.date === localToday).length + 1;
      const dueQueueEmpty = !newCards.some(
        (c) =>
          c.state.learningStep === null &&
          c.state.lastReview !== null &&
          c.state.dueDate <= today &&
          c.state.lastReview !== today,
      );
      recordReview(localToday, gradedToday, dueQueueEmpty);
      // Pass POST-grade learningStep/stepStartedAt from nextState so the
      // grade_log row captures the scheduler's exact in-learning position
      // at the time of grading (#1416). These are in closure scope.
      const appended = await appendGradeEntry({
        date: localToday,
        grade,
        cardType: effectiveCard.cardType,
        subjectKey: effectiveCard.subjectKey,
        learningStep: nextState.learningStep,
        stepStartedAt: nextState.stepStartedAt,
        // Pass the graded card's locale so the grade log row carries the
        // correct locale for per-locale FSRS optimisation (#1562).
        locale: effectiveCard.locale ?? activeLocale,
      });
      snapshot.gradeLogOccurredAt = appended?.occurredAt ?? null;
    });

    // Persist the cumulative daily summary so the share button survives a
    // reload (#685). React state setters above are async; compute totals from
    // the pre-grade snapshot + this grade. snapshot.sessionGradeSeq is
    // already the day's cumulative sequence (hydrated at mount), so writing
    // directly is correct - no need to re-read and merge from localStorage.
    // Skipped while a superuser flag is on so QA grade sequences never reach
    // localStorage - consistent with the cloud write-guard.
    if (!superuserGuarded) {
      const nextGradeSeq = [...snapshot.sessionGradeSeq, grade];
      const nextNewCards =
        snapshot.newCardsThisSession +
        (wasNew && nextState.firstSeen !== null ? 1 : 0);
      const nextMastered =
        snapshot.masteredThisSession + (speciesJustMastered ? 1 : 0);
      saveDailySummary({
        date: todayString(now, timezone),
        gradeSequence: nextGradeSeq,
        reviewed: nextGradeSeq.length,
        newCards: nextNewCards,
        mastered: nextMastered,
      });
    }

    // Badge award (#420). Deferred to a macrotask so the heavy
    // `masteredSpeciesIds` scan and Set construction run after the visible
    // swap commits (#1191 Class B item 9). The toast can appear a frame later
    // - that is the deliberate trade for instant swap. Only fires when a name
    // card just crossed the mastery threshold.
    //
    // Superuser guard: skip entirely while any flag is on - see the full
    // rationale in the comment below.
    if (!wasMastered && nowMastered && effectiveCard.cardType === "name" && !superuserGuarded) {
      // Capture values needed inside the timeout closure now, before they
      // go stale. The badge check is scoped to the graded card's locale
      // (#1851): masteredSpeciesIds counts only cards in the given locale,
      // so passing the locale the user just mastered in lets ja/zh learners
      // earn badges - previously the implicit "en" default made badges
      // permanently unearnable outside English.
      const masteredCheckCards = newCards;
      const masteredCheckSettings = settings;
      const masteredCheckLocale = effectiveCard.locale ?? "en";
      setTimeout(() => {
        if (!isMountedRef.current) return;
        const masteredIds = masteredSpeciesIds(
          masteredCheckCards,
          false,
          masteredCheckLocale,
        );
        const earnedIds = new Set(masteredCheckSettings.earnedBadges.map((b) => b.id));
        const newlyEarned = checkBadges(masteredIds, BADGE_CATALOG, earnedIds);
        if (newlyEarned.length > 0) {
          const nowIso = now.toISOString();
          const nextSettings: UserSettings = {
            ...masteredCheckSettings,
            earnedBadges: [
              ...masteredCheckSettings.earnedBadges,
              ...newlyEarned.map((b) => ({ id: b.id, earnedAt: nowIso })),
            ],
          };
          saveSettings(nextSettings);
          setPendingBadgeToasts((prev) => [...prev, ...newlyEarned]);
        }
      }, 0);
    }
  }

  async function handleUndo() {
    const snapshot = undoSnapshotRef.current;
    if (snapshot === null || grading) return;
    // Revert local state to the pre-grade snapshot.
    setCards(snapshot.cards);
    // MULTI-LOCALE: restore the full array and save it; never the filtered view.
    fullSessionRef.current = snapshot.fullCards;
    setSessionGrades(snapshot.sessionGrades);
    setSessionGradeSeq(snapshot.sessionGradeSeq);
    setSessionDirectionGrades(snapshot.sessionDirectionGrades);
    setNewCardsThisSession(snapshot.newCardsThisSession);
    setMasteredThisSession(snapshot.masteredThisSession);
    setLearningQueue(snapshot.learningQueue);
    notifySaveResult(await saveSession({ cards: snapshot.fullCards, limits }));
    if (snapshot.gradeLogOccurredAt !== null) {
      await removeGradeEntry(snapshot.gradeLogOccurredAt);
    }
    // Roll back the persisted daily summary to match the reverted state (#685).
    // Skipped while a superuser flag is on so QA grade sequences never reach
    // localStorage - consistent with the cloud write-guard.
    if (!superuserGuarded) {
      const seq = snapshot.sessionGradeSeq;
      saveDailySummary({
        date: todayString(new Date(), timezone),
        gradeSequence: seq,
        reviewed: seq.length,
        newCards: snapshot.newCardsThisSession,
        mastered: snapshot.masteredThisSession,
      });
    }
    // Make the undone card the current revealed card so the user lands
    // back on the prompt they just graded. Also reset the display lock so
    // the undo card is locked in from this point (#839).
    setDisplayedCardId(snapshot.cardId);
    revealedCardId.current = snapshot.cardId;
    setRevealed(true);
    // Undo re-reveals the card, so set the flag accordingly (#1562).
    markCardRevealed(true);
    // Bump the presentation counter so SpritePicker remounts with a fresh
    // shuffle if the user re-grades this reverse card (#496).
    setCardPresentationCount((n) => n + 1);
    undoSnapshotRef.current = null;
    setHasUndoSnap(false);
  }

  // --- Active review UI ---

  // Extract the English display name once for all render branches below.
  // Each child component (PokemonCard, MultipleChoiceNameCard, TypedEntryNameCard)
  // calls useLocalePokemonName internally, so `cardEnglishName` is the
  // fallback argument, not a final render value - the lint rule is intentionally
  // suppressed here (#1327).
  // EvolutionReviewCard and ReverseEvolutionReviewCard do not carry displayName
  // (they render via EvolutionCard, not PokemonCard), so we fall back to ""
  // for TypeScript's sake. Those branches never read cardEnglishName.
  // eslint-disable-next-line no-restricted-syntax -- displayName is the English-fallback arg forwarded to child components that call useLocalePokemonName internally
  const cardEnglishName = "displayName" in effectiveCard ? effectiveCard.displayName : "";

  // Cry cards: cry plays as the prompt; sprite + name + grade buttons
  // appear after the user taps Reveal (or the visually-merged Play tile).
  if (effectiveCard.cardType === "cry") {
    return (
      <ReviewCardLayout
        variant="flip"
        topChrome={
          <>
            {quotaExceeded && <StorageQuotaBanner onDismiss={dismiss} />}
            {gradeError !== null && (
              <GradeErrorBanner message={gradeError} onDismiss={() => setGradeError(null)} />
            )}
            <SpritePreloader urls={preloadSpriteUrls} sizedUrls={preloadPickerUrls} />
            {/* Cry card wraps ScopeControl in a max-width column for alignment. */}
            <div className="flex w-full max-w-xl flex-col gap-2">
              {higherOrLowerNudge}
              {scopeNudge}
              {masteryBlockersNudge}
              {offlineNudge}
              <ScopeControl
                scope={scope}
                onChange={handleScopeChange}
                alternateFormsEnabled={alternateFormsEnabled}
                incompleteChainSpeciesIds={incompleteChains}
                masteryBlockingSpeciesIds={masteryBlockingSpeciesIds}
              />
            </div>
          </>
        }
        queueStateBadge={<QueueStateBadge state={effectiveCard.state} forceCardsGraduated={superuserFlags.forceCardsGraduated} />}
        cardRegion={
          /* Swipeable card wrapper - pointer listeners attached here (#1052).
             PokemonCard reserves the revealed-state height in its answer container
             so the bounding box is stable across reveal (#1104). The cry play
             button (h-28 ≈ 7rem) coincidentally matches that reserved height, so
             unrevealed and revealed states centre at the same point. */
          <div ref={cardRef} className="relative" data-testid="swipe-card">
            {revealed ? (
              <>
                <PokemonCard
                  spriteUrl={effectiveCard.spriteUrl}
                  name={cardEnglishName}
                  revealed
                  fact={currentFact}
                  direction="cry"
                  id={effectiveCard.pokemonId}
                />
                <SwipeHint swipeState={swipeState} />
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 sm:gap-4">
                <DirectionBadge direction="cry" />
                <button
                  type="button"
                  onClick={() => playCry(effectiveCard.cryUrl ?? null)}
                  className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-zinc-300 bg-zinc-50 text-4xl transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:border-zinc-700 dark:bg-zinc-900 sm:h-40 sm:w-40 sm:text-5xl"
                  aria-label={t("playCry")}
                >
                  🔊
                </button>
                <p className="text-base font-semibold text-foreground">
                  {t("cryPrompt")}
                </p>
              </div>
            )}
          </div>
        }
        controls={
          revealed ? (
            <GradeButtons
              onGrade={handleGrade}
              disabled={grading}
              previews={gradePreviewsOrNull ?? undefined}
              showShortcuts={showKeyboardShortcuts}
              onOpenShortcuts={() => setShowKeyboardShortcuts(true)}
              onCloseShortcuts={() => setShowKeyboardShortcuts(false)}
            />
          ) : (
            <button
              type="button"
              onClick={handleReveal}
              disabled={revealing}
              className="min-h-[44px] rounded-lg bg-theme-accent px-8 py-2 text-sm font-semibold text-theme-fg-on-primary transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {t("reveal")}
            </button>
          )
        }
        keyboardShortcutsOverlay={
          showKeyboardShortcuts ? (
            <KeyboardShortcutsOverlay onClose={() => setShowKeyboardShortcuts(false)} />
          ) : undefined
        }
        showOutOfScopeHint={outOfScopeLearningSet.has(effectiveCard.id)}
        queueCounts={{ newCount, learningCount, reviewCount }}
        hasUndoSnapshot={hasUndoSnap}
        onUndo={handleUndo}
        statsPanel={
          /* Session stats are hidden on mobile to keep grade buttons in view (#1087) */
          <div className="hidden sm:block sm:w-full flex-none">
            <GradeBreakdownBar
              again={sessionGrades[1]}
              hard={sessionGrades[2]}
              good={sessionGrades[4]}
              easy={sessionGrades[5]}
              label={t("thisSession")}
              hideZeroSegments
            />
          </div>
        }
        badgeToastSlot={badgeToastSlot}
      />
    );
  }

  // Reverse cards use the SpritePicker (multiple-choice); no reveal step.
  if (effectiveCard.cardType === "reverse") {
    // pokemonId is set from SEED_POKEMON at session-build time, so this find
    // only fails if the seed changes under a persisted session (e.g. after a
    // seed data update). Guard against a hard crash by rendering nothing in
    // that case; the user can reload to rebuild their session.
    const reverseTarget = seedPokemon.find((p) => p.id === effectiveCard.pokemonId);
    if (!reverseTarget) return null;
    const reverseDistractors = pickDistractors(
      effectiveCard.pokemonId,
      seedPokemon,
      3,
      String(effectiveCard.id),
    );
    // Read settings once before the return, matching the pattern in
    // handleReveal which resolves loadSettings() in the handler, not in JSX.
    const reverseSettings = loadSettings();
    const playCryOnAnswer = reverseSettings.playCryOnReveal;
    const speakNameOnAnswer = reverseSettings.speakNameOnReveal;
    return (
      <ReviewCardLayout
        variant="reverse"
        topChrome={
          <>
            {quotaExceeded && <StorageQuotaBanner onDismiss={dismiss} />}
            {gradeError !== null && (
              <GradeErrorBanner message={gradeError} onDismiss={() => setGradeError(null)} />
            )}
            <SpritePreloader urls={preloadSpriteUrls} sizedUrls={preloadPickerUrls} />
            {higherOrLowerNudge}
            {scopeNudge}
            {masteryBlockersNudge}
            {offlineNudge}
            <ScopeControl
              scope={scope}
              onChange={handleScopeChange}
              alternateFormsEnabled={alternateFormsEnabled}
              incompleteChainSpeciesIds={incompleteChains}
              masteryBlockingSpeciesIds={masteryBlockingSpeciesIds}
            />
          </>
        }
        queueStateBadge={<QueueStateBadge state={effectiveCard.state} forceCardsGraduated={superuserFlags.forceCardsGraduated} />}
        cardRegion={
          /* SpritePicker: fills the flex-1 card region and scales its 2×2 grid
             to the available height rather than scrolling (#1839 followup). */
          <SpritePicker
            key={`${effectiveCard.id}-${cardPresentationCount}`}
            targetPokemon={reverseTarget}
            distractors={reverseDistractors}
            onGrade={(correct) => handleGrade(correct ? 4 : 1)}
            playCryOnAnswer={playCryOnAnswer}
            speakNameOnAnswer={speakNameOnAnswer}
          />
        }
        belowCard={undefined}
        showOutOfScopeHint={outOfScopeLearningSet.has(effectiveCard.id)}
        queueCounts={{ newCount, learningCount, reviewCount }}
        hasUndoSnapshot={hasUndoSnap}
        onUndo={handleUndo}
        statsPanel={
          /* Session stats are hidden on mobile to keep the picker in view (#1087) */
          <div className="hidden sm:flex sm:flex-col sm:items-center sm:gap-4 sm:w-full flex-none">
            <TodayPill
              perType={perType}
              nameEnabled={true}
              evolutionEnabled={evolutionCardsEnabled}
              reverseEnabled={reverseEnabled}
              reverseEvolutionEnabled={reverseEvolutionEnabled}
              cryEnabled={cryCardsEnabled}
              activeLocaleEndonym={learningLocales.length > 1 ? LOCALE_ENDONYMS[activeLocale] : null}
            />
            <GradeBreakdownBar
              again={sessionGrades[1]}
              hard={sessionGrades[2]}
              good={sessionGrades[4]}
              easy={sessionGrades[5]}
              label={t("thisSession")}
              hideZeroSegments
            />
          </div>
        }
        badgeToastSlot={badgeToastSlot}
      />
    );
  }

  // Default branch: name, evolution, and reverse-evolution cards.
  //
  // When verifiedTypedEntryMode is on and the current card is a name card, the
  // renderer depends on the card's lifecycle phase (#1237):
  //
  //   - Learning phase (brand-new OR in a learning/relearning step)
  //     → MultipleChoiceNameCard: sprite + 4 options, Good on correct, Again on wrong.
  //   - Graduated (lastReview !== null AND learningStep === null)
  //     → TypedEntryNameCard: typed-input verification.
  //
  // Evolution and reverse-evolution cards always use the existing flip flow.
  const isNameCard = effectiveCard.cardType === "name";
  // A card is in the learning phase when it has never graduated (lastReview is
  // null) OR when it is currently working through learning/relearning steps
  // (learningStep is not null). The scheduler sets lastReview only on graduation
  // or lapse - not on in-step touches - so this check is reliable.
  //
  // `forceCardsGraduated` (superuser flag #1270) bypasses this so typed-entry
  // mode can be tested without grinding through learning steps.
  const isInLearningPhase =
    isNameCard &&
    !superuserFlags.forceCardsGraduated &&
    (effectiveCard.state.lastReview === null ||
      effectiveCard.state.learningStep !== null);
  const isMcLearningActive = verifiedTypedEntryMode && isInLearningPhase;
  // Typed entry is English-only. Non-English sessions fall back to flip /
  // multiple-choice so the typed answer is never compared against a
  // Japanese (or other locale) display name. Full fix tracked in #1561.
  const isTypedEntryActive =
    verifiedTypedEntryMode && isNameCard && !isInLearningPhase && activeLocale === "en";

  // Pre-build MC options when we know we will render the MC card. The options
  // array is stable per card id: the same 4 options and order appear on every
  // replay during learning steps. This is deliberate - replays are about
  // recognition, not re-puzzle-solving.
  const mcOptions =
    isMcLearningActive
      ? buildMcOptions(
          effectiveCard.id,
          // effectiveCard is a NameReviewCard (SeedPokemon fields are spread onto it).
          effectiveCard as Parameters<typeof buildMcOptions>[1],
          seedPokemon,
          String(effectiveCard.id),
        )
      : null;

  return (
    <ReviewCardLayout
      variant="flip"
      topChrome={
        <>
          {quotaExceeded && <StorageQuotaBanner onDismiss={dismiss} />}
          {gradeError !== null && (
            <GradeErrorBanner message={gradeError} onDismiss={() => setGradeError(null)} />
          )}
          <SpritePreloader urls={preloadSpriteUrls} sizedUrls={preloadPickerUrls} />
          {higherOrLowerNudge}
          {scopeNudge}
          {masteryBlockersNudge}
          {offlineNudge}
          <ScopeControl
            scope={scope}
            onChange={handleScopeChange}
            alternateFormsEnabled={alternateFormsEnabled}
            incompleteChainSpeciesIds={incompleteChains}
            masteryBlockingSpeciesIds={masteryBlockingSpeciesIds}
          />
        </>
      }
      queueStateBadge={<QueueStateBadge state={effectiveCard.state} />}
      cardRegion={
        isMcLearningActive && mcOptions !== null ? (
          /* Multiple-choice name card (#1237): sprite + 4 name buttons during the
             learning-step phase. Correct → Good (4); wrong → Again (1). The
             swipe-card wrapper is omitted; swipe-to-grade is not applicable.
             Key includes cardPresentationCount so the component remounts (and
             resets chosen state) when the same card reappears via a learning-step
             replay, matching the SpritePicker pattern (#496). */
          <div className={`${colStack} w-full`}>
            {/* One-time learning-phase banner (#1271). Visible until the first
                MC grade fires; after that `mcCardOnboardingShown` is true and
                the banner never re-renders. */}
            {!mcCardOnboardingShown && (
              <div
                role="note"
                className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
              >
                This card is in the learning phase. Pick the matching name from the options below. Verified typed entry will kick in once the card graduates.
              </div>
            )}
            <MultipleChoiceNameCard
              key={`${effectiveCard.id}-${cardPresentationCount}`}
              spriteUrl={effectiveCard.spriteUrl}
              canonicalName={cardEnglishName}
              options={mcOptions}
              id={effectiveCard.id}
              onGrade={handleGrade}
              grading={grading}
            />
          </div>
        ) : isTypedEntryActive ? (
          /* Verified typed-entry (#1251): renders input, grades automatically,
             then the parent advances on the onGrade callback. The swipe-card
             wrapper is omitted because swipe-to-grade is not applicable here. */
          <TypedEntryNameCard
            key={effectiveCard.id}
            spriteUrl={effectiveCard.spriteUrl}
            canonicalName={cardEnglishName}
            id={effectiveCard.id}
            onGrade={handleGrade}
            grading={grading}
          />
        ) : (
          /* Swipeable card wrapper - pointer listeners attached here (#1052).
             PokemonCard and EvolutionCard reserve the revealed-state height in
             their inner answer container (min-h-[7rem]), so the card's bounding
             box is the same size across reveal and centring does not cause the
             sprite to drift (#1104). */
          <div ref={cardRef} className="relative" data-testid="swipe-card">
            {effectiveCard.cardType === "evolution" ||
            effectiveCard.cardType === "reverse-evolution" ? (
              <EvolutionCard
                direction={effectiveCard.cardType}
                preEvoSpriteUrl={effectiveCard.preEvoSpriteUrl}
                preEvoName={effectiveCard.preEvoName}
                postEvoName={effectiveCard.postEvoName}
                postEvoSpriteUrl={effectiveCard.postEvoSpriteUrl}
                triggerPhrase={effectiveCard.triggerPhrase}
                revealed={revealed}
                fact={currentFact}
                preEvoId={effectiveCard.preEvoId}
                postEvoId={effectiveCard.postEvoId}
              />
            ) : (
              <PokemonCard
                spriteUrl={effectiveCard.spriteUrl}
                name={cardEnglishName}
                revealed={revealed}
                fact={currentFact}
                id={effectiveCard.id}
              />
            )}
            {revealed && <SwipeHint swipeState={swipeState} />}
          </div>
        )
      }
      controls={
        isMcLearningActive ? (
          // MultipleChoiceNameCard renders its own option buttons inline;
          // the layout's controls slot is left empty.
          undefined
        ) : isTypedEntryActive ? (
          // TypedEntryNameCard renders its own Submit / I don't know controls
          // inline; the layout's controls slot is left empty.
          undefined
        ) : revealed ? (
          <GradeButtons
            onGrade={handleGrade}
            disabled={grading}
            previews={gradePreviewsOrNull ?? undefined}
            showShortcuts={showKeyboardShortcuts}
            onOpenShortcuts={() => setShowKeyboardShortcuts(true)}
            onCloseShortcuts={() => setShowKeyboardShortcuts(false)}
          />
        ) : (
          <div className="flex flex-col items-center gap-2">
            {verifiedTypedEntryMode && activeLocale !== "en" && (
              <p
                role="note"
                className={`max-w-xs text-center ${mutedTextXs}`}
              >
                {t("typedEntryEnglishOnly")}
              </p>
            )}
            <button
              type="button"
              onClick={handleReveal}
              disabled={revealing}
              className="min-h-[44px] rounded-lg bg-theme-accent px-8 py-2 text-sm font-semibold text-theme-fg-on-primary transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {t("reveal")}
            </button>
          </div>
        )
      }
      keyboardShortcutsOverlay={
        showKeyboardShortcuts ? (
          <KeyboardShortcutsOverlay onClose={() => setShowKeyboardShortcuts(false)} />
        ) : undefined
      }
      showOutOfScopeHint={outOfScopeLearningSet.has(effectiveCard.id)}
      queueCounts={{ newCount, learningCount, reviewCount }}
      hasUndoSnapshot={hasUndoSnap}
      onUndo={handleUndo}
      statsPanel={
        /* Session stats are hidden on mobile to keep grade buttons in view (#1087) */
        <div className="hidden sm:flex sm:flex-col sm:items-center sm:gap-4 sm:w-full flex-none">
          <TodayPill
            perType={perType}
            nameEnabled={true}
            evolutionEnabled={evolutionCardsEnabled}
            reverseEnabled={reverseEnabled}
            reverseEvolutionEnabled={reverseEvolutionEnabled}
            cryEnabled={cryCardsEnabled}
            activeLocaleEndonym={learningLocales.length > 1 ? LOCALE_ENDONYMS[activeLocale] : null}
          />
          <GradeBreakdownBar
            again={sessionGrades[1]}
            hard={sessionGrades[2]}
            good={sessionGrades[4]}
            easy={sessionGrades[5]}
            label={t("thisSession")}
          />
        </div>
      }
      badgeToastSlot={badgeToastSlot}
    />
  );
}
