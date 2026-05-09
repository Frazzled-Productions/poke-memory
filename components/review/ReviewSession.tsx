"use client";

import { useEffect, useRef, useState } from "react";
import { PokemonCard } from "@/components/review/PokemonCard";
import { GradeButtons } from "@/components/review/GradeButtons";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import {
  buildSession,
  buildSessionQueues,
  getNextCardId,
  hydrateSession,
  todayString,
  type DailyLimits,
  type ReviewCard,
  type Grade,
  DEFAULT_LIMITS,
} from "@/lib/review/session";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { recordReview } from "@/lib/streak";
import { nextReview } from "@/lib/srs/scheduler";
import { LEARNING_STEPS_MS, RELEARNING_STEPS_MS } from "@/lib/srs/constants";
import { getPokemonFacts, selectFact, type PokemonFact } from "@/lib/pokemon/facts";
import { useSession } from "next-auth/react";
import { saveCloudSync } from "@/lib/sync/actions";
import { loadStreakData } from "@/lib/streak/persistence";
import { loadSettings } from "@/lib/settings/persistence";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EndState = "SESSION_COMPLETE" | "REVIEW_SOFT_WALL" | "NEW_CARDS_LOCKED";

type LearningQueueEntry = { cardId: number; dueAt: number };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stepDurationMs(lastReview: string | null, stepIndex: number): number {
  const steps =
    lastReview === null ? LEARNING_STEPS_MS : RELEARNING_STEPS_MS;
  return steps[Math.min(stepIndex, steps.length - 1)];
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

function TodayPill({
  newIntroducedToday,
  reviewsDoneToday,
}: {
  newIntroducedToday: number;
  reviewsDoneToday: number;
}) {
  return (
    <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
      Today:{" "}
      <span className="font-medium text-foreground">{newIntroducedToday} new</span>
      {" · "}
      <span className="font-medium text-foreground">{reviewsDoneToday} reviews</span>
    </p>
  );
}

function SessionCompleteScreen({
  newIntroducedToday,
  reviewsDoneToday,
}: {
  newIntroducedToday: number;
  reviewsDoneToday: number;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="text-2xl font-semibold text-foreground">All caught up!</p>
      <p className="text-zinc-500 dark:text-zinc-400">
        No more cards due today. Come back tomorrow to keep going.
      </p>
      <TodayPill
        newIntroducedToday={newIntroducedToday}
        reviewsDoneToday={reviewsDoneToday}
      />
    </div>
  );
}

function ReviewSoftWallScreen({
  newIntroducedToday,
  reviewsDoneToday,
  onKeepReviewing,
}: {
  newIntroducedToday: number;
  reviewsDoneToday: number;
  onKeepReviewing: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <p className="text-2xl font-semibold text-foreground">Daily review limit reached</p>
      <p className="text-zinc-500 dark:text-zinc-400 max-w-xs">
        You have hit your daily review cap. More cards are due — keep going?
      </p>
      <TodayPill
        newIntroducedToday={newIntroducedToday}
        reviewsDoneToday={reviewsDoneToday}
      />
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
          className="min-h-[44px] rounded-lg bg-foreground px-8 py-2 text-sm font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
          onClick={onKeepReviewing}
        >
          Keep reviewing
        </button>
      </div>
    </div>
  );
}

function NewCardsLockedScreen({
  newIntroducedToday,
  reviewsDoneToday,
}: {
  newIntroducedToday: number;
  reviewsDoneToday: number;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="text-2xl font-semibold text-foreground">New cards locked for today</p>
      <p className="text-zinc-500 dark:text-zinc-400 max-w-xs">
        You have introduced your daily limit of new Pokémon. Come back tomorrow
        for more — keeping this limit prevents tomorrow&apos;s review pile from growing too large.
      </p>
      <TodayPill
        newIntroducedToday={newIntroducedToday}
        reviewsDoneToday={reviewsDoneToday}
      />
    </div>
  );
}

function CountdownScreen({
  dueAt,
  newIntroducedToday,
  reviewsDoneToday,
}: {
  dueAt: number;
  newIntroducedToday: number;
  reviewsDoneToday: number;
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
      <TodayPill
        newIntroducedToday={newIntroducedToday}
        reviewsDoneToday={reviewsDoneToday}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReviewSession() {
  // null = SSR / not-yet-hydrated. Same pattern as before.
  const [cards, setCards] = useState<ReviewCard[] | null>(null);
  const [limits, setLimits] = useState<DailyLimits>(DEFAULT_LIMITS);
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

  // Ref for the timeout that fires when the earliest pending learning card is due.
  const countdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether we have already pushed to cloud in this session (avoid repeat pushes).
  const hasPushedRef = useRef<boolean>(false);

  const { status: sessionStatus } = useSession();

  useEffect(() => {
    const saved = loadSession();
    let sessionCards: ReviewCard[];
    let sessionLimits: DailyLimits;

    // poke-memory:settings:v1 is the source of truth for limits.
    // saved.limits (from the session) is intentionally ignored — settings
    // take effect on the next page load, which is the definition of "next session".
    const { maxNewPerDay, maxReviewsPerDay } = loadSettings();
    const settingsLimits = { maxNewPerDay, maxReviewsPerDay };

    if (saved !== null) {
      // Merge any seed cards added since the last save.
      const hydrated = hydrateSession(saved.cards, SEED_POKEMON);
      sessionLimits = settingsLimits;
      if (hydrated.length !== saved.cards.length) {
        saveSession({ cards: hydrated, limits: sessionLimits });
      }
      sessionCards = hydrated;
    } else {
      const fresh = buildSession(SEED_POKEMON);
      saveSession({ cards: fresh, limits: settingsLimits });
      sessionCards = fresh;
      sessionLimits = settingsLimits;
    }

    setCards(sessionCards);
    setLimits(sessionLimits);

    // Initialize the learning queue from persisted learning-step cards.
    // Use stepStartedAt from persisted state so the countdown resumes correctly
    // after navigation instead of resetting to the full step duration.
    const today = todayString(new Date());
    const { learningCardIds } = buildSessionQueues(sessionCards, sessionLimits, today);

    const initialLearning: LearningQueueEntry[] = learningCardIds.map((cardId) => {
      const card = sessionCards.find((c) => c.id === cardId)!;
      const stepMs = stepDurationMs(
        card.state.lastReview,
        card.state.learningStep ?? 0,
      );
      const stepStartedAt = card.state.stepStartedAt;
      const dueAt = stepStartedAt !== null
        ? stepStartedAt + stepMs
        : Date.now(); // legacy migrated card — no start time recorded, treat as immediately due
      return { cardId, dueAt };
    });

    setLearningQueue(initialLearning);
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

  // --- Push to cloud on session end ---
  // Fires whenever cards or learningQueue change (i.e. after each grade).
  // Checks whether there is an active card; if not, this is an end state and we push.
  // Uses a ref guard so we only push once per session end (not on every re-render).
  useEffect(() => {
    if (cards === null) return;
    if (sessionStatus !== "authenticated") return;

    // Compute whether a card is currently active using the same logic as the render path.
    const todayVal = todayString(new Date());
    const effectiveLimitsForEffect: DailyLimits = extendedReview
      ? { ...limits, maxReviewsPerDay: Number.POSITIVE_INFINITY }
      : limits;
    const { reviewQueue: rq, newQueue: nq } = buildSessionQueues(cards, effectiveLimitsForEffect, todayVal);
    const nowMs = Date.now();
    const dueLearningForEffect = learningQueue
      .filter((e) => e.dueAt <= nowMs)
      .sort((a, b) => a.dueAt - b.dueAt);
    const activeLearningEntry = dueLearningForEffect.length > 0 ? dueLearningForEffect[0] : null;
    const activeCardId = activeLearningEntry !== null ? activeLearningEntry.cardId : getNextCardId(rq, nq);

    if (activeCardId !== null) {
      hasPushedRef.current = false;
      return;
    }

    // Mirror render path: CountdownScreen is showing when future-due learning cards exist.
    if (learningQueue.some((e) => e.dueAt > nowMs)) {
      hasPushedRef.current = false;
      return;
    }

    // End state reached. Push once.
    if (hasPushedRef.current) return;
    hasPushedRef.current = true;

    void (async () => {
      try {
        const streak = loadStreakData();
        const settings = loadSettings();
        const saved = loadSession();
        if (saved === null) return;
        await saveCloudSync({
          session: saved,
          streak,
          settings,
          syncedAt: new Date().toISOString(),
        });
      } catch {
        hasPushedRef.current = false;
      }
    })();
  }, [cards, extendedReview, learningQueue, limits, sessionStatus]);
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

  // --- Derived state (recomputed every render — cheap, pure) ---
  const today = todayString(new Date());

  // While extendedReview is active, uncap the review limit so all due cards
  // are visible. Uncapping new cards is not allowed (per srs-expert policy).
  const effectiveLimits: DailyLimits = extendedReview
    ? { ...limits, maxReviewsPerDay: Number.POSITIVE_INFINITY }
    : limits;

  const { reviewQueue, newQueue, newIntroducedToday, reviewsDoneToday } =
    buildSessionQueues(cards, effectiveLimits, today);

  // --- Learning-queue priority ---
  const now = Date.now();
  const dueLearning = learningQueue
    .filter((e) => e.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt);

  const currentLearningEntry = dueLearning.length > 0 ? dueLearning[0] : null;

  // Resolve the current card: learning first, then review/new.
  let currentCardId: number | null;
  if (currentLearningEntry !== null) {
    currentCardId = currentLearningEntry.cardId;
  } else {
    currentCardId = getNextCardId(reviewQueue, newQueue);
  }

  const currentCard =
    currentCardId !== null ? cards.find((c) => c.id === currentCardId) ?? null : null;

  // --- Determine end state when there is no current card ---
  function resolveEndState(): EndState {
    // Check whether there are more review candidates beyond today's cap.
    const hasMoreDueReviews = cards!.some(
      (c) =>
        c.state.lastReview !== null &&
        c.state.dueDate <= today &&
        c.state.lastReview !== today,
    );

    if (
      !extendedReview &&
      reviewsDoneToday >= limits.maxReviewsPerDay &&
      hasMoreDueReviews
    ) {
      return "REVIEW_SOFT_WALL";
    }

    // Only count truly-new cards (never touched). A card already in new-card
    // learning has lastReview === null but learningStep !== null, and is
    // tracked by the learning queue, not by the new-cards-locked screen.
    const hasMoreNewCards = cards!.some(
      (c) => c.state.lastReview === null && c.state.learningStep === null,
    );

    if (newIntroducedToday >= limits.maxNewPerDay && hasMoreNewCards) {
      return "NEW_CARDS_LOCKED";
    }

    return "SESSION_COMPLETE";
  }

  if (currentCard === null) {
    // If there are pending (future-due) learning cards, show the countdown.
    if (learningQueue.length > 0) {
      const earliestDueAt = Math.min(...learningQueue.map((e) => e.dueAt));
      return (
        <CountdownScreen
          dueAt={earliestDueAt}
          newIntroducedToday={newIntroducedToday}
          reviewsDoneToday={reviewsDoneToday}
        />
      );
    }

    const endState = resolveEndState();

    if (endState === "REVIEW_SOFT_WALL") {
      return (
        <ReviewSoftWallScreen
          newIntroducedToday={newIntroducedToday}
          reviewsDoneToday={reviewsDoneToday}
          onKeepReviewing={() => setExtendedReview(true)}
        />
      );
    }

    if (endState === "NEW_CARDS_LOCKED") {
      return (
        <NewCardsLockedScreen
          newIntroducedToday={newIntroducedToday}
          reviewsDoneToday={reviewsDoneToday}
        />
      );
    }

    return (
      <SessionCompleteScreen
        newIntroducedToday={newIntroducedToday}
        reviewsDoneToday={reviewsDoneToday}
      />
    );
  }

  // --- Handlers ---

  function handleReveal() {
    if (currentCard === null) return;
    const facts = getPokemonFacts(currentCard);
    setCurrentFact(selectFact(facts));
    setRevealed(true);
  }

  function handleGrade(grade: Grade) {
    if (currentCard === null || grading) return;
    // Re-narrow cards inside the closure — TS doesn't carry the outer
    // null-check through a function that captures a useState variable.
    if (cards === null) return;
    setGrading(true);

    const now = new Date();
    const nextState = nextReview(currentCard.state, grade, now);
    const newCards = cards.map((card) =>
      card.id === currentCard.id ? { ...card, state: nextState } : card,
    );

    saveSession({ cards: newCards, limits });
    recordReview(todayString(now));
    setCards(newCards);

    // Update the learning queue based on the new state.
    setLearningQueue((prev) => {
      if (nextState.learningStep !== null) {
        // Card is in (or remains in) a learning/relearning step.
        // Distinction: new-card learning has lastReview === null after grading.
        const stepMs = stepDurationMs(nextState.lastReview, nextState.learningStep);
        const newEntry: LearningQueueEntry = {
          cardId: currentCard.id,
          dueAt: nextState.stepStartedAt! + stepMs,
        };

        // Replace existing entry or add new one.
        const exists = prev.some((e) => e.cardId === currentCard.id);
        if (exists) {
          return prev.map((e) =>
            e.cardId === currentCard.id ? newEntry : e,
          );
        }
        return [...prev, newEntry];
      } else {
        // Card has graduated or is in a non-learning state — remove from queue.
        return prev.filter((e) => e.cardId !== currentCard.id);
      }
    });

    setCurrentFact(null);
    setRevealed(false);
    setGrading(false);
  }

  // --- Active review UI ---
  return (
    <div className="flex flex-col items-center gap-8">
      <PokemonCard
        spriteUrl={currentCard.spriteUrl}
        name={currentCard.name}
        revealed={revealed}
        fact={currentFact}
      />

      {revealed ? (
        <GradeButtons onGrade={handleGrade} disabled={grading} />
      ) : (
        <button
          type="button"
          onClick={handleReveal}
          className="min-h-[44px] rounded-lg bg-foreground px-8 py-2 text-sm font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
        >
          Reveal
        </button>
      )}

      <TodayPill
        newIntroducedToday={newIntroducedToday}
        reviewsDoneToday={reviewsDoneToday}
      />
    </div>
  );
}
