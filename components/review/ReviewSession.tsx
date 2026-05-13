"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { PokemonCard } from "@/components/review/PokemonCard";
import { EvolutionCard } from "@/components/review/EvolutionCard";
import { ReverseEvolutionCard } from "@/components/review/ReverseEvolutionCard";
import { SpritePicker } from "@/components/review/SpritePicker";
import { DirectionBadge } from "@/components/review/DirectionBadge";
import { GradeButtons } from "@/components/review/GradeButtons";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";
import { SEED_POKEMON, SEED_EVOLUTION_CARDS } from "@/lib/pokemon/seed";
import { reconcileHiddenState } from "@/lib/review/filters";
import { pickDistractors } from "@/lib/pokemon/distractors";
import {
  buildSession,
  buildSessionQueues,
  getNextCardId,
  hydrateSession,
  limitBucket,
  todayString,
  type DailyLimits,
  type ReviewableCard,
  type Grade,
  DEFAULT_LIMITS,
} from "@/lib/review/session";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { useStorageQuota } from "@/lib/review/useStorageQuota";
import { StorageQuotaBanner } from "@/components/review/StorageQuotaBanner";
import { recordReview } from "@/lib/streak";
import { loadSettings, saveSettings, type UserSettings } from "@/lib/settings/persistence";
import { nextReview } from "@/lib/srs/scheduler";
import { learningStepsFor, relearningStepsFor } from "@/lib/srs/constants";
import { getPokemonFacts, selectFact, type PokemonFact } from "@/lib/pokemon/facts";
import { playCry } from "@/lib/audio/cry";
import { speakName } from "@/lib/audio/tts";
import { useAuth } from "@/lib/auth/AuthContext";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { usePerGradeSync } from "@/lib/sync/usePerGradeSync";
import { useSyncOnUnload } from "@/lib/sync/useSyncOnUnload";
import { appendGradeEntry, loadGradeLog, removeGradeEntry } from "@/lib/gradelog/persistence";
import { GradeBreakdownBar } from "@/components/stats/GradeBreakdownBar";
import { QueueCounterRow } from "@/components/review/QueueCounterRow";
import { ShareTodayButton } from "@/components/review/ShareTodayButton";
import { previewIntervals } from "@/lib/srs/intervalPreview";
import { isMastered } from "@/lib/stats/derive";
import { BADGE_CATALOG, type BadgeDefinition } from "@/lib/badges/catalog";
import { checkBadges } from "@/lib/badges/check";
import { masteredSpeciesIds } from "@/lib/badges/derive";
import { BadgeToast } from "@/components/badges/BadgeToast";
import { formatDailySummary } from "@/lib/review/share";
import { computeStreak, loadStreakData } from "@/lib/streak";
import {
  EMPTY_SCOPE,
  cardMatchesScope,
  isScopeEmpty,
  type PracticeScope,
} from "@/lib/review/scope";
import { ScopeControl } from "@/components/review/ScopeControl";
import { HigherOrLowerGame } from "@/components/review/HigherOrLowerGame";
import { getSeenPokemon } from "@/lib/minigame/higherOrLower";


// Pull learning cards forward when due within this window (Anki default: 20 min).
const LEARN_AHEAD_MS = 20 * 60_000;

// Module-scoped seed lookup map. Built once at module load — the 1025-entry
// Map would be wasteful to rebuild on every render of ReviewSession.
const SEED_BY_ID = new Map(SEED_POKEMON.map((p) => [p.id, p]));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EndState = "SESSION_COMPLETE" | "REVIEW_SOFT_WALL" | "NEW_CARDS_LOCKED";

type LearningQueueEntry = { cardId: number; dueAt: number };

type UndoSnapshot = {
  cards: ReviewableCard[];
  sessionGrades: Record<Grade, number>;
  sessionGradeSeq: Grade[];
  newCardsThisSession: number;
  masteredThisSession: number;
  learningQueue: LearningQueueEntry[];
  cardId: number;
  // `occurredAt` of the grade-log entry written by this grade — used to
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
 * Format milliseconds as "Xm Ys" (e.g. "1m 23s") or just "Xs" when under 1m.
 */
function formatCountdown(ms: number): string {
  const totalSecs = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSecs / 60);
  const seconds = totalSecs % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

// ---------------------------------------------------------------------------
// Sub-components: end states
// ---------------------------------------------------------------------------

type PerTypeTodayCounts = {
  name: { newIntroducedToday: number; reviewsDoneToday: number };
  evolution: { newIntroducedToday: number; reviewsDoneToday: number };
  reverse: { newIntroducedToday: number; reviewsDoneToday: number };
};

function TodayPill({
  perType,
  nameEnabled,
  evolutionEnabled,
  reverseEnabled,
}: {
  perType: PerTypeTodayCounts;
  nameEnabled: boolean;
  evolutionEnabled: boolean;
  reverseEnabled: boolean;
}) {
  return (
    <div className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums text-center">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Done today
      </p>
      {nameEnabled && (
        <p>
          <span className="text-zinc-600 dark:text-zinc-300">Name:</span>{" "}
          <span className="font-medium text-foreground">
            {perType.name.newIntroducedToday} new
          </span>
          {" · "}
          <span className="font-medium text-foreground">
            {perType.name.reviewsDoneToday} reviewed
          </span>
        </p>
      )}
      {evolutionEnabled && (
        <p>
          <span className="text-zinc-600 dark:text-zinc-300">Evolution:</span>{" "}
          <span className="font-medium text-foreground">
            {perType.evolution.newIntroducedToday} new
          </span>
          {" · "}
          <span className="font-medium text-foreground">
            {perType.evolution.reviewsDoneToday} reviewed
          </span>
        </p>
      )}
      {reverseEnabled && (
        <p>
          <span className="text-zinc-600 dark:text-zinc-300">Reverse:</span>{" "}
          <span className="font-medium text-foreground">
            {perType.reverse.newIntroducedToday} new
          </span>
          {" · "}
          <span className="font-medium text-foreground">
            {perType.reverse.reviewsDoneToday} reviewed
          </span>
        </p>
      )}
    </div>
  );
}

function SessionCompleteScreen({
  perType,
  nameEnabled,
  evolutionEnabled,
  reverseEnabled,
  shareText,
}: {
  perType: PerTypeTodayCounts;
  nameEnabled: boolean;
  evolutionEnabled: boolean;
  reverseEnabled: boolean;
  /** Pre-formatted share summary; null when the user hasn't graded anything yet. */
  shareText: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="text-2xl font-semibold text-foreground">All caught up!</p>
      <p className="text-zinc-500 dark:text-zinc-400">
        No more cards due today. Come back tomorrow to keep going.
      </p>
      <TodayPill perType={perType} nameEnabled={nameEnabled} evolutionEnabled={evolutionEnabled} reverseEnabled={reverseEnabled} />
      {shareText !== null ? <ShareTodayButton text={shareText} /> : null}
    </div>
  );
}

function ReviewSoftWallScreen({
  perType,
  nameEnabled,
  evolutionEnabled,
  reverseEnabled,
  onKeepReviewing,
}: {
  perType: PerTypeTodayCounts;
  nameEnabled: boolean;
  evolutionEnabled: boolean;
  reverseEnabled: boolean;
  onKeepReviewing: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <p className="text-2xl font-semibold text-foreground">Daily review limit reached</p>
      <p className="text-zinc-500 dark:text-zinc-400 max-w-xs">
        You have hit a daily review cap. More cards are due — keep going?
      </p>
      <TodayPill perType={perType} nameEnabled={nameEnabled} evolutionEnabled={evolutionEnabled} reverseEnabled={reverseEnabled} />
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          className="min-h-[44px] rounded-lg bg-zinc-100 px-8 py-2 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          onClick={() => {
            // "Done for today" — reload the page so the session resets cleanly.
            window.location.reload();
          }}
        >
          Done for today
        </button>
        <button
          type="button"
          className="min-h-[44px] rounded-lg bg-theme-accent px-8 py-2 text-sm font-semibold text-theme-fg-on-primary transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2"
          onClick={onKeepReviewing}
        >
          Keep reviewing
        </button>
      </div>
    </div>
  );
}

function NewCardsLockedScreen({
  perType,
  nameEnabled,
  evolutionEnabled,
  reverseEnabled,
}: {
  perType: PerTypeTodayCounts;
  nameEnabled: boolean;
  evolutionEnabled: boolean;
  reverseEnabled: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="text-2xl font-semibold text-foreground">New cards locked for today</p>
      <p className="text-zinc-500 dark:text-zinc-400 max-w-xs">
        You have hit a daily new-card cap. Come back tomorrow for more — keeping
        this limit prevents tomorrow&apos;s review pile from growing too large.
      </p>
      <TodayPill perType={perType} nameEnabled={nameEnabled} evolutionEnabled={evolutionEnabled} reverseEnabled={reverseEnabled} />
    </div>
  );
}

function CountdownScreen({
  dueAt,
  perType,
  nameEnabled,
  evolutionEnabled,
  reverseEnabled,
}: {
  dueAt: number;
  perType: PerTypeTodayCounts;
  nameEnabled: boolean;
  evolutionEnabled: boolean;
  reverseEnabled: boolean;
}) {
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
      <p className="text-2xl font-semibold text-foreground">Next card in</p>
      <p
        className="text-4xl font-bold tabular-nums text-foreground"
        aria-live="polite"
        aria-atomic="true"
      >
        {formatCountdown(remaining)}
      </p>
      <p className="text-zinc-500 dark:text-zinc-400 max-w-xs">
        Hang tight — a learning card will be ready shortly.
      </p>
      <TodayPill perType={perType} nameEnabled={nameEnabled} evolutionEnabled={evolutionEnabled} reverseEnabled={reverseEnabled} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReviewSession() {
  // null = SSR / not-yet-hydrated. Same pattern as before.
  const [cards, setCards] = useState<ReviewableCard[] | null>(null);
  const [limits, setLimits] = useState<DailyLimits>(DEFAULT_LIMITS);
  const [reverseEnabled, setReverseEnabled] = useState(false);
  const [reverseEvolutionEnabled, setReverseEvolutionEnabled] = useState(false);
  const [nameCardsEnabled, setNameCardsEnabled] = useState(true);
  const [evolutionCardsEnabled, setEvolutionCardsEnabled] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);
  // Transient flag: user chose "Keep reviewing" at the soft wall.
  // Not persisted — resets on every page load by design.
  const [extendedReview, setExtendedReview] = useState(false);

  // Fact shown after card reveal — randomised on each reveal.
  const [currentFact, setCurrentFact] = useState<PokemonFact | null>(null);

  // In-memory learning queue: cards currently in a learning or relearning step.
  // Initialized at mount from learningCardIds; updated on every grade.
  const [learningQueue, setLearningQueue] = useState<LearningQueueEntry[]>([]);

  // Live session grade tally — resets on page navigation by design. Labelled
  // "this session" in the UI to set expectations.
  const [sessionGrades, setSessionGrades] = useState<Record<Grade, number>>({ 1: 0, 2: 0, 4: 0, 5: 0 });
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
  // Queue of newly-earned badges awaiting their reveal toast (#420). One is
  // rendered at a time; dismiss shifts the head off. Persisting is handled
  // in handleGrade — this queue only drives the in-session UI.
  const [pendingBadgeToasts, setPendingBadgeToasts] = useState<BadgeDefinition[]>([]);
  // Render the head of the queue — `position: fixed` on the toast itself, so
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

  function handleScopeChange(next: PracticeScope) {
    setScope(next);
    // Persist scope through user settings so it syncs cross-device (#333).
    // Read the latest settings before patching to avoid clobbering other
    // fields that may have been updated since this component mounted.
    const current = loadSettings();
    saveSettings({ ...current, practiceScope: next });
    // Recompute eligibility from the new scope against the current card
    // set + apply snooze reconciliation so hiddenSince / dueDate updates
    // are durable. Persist if any card mutated.
    if (cards !== null) {
      const today = todayString(new Date());
      reconcileHiddenState(cards, next, today);
      const eligibleIds = isScopeEmpty(next)
        ? new Set(cards.map((c) => c.id))
        : new Set(
            cards.filter((c) => cardMatchesScope(c, next)).map((c) => c.id),
          );
      setEligibleCardIds(eligibleIds);
      notifySaveResult(saveSession({ cards, limits }));
    }
  }

  // Single-step undo: snapshot of pre-grade state. Captured in handleGrade
  // and consumed by handleUndo. Cleared when the next grade fires.
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);

  const { quotaExceeded, dismiss, notifySaveResult } = useStorageQuota();

  // Ref for the timeout that fires when the earliest pending learning card is due.
  const countdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Locks the card the user clicked Reveal on so a learning-queue re-render
  // can't swap it out before the user submits a grade.
  const revealedCardId = useRef<number | null>(null);
  // Sync: per-grade debounced upserts (primary path) + unload safety-net.
  const { user, supabase } = useAuth();
  const { anyFlagOn: superuserGuarded } = useSuperuser();
  // When any superuser flag is on, suppress cloud writes by treating sync as
  // signed-out. Per-grade enqueue, debounced drain, and unload sendBeacon all
  // short-circuit on null client/userId. Background pulls (SyncOnVisible /
  // SignInPull) keep running so local stays consistent with cloud.
  const syncClient = superuserGuarded ? null : supabase;
  const syncUserId = superuserGuarded ? null : user?.id ?? null;
  const { enqueueGrade, flushPending } = usePerGradeSync(syncClient, syncUserId);
  useSyncOnUnload(syncClient, syncUserId, flushPending);

  // Derive seen Pokémon once per cards change — used by the mini-game on the
  // SESSION_COMPLETE screen. Must stay unconditional (hooks rule).
  const seenPokemon = useMemo(
    () => (cards !== null ? getSeenPokemon(cards, SEED_POKEMON) : []),
    [cards],
  );

  useEffect(() => {
    const settings = loadSettings();
    const saved = loadSession();
    const now = new Date();
    let sessionCards: ReviewableCard[];
    let sessionLimits: DailyLimits;

    const enabled = settings.reverseCardsEnabled;
    const nameEnabled = settings.nameCardsEnabled;
    const evolutionEnabled = settings.evolutionCardsEnabled;
    const reverseEvolutionEnabledLocal = settings.reverseEvolutionCardsEnabled;
    const cryEnabled = settings.cryCardsEnabled;

    // poke-memory:settings:v1 is the source of truth for limits.
    // saved.limits (from the session) is intentionally ignored — settings
    // take effect on the next page load, which is the definition of "next session".
    const settingsLimits = limitsFromSettings(settings);

    if (saved !== null) {
      // Merge any seed cards added since the last save.
      const hydrated = hydrateSession(
        saved.cards,
        SEED_POKEMON,
        SEED_EVOLUTION_CARDS,
        now,
        {
          reverseEnabled: enabled,
          nameEnabled,
          evolutionEnabled,
          reverseEvolutionEnabled: reverseEvolutionEnabledLocal,
          cryEnabled,
        },
      );
      sessionLimits = settingsLimits;
      if (hydrated.length !== saved.cards.length) {
        notifySaveResult(saveSession({ cards: hydrated, limits: sessionLimits }));
      }
      sessionCards = hydrated;
    } else {
      const fresh = buildSession(SEED_POKEMON, SEED_EVOLUTION_CARDS, now, {
        reverseEnabled: enabled,
        nameEnabled,
        evolutionEnabled,
        reverseEvolutionEnabled: reverseEvolutionEnabledLocal,
        cryEnabled,
      });
      notifySaveResult(saveSession({ cards: fresh, limits: settingsLimits }));
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
      notifySaveResult(saveSession({ cards: sessionCards, limits: sessionLimits }));
    }

    // --- Scope load + snooze reconciliation (#333) -------------------------
    // Scope now persists in user settings (synced cross-device). Reconcile
    // each card's hiddenSince/dueDate against the current scope before the
    // queue builder sees it; persist any state changes (set/clear of
    // hiddenSince and any forward-shift of dueDate on un-hide).
    const persistedScope = settings.practiceScope;
    const today = todayString(now);
    reconcileHiddenState(sessionCards, persistedScope, today);
    const eligibleIds = isScopeEmpty(persistedScope)
      ? new Set(sessionCards.map((c) => c.id))
      : new Set(
          sessionCards.filter((c) => cardMatchesScope(c, persistedScope)).map((c) => c.id),
        );
    // Persist whenever scope is active so reconciliation results survive a
    // reload. When scope is empty, the only thing reconcileHiddenState can do
    // is clear stale hiddenSince — still worth persisting if any cleared.
    notifySaveResult(saveSession({ cards: sessionCards, limits: sessionLimits }));

    setCards(sessionCards);
    setLimits(sessionLimits);
    setReverseEnabled(enabled);
    setReverseEvolutionEnabled(reverseEvolutionEnabledLocal);
    setNameCardsEnabled(nameEnabled);
    setEvolutionCardsEnabled(evolutionEnabled);
    setScope(persistedScope);
    setEligibleCardIds(eligibleIds);

    // Initialize the learning queue from persisted learning-step cards.
    // Use stepStartedAt from persisted state so the countdown resumes correctly
    // after navigation instead of resetting to the full step duration.
    const { learningCardIds } = buildSessionQueues(sessionCards, sessionLimits, today);

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
  // notifySaveResult is stable (useCallback with no deps). The dep is listed to
  // satisfy the linter, but this effect is intentionally one-shot (mount only).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifySaveResult]);

  // Reload when settings change in another tab so reverseEnabled and limits stay current.
  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === "poke-memory:settings:v1") {
        window.location.reload();
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // Schedule a timeout to re-render when the earliest pending learning card is due.
  // Re-runs whenever learningQueue changes.
  useEffect(() => {
    if (countdownTimeoutRef.current !== null) {
      clearTimeout(countdownTimeoutRef.current);
      countdownTimeoutRef.current = null;
    }

    const now = Date.now();
    const futureDue = learningQueue.filter((e) => e.dueAt > now);
    if (futureDue.length === 0) return;

    const earliest = Math.min(...futureDue.map((e) => e.dueAt));
    const delay = Math.max(0, earliest - now);

    countdownTimeoutRef.current = setTimeout(() => {
      countdownTimeoutRef.current = null;
      // Force a re-render so the now-due learning card is picked up. Bumping
      // a fresh array reference re-runs this effect, which is harmless: the
      // newly-due entry is filtered out of `futureDue`, and any remaining
      // future entries chain onto the next setTimeout.
      setLearningQueue((q) => [...q]);
    }, delay);

    return () => {
      if (countdownTimeoutRef.current !== null) {
        clearTimeout(countdownTimeoutRef.current);
        countdownTimeoutRef.current = null;
      }
    };
  }, [learningQueue]);

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
      if (undoSnapshot === null || grading) return;
      if (
        (e.key === "z" || e.key === "Z") &&
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey
      ) {
        e.preventDefault();
        // Inline so the effect can be declared above all the function
        // definitions later in the component.
        setCards(undoSnapshot.cards);
        setSessionGrades(undoSnapshot.sessionGrades);
        setSessionGradeSeq(undoSnapshot.sessionGradeSeq);
        setNewCardsThisSession(undoSnapshot.newCardsThisSession);
        setMasteredThisSession(undoSnapshot.masteredThisSession);
        setLearningQueue(undoSnapshot.learningQueue);
        notifySaveResult(saveSession({ cards: undoSnapshot.cards, limits }));
        if (undoSnapshot.gradeLogOccurredAt !== null) {
          removeGradeEntry(undoSnapshot.gradeLogOccurredAt);
        }
        revealedCardId.current = undoSnapshot.cardId;
        setRevealed(true);
        setUndoSnapshot(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // notifySaveResult and limits are stable inside the same render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoSnapshot, grading, limits]);

  // --- Loading skeleton (SSR + first client tick) ---
  if (cards === null) {
    return (
      <div
        className="flex flex-col items-center gap-6 animate-pulse"
        aria-busy="true"
        aria-label="Loading review session"
      >
        <div className="w-[320px] h-[320px] rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-10 w-40 rounded-md bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-11 w-32 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </div>
    );
  }

  // --- All card types disabled ---
  if (
    !nameCardsEnabled &&
    !evolutionCardsEnabled &&
    !reverseEnabled &&
    !reverseEvolutionEnabled
  ) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-2xl font-semibold text-foreground">No card types enabled</p>
        <p className="text-zinc-500 dark:text-zinc-400 max-w-xs">
          Enable at least one card type in{" "}
          <a href="/settings" className="underline text-foreground">Settings</a>{" "}
          to start reviewing.
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
        <p className="text-2xl font-semibold text-foreground">No Pokémon match your scope</p>
        <p className="text-zinc-500 dark:text-zinc-400 max-w-xs">
          Adjust the filter above, or clear it to keep practising.
        </p>
        <button
          type="button"
          onClick={() => handleScopeChange(EMPTY_SCOPE)}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          Clear scope
        </button>
      </div>
    );
  }

  // --- Derived state (recomputed every render — cheap, pure) ---
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
  // (`newIntroducedToday`, `reviewsDoneToday`) still see the full card set —
  // changing scope mid-day cannot reset daily caps (#333). Out-of-scope cards
  // are snoozed by `reconcileHiddenState` at session-load time, so their
  // dueDate doesn't drift while they're hidden.
  const { reviewQueue, newQueue, perType, learningCardIds } = buildSessionQueues(
    cards,
    effectiveLimits,
    today,
    isScopeEmpty(scope) ? undefined : eligibleCardIds,
  );

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
    // empty (matches Anki's default 20-minute learn-ahead behavior).
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

  // If the user has clicked Reveal, lock that card for the duration of the
  // grading window. A learning-queue setTimeout may fire mid-session and flip
  // currentCardId to the now-due learning card; without this lock the grade
  // buttons would show for the wrong card.
  const lockedCard =
    revealed && revealedCardId.current !== null
      ? (cards.find((c) => c.id === revealedCardId.current) ?? null)
      : null;
  const effectiveCard = lockedCard ?? currentCard;

  // Per-button interval previews — computed for every render (O(1) per grade, cheap).
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
    // Compare by limit bucket, not raw cardType — reverse-evolution cards
    // count under "evolution" so the wall-detection matches the per-type
    // counters in `perType`.
    function hasMoreDueReviewsOf(type: "name" | "evolution" | "reverse"): boolean {
      // Mirror the candidate filter in buildSessionQueues — cards in a
      // learning/relearning step are served via the in-memory learning
      // queue, not the review queue, and must not count toward "more due
      // reviews exist" or the soft-wall would fire spuriously.
      return cards!.some(
        (c) =>
          limitBucket(c.cardType) === type &&
          c.state.learningStep === null &&
          c.state.lastReview !== null &&
          c.state.dueDate <= today &&
          c.state.lastReview !== today,
      );
    }
    function hasMoreNewCardsOf(type: "name" | "evolution" | "reverse"): boolean {
      return cards!.some(
        (c) =>
          limitBucket(c.cardType) === type &&
          c.state.lastReview === null &&
          c.state.learningStep === null,
      );
    }

    const reviewWall = (["name", "evolution", "reverse"] as const).some(
      (type) =>
        perType[type].reviewsDoneToday >= limits[type].maxReviewsPerDay &&
        hasMoreDueReviewsOf(type),
    );
    if (!extendedReview && reviewWall) return "REVIEW_SOFT_WALL";

    const newWall = (["name", "evolution", "reverse"] as const).some(
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
          <div className="flex flex-col items-center gap-6">
            <QueueCounterRow newCount={newCount} learningCount={learningCount} reviewCount={reviewCount} />
        {undoSnapshot !== null && (
          <button
            type="button"
            onClick={handleUndo}
            className="min-h-[36px] rounded-lg border border-zinc-300 px-4 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            aria-label="Undo last grade"
          >
            Undo last grade (⌘Z)
          </button>
        )}
            <CountdownScreen
              dueAt={earliestDueAt}
              perType={perType}
              nameEnabled={nameCardsEnabled}
              evolutionEnabled={evolutionCardsEnabled}
              reverseEnabled={reverseEnabled}
            />
          </div>
        );
      }
      // futureLearning is empty: all entries are overdue. Overdue entries
      // populate dueLearning → currentLearningEntry → a non-null effectiveCard,
      // so reaching this branch with effectiveCard === null is unreachable.
      // Fall through to resolveEndState() safely.
    }

    const endState = resolveEndState();

    if (endState === "REVIEW_SOFT_WALL") {
      return (
        <div className="flex flex-col items-center w-full">
          <ReviewSoftWallScreen
            perType={perType}
            nameEnabled={nameCardsEnabled}
            evolutionEnabled={evolutionCardsEnabled}
            reverseEnabled={reverseEnabled}
            onKeepReviewing={() => setExtendedReview(true)}
          />
          {seenPokemon.length >= 2 && (
            <HigherOrLowerGame seenPokemon={seenPokemon} />
          )}
          {badgeToastSlot}
        </div>
      );
    }

    if (endState === "NEW_CARDS_LOCKED") {
      return (
        <div className="flex flex-col items-center w-full">
          <NewCardsLockedScreen perType={perType} nameEnabled={nameCardsEnabled} evolutionEnabled={evolutionCardsEnabled} reverseEnabled={reverseEnabled} />
          {seenPokemon.length >= 2 && (
            <HigherOrLowerGame seenPokemon={seenPokemon} />
          )}
          {badgeToastSlot}
        </div>
      );
    }

    const today = todayString(new Date());
    const shareText =
      sessionGradeSeq.length > 0
        ? formatDailySummary({
            date: today,
            streak: computeStreak(loadStreakData(), today),
            reviewed: sessionGradeSeq.length,
            newCards: newCardsThisSession,
            mastered: masteredThisSession,
            gradeSequence: sessionGradeSeq,
          })
        : null;
    return (
      <div className="flex flex-col items-center w-full">
        <SessionCompleteScreen
          perType={perType}
          nameEnabled={nameCardsEnabled}
          evolutionEnabled={evolutionCardsEnabled}
          reverseEnabled={reverseEnabled}
          shareText={shareText}
        />
        {seenPokemon.length >= 2 && (
          <HigherOrLowerGame seenPokemon={seenPokemon} />
        )}
        {badgeToastSlot}
      </div>
    );
  }

  // --- Handlers ---

  function handleReveal() {
    if (currentCard === null) return;
    if (currentCard.cardType === "name") {
      const facts = getPokemonFacts(currentCard);
      setCurrentFact(selectFact(facts));
    } else if (currentCard.cardType === "evolution") {
      const evoPokemon = SEED_POKEMON.find((p) => p.id === currentCard.postEvoId);
      if (evoPokemon) {
        setCurrentFact(selectFact(getPokemonFacts(evoPokemon)));
      } else {
        console.warn(`[handleReveal] seed data missing for evolution target: ${currentCard.postEvoName}`);
        setCurrentFact(null);
      }
    } else if (currentCard.cardType === "reverse-evolution") {
      // Reverse direction: the answer is the pre-evo, so surface its facts.
      const preEvo = SEED_POKEMON.find((p) => p.id === currentCard.preEvoId);
      if (preEvo) {
        setCurrentFact(selectFact(getPokemonFacts(preEvo)));
      } else {
        console.warn(`[handleReveal] seed data missing for reverse-evolution source: ${currentCard.preEvoName}`);
        setCurrentFact(null);
      }
    } else {
      setCurrentFact(null);
    }
    setRevealed(true);
    revealedCardId.current = currentCard.id;
    const revealSettings = loadSettings();
    const cryOn = revealSettings.playCryOnReveal;
    const speakOn = revealSettings.speakNameOnReveal;

    // Pick the name to speak per direction (cry cards: speak the answer name; reverse
    // picker cards never reach handleReveal so they're absent here).
    let nameToSpeak: string | null = null;
    if (currentCard.cardType === "name") nameToSpeak = currentCard.name;
    else if (currentCard.cardType === "evolution") nameToSpeak = currentCard.postEvoName;
    else if (currentCard.cardType === "reverse-evolution") nameToSpeak = currentCard.preEvoName;
    else if (currentCard.cardType === "cry") nameToSpeak = currentCard.name;

    // Pick the cry URL per direction. Cry cards: the cry was the prompt, so don't
    // replay it on reveal.
    let cryUrlOnReveal: string | null = null;
    if (cryOn) {
      if (currentCard.cardType === "name") cryUrlOnReveal = currentCard.cryUrl ?? null;
      else if (currentCard.cardType === "evolution") {
        const target = SEED_POKEMON.find((p) => p.id === currentCard.postEvoId);
        cryUrlOnReveal = target?.cryUrl ?? null;
      } else if (currentCard.cardType === "reverse-evolution") {
        const target = SEED_POKEMON.find((p) => p.id === currentCard.preEvoId);
        cryUrlOnReveal = target?.cryUrl ?? null;
      }
    }

    const speakAfterCry =
      speakOn && nameToSpeak !== null ? () => speakName(nameToSpeak!) : undefined;

    // Branch on whether a cry will play. If yes, chain TTS to fire after `ended`.
    // If no cry (toggle off or no url), fall through to TTS directly so they don't
    // both fire on the same tick.
    if (cryOn && (currentCard.cardType === "name" || currentCard.cardType === "evolution" || currentCard.cardType === "reverse-evolution")) {
      playCry(cryUrlOnReveal, 0.6, speakAfterCry);
    } else if (speakOn && nameToSpeak !== null) {
      speakName(nameToSpeak);
    }
  }

  function handleGrade(grade: Grade) {
    if (effectiveCard === null || grading) return;
    // Re-narrow cards inside the closure — TS doesn't carry the outer
    // null-check through a function that captures a useState variable.
    if (cards === null) return;
    setGrading(true);

    // Snapshot the pre-grade state for single-step undo. The previous
    // snapshot (if any) is replaced — undo is one-deep, not a stack.
    const snapshot: UndoSnapshot = {
      cards,
      sessionGrades,
      sessionGradeSeq,
      newCardsThisSession,
      masteredThisSession,
      learningQueue,
      cardId: effectiveCard.id,
      gradeLogOccurredAt: null,
    };

    const now = new Date();
    const settings = loadSettings();
    const nextState = nextReview(effectiveCard.state, grade, now, {
      retentionTarget: settings.retentionTarget,
      weights: settings.fsrsWeights,
    });
    const newCards = cards.map((card) =>
      card.id === effectiveCard.id ? { ...card, state: nextState } : card,
    );

    notifySaveResult(saveSession({ cards: newCards, limits }));
    const today = todayString(now);
    const gradedToday = loadGradeLog().filter((e) => e.date === today).length + 1;
    const dueQueueEmpty = !newCards.some(
      (c) =>
        c.state.learningStep === null &&
        c.state.lastReview !== null &&
        c.state.dueDate <= today &&
        c.state.lastReview !== today,
    );
    recordReview(today, gradedToday, dueQueueEmpty);
    const appended = appendGradeEntry({ date: today, grade, cardType: effectiveCard.cardType, cardId: effectiveCard.id });
    snapshot.gradeLogOccurredAt = appended?.occurredAt ?? null;
    setUndoSnapshot(snapshot);
    enqueueGrade({ ...effectiveCard, state: nextState });
    setCards(newCards);
    setSessionGrades((prev) => ({ ...prev, [grade]: prev[grade] + 1 }));
    setSessionGradeSeq((prev) => [...prev, grade]);
    // Track new / mastered transitions for the daily share card. Uses
    // `isMastered` against the current mastery threshold.
    const wasNew = effectiveCard.state.firstSeen === null;
    if (wasNew && nextState.firstSeen !== null) {
      setNewCardsThisSession((n) => n + 1);
    }
    const wasMastered = isMastered(effectiveCard.state, loadSettings().masteryRepetitions);
    const nowMastered = isMastered(nextState, loadSettings().masteryRepetitions);
    if (!wasMastered && nowMastered) {
      setMasteredThisSession((n) => n + 1);
      // Badge award (#420). Only fires when a card just crossed the mastery
      // threshold — `checkBadges` is then O(catalog × ids-per-badge) against a
      // Set, which is cheap. Non-name directions never contribute to badge
      // criteria, so a `cry`/`reverse`/`evolution` mastery cannot earn one.
      //
      // Superuser guard: with `pretendAllMastered` on, every species is
      // already "mastered" — the first grade would award every badge and
      // persist that to localStorage. `AutoSyncOnChange` suppresses the
      // cloud write, but exit cleanup does not restore `user_settings`, so
      // the fake earned-set would survive the QA session. Skip the award
      // path entirely while any flag is on. The catalog overlay on Stats
      // continues to show all badges read-only.
      if (effectiveCard.cardType === "name" && !superuserGuarded) {
        const masteredIds = masteredSpeciesIds(
          newCards,
          settings.masteryRepetitions,
          false,
        );
        const earnedIds = new Set(settings.earnedBadges.map((b) => b.id));
        const newlyEarned = checkBadges(masteredIds, BADGE_CATALOG, earnedIds);
        if (newlyEarned.length > 0) {
          const nowIso = now.toISOString();
          const nextSettings: UserSettings = {
            ...settings,
            earnedBadges: [
              ...settings.earnedBadges,
              ...newlyEarned.map((b) => ({ id: b.id, earnedAt: nowIso })),
            ],
          };
          saveSettings(nextSettings);
          setPendingBadgeToasts((prev) => [...prev, ...newlyEarned]);
        }
      }
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
        // Card has graduated or is in a non-learning state — remove from queue.
        return prev.filter((e) => e.cardId !== effectiveCard.id);
      }
    });

    setCurrentFact(null);
    setRevealed(false);
    revealedCardId.current = null;
    setGrading(false);
  }

  function handleUndo() {
    if (undoSnapshot === null || grading) return;
    // Revert local state to the pre-grade snapshot.
    setCards(undoSnapshot.cards);
    setSessionGrades(undoSnapshot.sessionGrades);
    setSessionGradeSeq(undoSnapshot.sessionGradeSeq);
    setNewCardsThisSession(undoSnapshot.newCardsThisSession);
    setMasteredThisSession(undoSnapshot.masteredThisSession);
    setLearningQueue(undoSnapshot.learningQueue);
    notifySaveResult(saveSession({ cards: undoSnapshot.cards, limits }));
    if (undoSnapshot.gradeLogOccurredAt !== null) {
      removeGradeEntry(undoSnapshot.gradeLogOccurredAt);
    }
    // Make the undone card the current revealed card so the user lands
    // back on the prompt they just graded.
    revealedCardId.current = undoSnapshot.cardId;
    setRevealed(true);
    setUndoSnapshot(null);
  }

  // --- Active review UI ---

  // Cry cards: cry plays as the prompt; sprite + name + grade buttons
  // appear after the user taps Reveal (or the visually-merged Play tile).
  if (effectiveCard.cardType === "cry") {
    return (
      <div className="flex flex-col items-center gap-3 sm:gap-8">
        {quotaExceeded && <StorageQuotaBanner onDismiss={dismiss} />}
        <div className="flex w-full max-w-xl flex-col gap-2">
          <ScopeControl scope={scope} onChange={handleScopeChange} />
        </div>
        {revealed ? (
          <PokemonCard
            spriteUrl={effectiveCard.spriteUrl}
            name={effectiveCard.name}
            revealed
            fact={currentFact}
            direction="cry"
          />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <DirectionBadge direction="cry" />
            <button
              type="button"
              onClick={() => playCry(effectiveCard.cryUrl ?? null)}
              className="flex h-40 w-40 items-center justify-center rounded-full border-2 border-zinc-300 bg-zinc-50 text-5xl transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:border-zinc-700 dark:bg-zinc-900"
              aria-label="Play cry"
            >
              🔊
            </button>
            <p className="text-base font-semibold text-foreground">
              Name this Pokémon from its cry
            </p>
          </div>
        )}

        {revealed ? (
          <>
            <OnboardingHint id="practiceHintDismissed" title="How to grade">
              <p>
                <strong>Again</strong> — forgot. <strong>Hard</strong> —
                struggled. <strong>Good</strong> — recalled with effort.{" "}
                <strong>Easy</strong> — instant. Grade honestly; FSRS uses
                this to space your next review.
              </p>
            </OnboardingHint>
            <GradeButtons
              onGrade={handleGrade}
              disabled={grading}
              previews={gradePreviewsOrNull ?? undefined}
            />
          </>
        ) : (
          <button
            type="button"
            onClick={handleReveal}
            className="min-h-[44px] rounded-lg bg-theme-accent px-8 py-2 text-sm font-semibold text-theme-fg-on-primary transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2"
          >
            Reveal
          </button>
        )}

        <QueueCounterRow newCount={newCount} learningCount={learningCount} reviewCount={reviewCount} />
        {undoSnapshot !== null && (
          <button
            type="button"
            onClick={handleUndo}
            className="min-h-[36px] rounded-lg border border-zinc-300 px-4 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            aria-label="Undo last grade"
          >
            Undo last grade (⌘Z)
          </button>
        )}
        <GradeBreakdownBar
          again={sessionGrades[1]}
          hard={sessionGrades[2]}
          good={sessionGrades[4]}
          easy={sessionGrades[5]}
          label="This session"
          hideZeroSegments
        />
        {badgeToastSlot}
      </div>
    );
  }

  // Reverse cards use the SpritePicker (multiple-choice); no reveal step.
  if (effectiveCard.cardType === "reverse") {
    // pokemonId is set from SEED_POKEMON at session-build time, so this find
    // only fails if the seed changes under a persisted session (e.g. after a
    // seed data update). Guard against a hard crash by rendering nothing in
    // that case; the user can reload to rebuild their session.
    const reverseTarget = SEED_POKEMON.find((p) => p.id === effectiveCard.pokemonId);
    if (!reverseTarget) return null;
    const reverseDistractors = pickDistractors(
      effectiveCard.pokemonId,
      SEED_POKEMON,
      3,
      String(effectiveCard.id),
    );
    return (
      <div className="flex flex-col items-center gap-3 sm:gap-8">
        {quotaExceeded && <StorageQuotaBanner onDismiss={dismiss} />}
        <ScopeControl scope={scope} onChange={handleScopeChange} />
        <SpritePicker
          key={effectiveCard.id}
          targetPokemon={reverseTarget}
          distractors={reverseDistractors}
          onGrade={(correct) => handleGrade(correct ? 4 : 1)}
        />
        <QueueCounterRow newCount={newCount} learningCount={learningCount} reviewCount={reviewCount} />
        {undoSnapshot !== null && (
          <button
            type="button"
            onClick={handleUndo}
            className="min-h-[36px] rounded-lg border border-zinc-300 px-4 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            aria-label="Undo last grade"
          >
            Undo last grade (⌘Z)
          </button>
        )}
        <TodayPill perType={perType} nameEnabled={nameCardsEnabled} evolutionEnabled={evolutionCardsEnabled} reverseEnabled={reverseEnabled} />
        <GradeBreakdownBar
          again={sessionGrades[1]}
          hard={sessionGrades[2]}
          good={sessionGrades[4]}
          easy={sessionGrades[5]}
          label="This session"
          hideZeroSegments
        />
        {badgeToastSlot}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 sm:gap-8">
      {quotaExceeded && <StorageQuotaBanner onDismiss={dismiss} />}
      <ScopeControl scope={scope} onChange={handleScopeChange} />
      {effectiveCard.cardType === "evolution" ? (
        <EvolutionCard
          preEvoSpriteUrl={effectiveCard.preEvoSpriteUrl}
          preEvoName={effectiveCard.preEvoName}
          postEvoName={effectiveCard.postEvoName}
          postEvoSpriteUrl={effectiveCard.postEvoSpriteUrl}
          triggerPhrase={effectiveCard.triggerPhrase}
          revealed={revealed}
          fact={currentFact}
        />
      ) : effectiveCard.cardType === "reverse-evolution" ? (
        <ReverseEvolutionCard
          preEvoName={effectiveCard.preEvoName}
          preEvoSpriteUrl={effectiveCard.preEvoSpriteUrl}
          postEvoName={effectiveCard.postEvoName}
          postEvoSpriteUrl={effectiveCard.postEvoSpriteUrl}
          triggerPhrase={effectiveCard.triggerPhrase}
          revealed={revealed}
          fact={currentFact}
        />
      ) : (
        <PokemonCard
          spriteUrl={effectiveCard.spriteUrl}
          name={effectiveCard.name}
          revealed={revealed}
          fact={currentFact}
        />
      )}

      {revealed ? (
        <>
          <OnboardingHint id="practiceHintDismissed" title="How to grade">
            <p>
              <strong>Again</strong> — forgot. <strong>Hard</strong> —
              struggled. <strong>Good</strong> — recalled with effort.{" "}
              <strong>Easy</strong> — instant. Grade honestly; FSRS uses
              this to space your next review.
            </p>
          </OnboardingHint>
          <GradeButtons
            onGrade={handleGrade}
            disabled={grading}
            previews={gradePreviewsOrNull ?? undefined}
          />
        </>
      ) : (
        <button
          type="button"
          onClick={handleReveal}
          className="min-h-[44px] rounded-lg bg-theme-accent px-8 py-2 text-sm font-semibold text-theme-fg-on-primary transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2"
        >
          Reveal
        </button>
      )}

      <QueueCounterRow newCount={newCount} learningCount={learningCount} reviewCount={reviewCount} />
      <TodayPill perType={perType} nameEnabled={nameCardsEnabled} evolutionEnabled={evolutionCardsEnabled} reverseEnabled={reverseEnabled} />
      <GradeBreakdownBar
        again={sessionGrades[1]}
        hard={sessionGrades[2]}
        good={sessionGrades[4]}
        easy={sessionGrades[5]}
        label="This session"
      />
      {badgeToastSlot}
    </div>
  );
}
