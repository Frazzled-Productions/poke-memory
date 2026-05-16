"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { SeedPokemon } from "@/lib/pokemon/seed";
import { DirectionBadge } from "@/components/review/DirectionBadge";
import { speakName } from "@/lib/audio/tts";
import { playCry } from "@/lib/audio/cry";

// How long to show correctness feedback before advancing (ms).
// Correct tap: brief highlight. Incorrect tap: time to see the right answer.
const CORRECT_FEEDBACK_MS = 600;
const INCORRECT_FEEDBACK_MS = 1200;

type Tile = SeedPokemon & { isCorrect: boolean };

/**
 * Fisher-Yates shuffle. Returns a new array; does not mutate the input.
 * Uses Math.random() so the order differs every time the function is called —
 * the caller is responsible for calling it once per card presentation.
 */
export function fisherYatesShuffle<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildTiles(target: SeedPokemon, distractors: readonly SeedPokemon[]): Tile[] {
  const all: Tile[] = [
    { ...target, isCorrect: true },
    ...distractors.map((d) => ({ ...d, isCorrect: false })),
  ];
  return fisherYatesShuffle(all);
}

type Props = {
  targetPokemon: SeedPokemon;
  distractors: readonly SeedPokemon[];
  onGrade: (correct: boolean) => void;
  /**
   * When true, plays the target Pokémon's cry at the moment the picker
   * enters the answered state (equivalent to the reveal moment on flip cards).
   * Silently skipped when `targetPokemon.cryUrl` is null.
   */
  playCryOnAnswer?: boolean;
  /**
   * When true, speaks the target Pokémon's name at the answer-feedback moment.
   * When both `playCryOnAnswer` and `speakNameOnAnswer` are true, the cry plays
   * first and the name is spoken via the `onEnded` callback — consistent with
   * the cry → TTS chaining in handleReveal on flip cards.
   */
  speakNameOnAnswer?: boolean;
};

export function SpritePicker({ targetPokemon, distractors, onGrade, playCryOnAnswer = false, speakNameOnAnswer = false }: Props) {
  const [answered, setAnswered] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shuffle once at mount. The parent must remount this component (via a
  // changing `key`) on each card presentation so the order is fresh every time
  // the same card reappears as a learning-step replay or within-session review.
  const [tiles] = useState<Tile[]>(() => buildTiles(targetPokemon, distractors));

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  function handleTap(tile: Tile) {
    if (answered) return;
    setAnswered(true);
    setSelectedId(tile.id);

    // Play the target cry and/or speak the name at the answer-feedback moment —
    // the reverse-card equivalent of the reveal moment on flip cards (#707, #731).
    // When both are enabled, chain TTS to fire after the cry ends, consistent
    // with the cry → TTS ordering in handleReveal on flip cards.
    const speakAfterCry =
      speakNameOnAnswer ? () => speakName(targetPokemon.displayName, targetPokemon.id) : undefined;

    if (playCryOnAnswer) {
      playCry(targetPokemon.cryUrl, 0.6, speakAfterCry);
    } else if (speakNameOnAnswer) {
      speakName(targetPokemon.displayName, targetPokemon.id);
    }

    if (tile.isCorrect) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onGrade(true);
      }, CORRECT_FEEDBACK_MS);
    } else {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onGrade(false);
      }, INCORRECT_FEEDBACK_MS);
    }
  }

  function tileClassName(tile: Tile): string {
    const base =
      "relative rounded-xl overflow-hidden border-4 transition-colors duration-150 " +
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-foreground " +
      "disabled:cursor-not-allowed";

    if (!answered) {
      return `${base} border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 bg-zinc-100 dark:bg-zinc-800`;
    }

    if (tile.isCorrect) {
      return `${base} border-green-500 bg-green-50 dark:bg-green-950/30`;
    }
    if (tile.id === selectedId) {
      return `${base} border-red-500 bg-red-50 dark:bg-red-950/30`;
    }
    return `${base} border-transparent bg-zinc-100 dark:bg-zinc-800 opacity-50`;
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <DirectionBadge direction="reverse" />
      {/* Name prompt */}
      <div className="flex items-center gap-2">
        <p className="text-3xl font-semibold tracking-wide capitalize text-foreground">
          {targetPokemon.displayName}
        </p>
        <button
          type="button"
          aria-label={`Hear ${targetPokemon.displayName}`}
          onClick={() => speakName(targetPokemon.displayName, targetPokemon.id)}
          className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          🔊
        </button>
      </div>

      {/* 2×2 sprite tile grid */}
      <div
        className="grid grid-cols-2 gap-3"
        role="group"
        aria-label={`Which Pokémon is ${targetPokemon.displayName}?`}
      >
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            disabled={answered}
            aria-label={
              !answered
                ? tile.displayName
                : tile.isCorrect
                  ? `${tile.displayName} (correct)`
                  : tile.id === selectedId
                    ? `${tile.displayName} (incorrect)`
                    : tile.displayName
            }
            onClick={() => handleTap(tile)}
            className={tileClassName(tile)}
          >
            <Image
              src={tile.spriteUrl}
              alt=""
              aria-hidden="true"
              width={150}
              height={150}
              className="object-contain w-[150px] h-[150px]"
            />
            {/* Visually hidden name for screen readers */}
            <span className="sr-only">{tile.displayName}</span>
          </button>
        ))}
      </div>

      {/* Feedback label — announced to screen readers after answering */}
      <div aria-live="polite" aria-atomic="true" className="min-h-[1.5rem]">
        {answered && selectedId !== null && (
          <p className="text-sm font-medium text-center text-zinc-600 dark:text-zinc-300">
            {tiles.find((t) => t.id === selectedId)?.isCorrect
              ? "Correct!"
              : `The correct answer was ${targetPokemon.displayName}`}
          </p>
        )}
      </div>
    </div>
  );
}
