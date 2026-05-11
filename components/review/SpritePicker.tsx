"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { SeedPokemon } from "@/lib/pokemon/seed";
import { FNV_PRIME, fnv1a } from "@/lib/utils/fnv1a";

// How long to show correctness feedback before advancing (ms).
// Correct tap: brief highlight. Incorrect tap: time to see the right answer.
const CORRECT_FEEDBACK_MS = 600;
const INCORRECT_FEEDBACK_MS = 1200;

type Tile = SeedPokemon & { isCorrect: boolean };

function shuffleTiles(target: SeedPokemon, distractors: readonly SeedPokemon[]): Tile[] {
  const all: Tile[] = [
    { ...target, isCorrect: true },
    ...distractors.map((d) => ({ ...d, isCorrect: false })),
  ];
  const seed = fnv1a(String(target.id));
  const keyed = all.map((tile) => {
    let hash = seed;
    hash ^= tile.id & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    hash ^= (tile.id >>> 8) & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    return { tile, key: hash };
  });
  keyed.sort((a, b) => a.key - b.key || a.tile.id - b.tile.id);
  return keyed.map((k) => k.tile);
}

type Props = {
  targetPokemon: SeedPokemon;
  distractors: readonly SeedPokemon[];
  onGrade: (correct: boolean) => void;
};

export function SpritePicker({ targetPokemon, distractors, onGrade }: Props) {
  const [answered, setAnswered] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable tile order keyed on targetPokemon.id so distractors don't shuffle mid-card.
  const tiles = useMemo(
    () => shuffleTiles(targetPokemon, distractors),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetPokemon.id],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  function handleTap(tile: Tile) {
    if (answered) return;
    setAnswered(true);
    setSelectedId(tile.id);

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
      {/* Name prompt */}
      <p className="text-3xl font-semibold tracking-wide capitalize text-foreground">
        {targetPokemon.name}
      </p>

      {/* 2×2 sprite tile grid */}
      <div
        className="grid grid-cols-2 gap-3"
        role="group"
        aria-label={`Which Pokémon is ${targetPokemon.name}?`}
      >
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            disabled={answered}
            aria-label={
              !answered
                ? tile.name
                : tile.isCorrect
                  ? `${tile.name} (correct)`
                  : tile.id === selectedId
                    ? `${tile.name} (incorrect)`
                    : tile.name
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
            <span className="sr-only">{tile.name}</span>
          </button>
        ))}
      </div>

      {/* Feedback label — announced to screen readers after answering */}
      <div aria-live="polite" aria-atomic="true" className="min-h-[1.5rem]">
        {answered && selectedId !== null && (
          <p className="text-sm font-medium text-center text-zinc-600 dark:text-zinc-300">
            {tiles.find((t) => t.id === selectedId)?.isCorrect
              ? "Correct!"
              : `The correct answer was ${targetPokemon.name}`}
          </p>
        )}
      </div>
    </div>
  );
}
