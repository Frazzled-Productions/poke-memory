"use client";

import { useEffect, useState } from "react";
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
import { nextReview } from "@/lib/srs/scheduler";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EndState = "SESSION_COMPLETE" | "REVIEW_SOFT_WALL" | "NEW_CARDS_LOCKED";

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

  useEffect(() => {
    const saved = loadSession();
    if (saved !== null) {
      // Merge any seed cards added since the last save.
      const hydrated = hydrateSession(saved.cards, SEED_POKEMON);
      const newLimits = saved.limits;
      if (hydrated.length !== saved.cards.length) {
        saveSession({ cards: hydrated, limits: newLimits });
      }
      setCards(hydrated);
      setLimits(newLimits);
    } else {
      const fresh = buildSession(SEED_POKEMON);
      saveSession({ cards: fresh, limits: DEFAULT_LIMITS });
      setCards(fresh);
      setLimits(DEFAULT_LIMITS);
    }
  }, []);

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

  // Cursor-free approach: always read from position 0.
  // A card that was just graded sets lastReview=today, so it drops out of
  // both queues on the next render naturally.
  const currentCardId = getNextCardId(reviewQueue, newQueue);
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

    const hasMoreNewCards = cards!.some((c) => c.state.lastReview === null);

    if (newIntroducedToday >= limits.maxNewPerDay && hasMoreNewCards) {
      return "NEW_CARDS_LOCKED";
    }

    return "SESSION_COMPLETE";
  }

  if (currentCard === null) {
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
    setRevealed(true);
  }

  function handleGrade(grade: Grade) {
    if (currentCard === null || grading) return;
    // Re-narrow cards inside the closure — TS doesn't carry the outer
    // null-check through a function that captures a useState variable.
    if (cards === null) return;
    setGrading(true);

    const newState = nextReview(currentCard.state, grade, new Date());
    const newCards = cards.map((card) =>
      card.id === currentCard.id ? { ...card, state: newState } : card,
    );

    saveSession({ cards: newCards, limits });
    setCards(newCards);
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
