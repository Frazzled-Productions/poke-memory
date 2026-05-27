"use client";

import React, { useRef, useState } from "react";
import Image from "next/image";
import { DirectionBadge } from "@/components/review/DirectionBadge";
import { PRACTICE_SPRITE_SIZE } from "@/lib/sprites/sizes";
import type { Grade } from "@/lib/review/session";
import type { SeedPokemon } from "@/lib/pokemon/seed";

// Feedback is held visible for this long before calling onGrade so the parent
// can advance to the next card. Matches FEEDBACK_HOLD_MS in TypedEntryNameCard.
const FEEDBACK_HOLD_MS = 1500;

type Option = {
  pokemon: SeedPokemon;
  isCorrect: boolean;
};

type Props = {
  spriteUrl: string;
  canonicalName: string;
  options: Option[];
  /** Pokémon id — passed through to the Image alt text. */
  id?: number | null;
  onGrade: (grade: Grade) => void;
  /** While true option buttons are disabled (grade in flight). */
  grading?: boolean;
};

/**
 * Multiple-choice variant of the name card (#1237).
 *
 * Renders the sprite + four name option buttons (2×2 grid). The user taps an
 * option; the grade is resolved automatically:
 *   - Correct pick  → Good (4)
 *   - Wrong pick    → Again (1), with the correct name revealed
 *
 * Used during the learning-step phase when `verifiedTypedEntryMode` is on.
 * The parent (ReviewSession) switches to TypedEntryNameCard once the card
 * graduates into the FSRS scheduling phase.
 *
 * The `options` prop must be pre-shuffled (use `buildMcOptions` from
 * `lib/srs/multipleChoiceDistractors.ts`). The component itself is stateless
 * with respect to ordering — the same `options` array order is always rendered,
 * so the parent controls determinism.
 *
 * An always-present `aria-live` region announces the result to screen readers
 * without requiring focus to move; content changes on tap, not the element
 * itself.
 */
export function MultipleChoiceNameCard({
  spriteUrl,
  canonicalName,
  options,
  id,
  onGrade,
  grading = false,
}: Props) {
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  // Tracks whether onGrade has already been called so we never double-fire.
  const gradedRef = useRef(false);

  function handleChoice(index: number, isCorrect: boolean) {
    if (chosenIndex !== null || grading || gradedRef.current) return;
    setChosenIndex(index);
    const grade: Grade = isCorrect ? 4 : 1;
    gradedRef.current = true;
    // Hold feedback visible before notifying the parent, matching the pattern
    // in TypedEntryNameCard so the parent's advance races the render commit.
    setTimeout(() => {
      onGrade(grade);
    }, FEEDBACK_HOLD_MS);
  }

  const submitted = chosenIndex !== null;
  const chosenOption = submitted ? options[chosenIndex] : null;
  const isCorrect = chosenOption?.isCorrect ?? false;

  // Feedback copy for screen-reader announcement.
  const feedbackText = submitted
    ? isCorrect
      ? "Correct!"
      : `Not quite. ${canonicalName}`
    : "";

  return (
    <div className="flex flex-col items-center gap-1 sm:gap-4">
      <DirectionBadge direction="name" />
      <Image
        src={spriteUrl}
        alt={
          id !== undefined && id !== null
            ? `Sprite for Pokémon #${id}`
            : "A Pokémon sprite, choose the name below"
        }
        width={PRACTICE_SPRITE_SIZE}
        height={PRACTICE_SPRITE_SIZE}
        priority
        className="h-36 w-36 object-contain sm:h-80 sm:w-80"
      />

      {/*
        Always-present aria-live region. Empty pre-choice; populated with
        the result after the user taps an option. Using "polite" because
        the feedback is informational, not a critical alert.
      */}
      <div aria-live="polite" role="status" aria-atomic="true">
        {submitted && (
          <p
            className={`text-base font-semibold text-center ${
              isCorrect
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {isCorrect ? "Correct!" : `Not quite. ${canonicalName}`}
          </p>
        )}
        {/* Visually hidden fallback text for environments that ignore the above */}
        {!submitted && (
          <span className="sr-only">Choose the correct name for this Pokémon.</span>
        )}
      </div>

      {/*
        2×2 option grid. Each button shows a name. After a choice is made,
        buttons dim except for the correct answer (which turns green) and the
        chosen wrong answer (which turns red) so the user can scan the result.
      */}
      <div
        className="grid grid-cols-2 gap-2 w-full max-w-xs"
        role="group"
        aria-label="Choose the Pokémon name"
      >
        {options.map((option, idx) => {
          const wasChosen = submitted && idx === chosenIndex;
          const isTheCorrectOne = option.isCorrect;

          let buttonStyle = "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700";
          if (submitted) {
            if (isTheCorrectOne) {
              buttonStyle =
                "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500";
            } else if (wasChosen) {
              buttonStyle =
                "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 ring-2 ring-red-500";
            } else {
              buttonStyle = "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 opacity-50";
            }
          }

          return (
            <button
              key={option.pokemon.id}
              type="button"
              disabled={grading || submitted}
              onClick={() => handleChoice(idx, option.isCorrect)}
              aria-pressed={wasChosen ? true : undefined}
              aria-label={`${option.pokemon.displayName}${isTheCorrectOne && submitted ? " (correct)" : ""}${wasChosen && !isTheCorrectOne ? " (incorrect)" : ""}`}
              className={`min-h-[44px] rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed ${buttonStyle}`}
            >
              {option.pokemon.displayName}
            </button>
          );
        })}
      </div>

      {/* Screen-reader-only summary consumed after the aria-live announces */}
      <span className="sr-only" aria-live="off">{feedbackText}</span>
    </div>
  );
}
