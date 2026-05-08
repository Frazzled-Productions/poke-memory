"use client";

import { useEffect, useState } from "react";
import { PokemonCard } from "@/components/review/PokemonCard";
import { GradeButtons } from "@/components/review/GradeButtons";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import {
  buildSession,
  getNextDueCard,
  type ReviewCard,
  type Grade,
} from "@/lib/review/session";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { nextReview } from "@/lib/srs/scheduler";

export function ReviewSession() {
  // null means "not yet initialised" (SSR + first client tick).
  const [cards, setCards] = useState<ReviewCard[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);

  useEffect(() => {
    const saved = loadSession();
    if (saved !== null) {
      setCards(saved);
    } else {
      const fresh = buildSession(SEED_POKEMON);
      saveSession(fresh);
      setCards(fresh);
    }
  }, []);

  // --- Loading skeleton (server render + first client tick) ---
  if (cards === null) {
    return (
      <div className="flex flex-col items-center gap-6 animate-pulse" aria-busy="true" aria-label="Loading review session">
        <div className="w-[320px] h-[320px] rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-10 w-40 rounded-md bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-11 w-32 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </div>
    );
  }

  const currentCard = getNextDueCard(cards, new Date());

  // --- All caught up ---
  if (currentCard === undefined) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-2xl font-semibold text-foreground">All caught up!</p>
        <p className="text-zinc-500 dark:text-zinc-400">Come back later to review more Pokémon.</p>
      </div>
    );
  }

  function handleReveal() {
    setRevealed(true);
  }

  function handleGrade(grade: Grade) {
    if (!currentCard || grading) return;
    // Re-narrow cards inside the closure — TS doesn't carry the outer
    // null-check through a function that captures a useState variable.
    if (cards === null) return;
    setGrading(true);

    const newState = nextReview(currentCard.state, grade, new Date());
    const newCards = cards.map((card) =>
      card.id === currentCard.id ? { ...card, state: newState } : card,
    );

    saveSession(newCards);
    setCards(newCards);
    setRevealed(false);
    setGrading(false);
  }

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
    </div>
  );
}
