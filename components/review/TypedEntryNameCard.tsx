"use client";

import React, { useRef, useState } from "react";
import Image from "next/image";
import { DirectionBadge } from "@/components/review/DirectionBadge";
import { gradeTypedAnswer } from "@/lib/srs/typedEntryGrade";
import { PRACTICE_SPRITE_SIZE } from "@/lib/sprites/sizes";
import type { Grade } from "@/lib/review/session";

type Props = {
  spriteUrl: string;
  canonicalName: string;
  /** Pokémon id — passed through to the Image alt text and future TTS. */
  id?: number | null;
  onGrade: (grade: Grade) => void;
  /** While true the submit button is disabled (grade in flight). */
  grading?: boolean;
};

/**
 * Typed-entry variant of the name card (#1251).
 *
 * Renders the sprite (prompt) + a text input + Submit + "I don't know".
 * The user types the name; the grade is computed automatically:
 *   - Exact match (case-insensitive, punctuation-stripped) → Good (4)
 *   - Off by 1–2 chars → Hard (2) — feedback shown before advancing
 *   - Off by > 2 or empty → Again (1) — correct answer revealed
 *   - "I don't know" click → Again (1) — correct answer revealed
 *
 * This is a UI component owned by ui-coder by convention, but lives in
 * components/review/ alongside the existing card components. The grading
 * logic itself is a pure lib function (lib/srs/typedEntryGrade.ts).
 *
 * The component calls `onGrade` once and then becomes "submitted" — further
 * input is ignored while the grade is in flight. The parent (ReviewSession)
 * is responsible for advancing to the next card.
 */
export function TypedEntryNameCard({
  spriteUrl,
  canonicalName,
  id,
  onGrade,
  grading = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState("");
  // "submitted" tracks whether the user has pressed Submit or I don't know.
  // Once submitted we reveal the feedback so it is visible before the parent
  // advances to the next card.
  const [submitted, setSubmitted] = useState(false);
  const [feedbackGrade, setFeedbackGrade] = useState<Grade | null>(null);

  function submit(skipAnswer: boolean) {
    if (submitted || grading) return;
    let grade: Grade;
    if (skipAnswer) {
      grade = 1;
    } else {
      const result = gradeTypedAnswer(inputValue, canonicalName);
      grade = result.grade;
    }
    setFeedbackGrade(grade);
    setSubmitted(true);
    onGrade(grade);
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit(false);
  }

  // Feedback copy and colour vary by outcome.
  const feedbackInfo = (() => {
    if (feedbackGrade === 4) {
      return {
        label: "Correct!",
        colour: "text-emerald-600 dark:text-emerald-400",
        showAnswer: false,
      };
    }
    if (feedbackGrade === 2) {
      return {
        label: "Close!",
        colour: "text-amber-600 dark:text-amber-400",
        showAnswer: true,
      };
    }
    // feedbackGrade === 1 (Again) or null (pre-submit)
    return {
      label: "Not quite.",
      colour: "text-red-600 dark:text-red-400",
      showAnswer: true,
    };
  })();

  return (
    <div className="flex flex-col items-center gap-1 sm:gap-4">
      <DirectionBadge direction="name" />
      <Image
        src={spriteUrl}
        alt="A Pokémon sprite — type the name below"
        width={PRACTICE_SPRITE_SIZE}
        height={PRACTICE_SPRITE_SIZE}
        priority
        className="h-36 w-36 object-contain sm:h-80 sm:w-80"
      />

      {/*
        Reserve the same min-height as PokemonCard's answer region (~7rem) so
        the card's bounding box is stable across the pre/post submit states and
        the sprite doesn't drift when feedback expands below it.
      */}
      <div className="min-h-[7rem] flex flex-col items-center justify-center gap-2 w-full max-w-xs">
        {submitted ? (
          /* Post-submit: show feedback, reveal answer when wrong/close */
          <div
            className="flex flex-col items-center gap-1 text-center"
            aria-live="assertive"
            aria-atomic="true"
          >
            <p className={`text-base font-semibold ${feedbackInfo.colour}`}>
              {feedbackInfo.label}
            </p>
            {feedbackInfo.showAnswer && (
              <p className="text-lg font-semibold capitalize text-foreground">
                {canonicalName}
              </p>
            )}
          </div>
        ) : (
          /* Pre-submit: input form */
          <form
            onSubmit={handleFormSubmit}
            className="flex flex-col items-center gap-3 w-full"
          >
            <input
              ref={inputRef}
              type="text"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              aria-label="Type the Pokémon name"
              placeholder="Type the name..."
              disabled={grading}
              className="w-full rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground placeholder-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:placeholder-zinc-500 disabled:opacity-60"
            />
            <div className="flex flex-col items-center gap-2 w-full">
              <button
                type="submit"
                disabled={grading}
                className="min-h-[44px] w-full rounded-lg bg-theme-accent px-8 py-2 text-sm font-semibold text-theme-fg-on-primary transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 disabled:opacity-60"
              >
                Submit
              </button>
              <button
                type="button"
                disabled={grading}
                onClick={() => submit(true)}
                className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 focus-visible:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:hover:text-zinc-300 disabled:opacity-60"
              >
                I don&apos;t know
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
