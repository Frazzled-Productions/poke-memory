"use client";

import Image from "next/image";
import { useState, useEffect, useCallback } from "react";
import {
  pickPair,
  shufflePair,
  scoreGuess,
  BASE_STATS,
  type StatKey,
} from "@/lib/minigame/higherOrLower";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { decodeSpriteUrls } from "@/lib/review/decode";
import type { SeedPokemon } from "@/lib/pokemon/seed";

type Phase = "picking" | "revealed";
type LastResult = "correct" | "wrong" | "tie" | null;

type Pair = {
  left: SeedPokemon;
  right: SeedPokemon;
  stat: StatKey;
};

function statLabel(key: StatKey): string {
  return BASE_STATS.find((s) => s.key === key)?.label ?? key;
}

type PokemonTileProps = {
  pokemon: SeedPokemon;
  stat: StatKey;
  phase: Phase;
  onPick: () => void;
  highlight: "winner" | "loser" | "tie" | null;
};

function PokemonTile({ pokemon, stat, phase, onPick, highlight }: PokemonTileProps) {
  const statVal = pokemon.stats[stat];

  let ringClass = "";
  if (highlight === "winner")
    ringClass = "ring-2 ring-green-500";
  else if (highlight === "loser")
    ringClass = "ring-2 ring-red-400";
  else if (highlight === "tie")
    ringClass = "ring-2 ring-yellow-400";

  return (
    <button
      type="button"
      onClick={onPick}
      disabled={phase === "revealed"}
      className={[
        "flex flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 transition-colors",
        "hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2",
        "disabled:cursor-default disabled:hover:bg-zinc-50",
        "dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:disabled:hover:bg-zinc-900",
        ringClass,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={pokemon.name}
    >
      <Image
        src={pokemon.spriteUrl}
        alt={pokemon.name}
        width={120}
        height={120}
        className="h-24 w-24 object-contain sm:h-32 sm:w-32"
      />
      <p className="text-sm font-semibold capitalize text-foreground">{pokemon.name}</p>
      {phase === "revealed" ? (
        <p className="text-lg font-bold tabular-nums text-foreground">{statVal}</p>
      ) : (
        <p className="text-lg font-bold text-zinc-300 dark:text-zinc-600 select-none">—</p>
      )}
    </button>
  );
}

type Props = {
  seenPokemon: SeedPokemon[];
};

export function HigherOrLowerGame({ seenPokemon }: Props) {
  const [pair, setPair] = useState<Pair | null>(null);
  const [phase, setPhase] = useState<Phase>("picking");
  const [streak, setStreak] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [lastResult, setLastResult] = useState<LastResult>(null);
  // True while sprite decode is in-flight; prevents a second click from racing.
  const [transitioning, setTransitioning] = useState(false);

  const canPlay = seenPokemon.length >= 2;

  useEffect(() => {
    if (!canPlay) return;
    setBestScore(loadSettings().miniGameBestScore);
    setPair(shufflePair(pickPair(seenPokemon)));
    // Mount-only: seenPokemon is a memoised prop from the parent and is stable
    // for the component's lifetime. Re-running this effect on identity change
    // would reset the game mid-play.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePick = useCallback(
    (side: "left" | "right") => {
      if (!pair || phase !== "picking") return;

      const { correct, tie } = scoreGuess(pair.left, pair.right, pair.stat, side);

      if (!correct) {
        setPhase("revealed");
        setLastResult("wrong");
      } else {
        const newStreak = streak + 1;
        setStreak(newStreak);
        // Persist the new best immediately so a tab-close or navigation away
        // before "Play again" is clicked does not lose the achievement.
        if (newStreak > bestScore) {
          saveSettings({ ...loadSettings(), miniGameBestScore: newStreak });
          setBestScore(newStreak);
        }
        setPhase("revealed");
        setLastResult(tie ? "tie" : "correct");
      }
    },
    [pair, phase, streak, bestScore],
  );

  const handleNext = useCallback(() => {
    if (transitioning) return;
    const nextPair = shufflePair(pickPair(seenPokemon));
    setTransitioning(true);
    void decodeSpriteUrls([nextPair.left.spriteUrl, nextPair.right.spriteUrl]).then(() => {
      setPair(nextPair);
      setPhase("picking");
      setLastResult(null);
      setTransitioning(false);
    });
  }, [seenPokemon, transitioning]);

  const handlePlayAgain = useCallback(() => {
    if (transitioning) return;
    const nextPair = shufflePair(pickPair(seenPokemon));
    setTransitioning(true);
    void decodeSpriteUrls([nextPair.left.spriteUrl, nextPair.right.spriteUrl]).then(() => {
      // Reset streak atomically with the new pair so the game-over banner
      // ("Game over — streak of N!") keeps showing the correct value during
      // the decode window and only disappears when all state flips together.
      setStreak(0);
      setPair(nextPair);
      setPhase("picking");
      setLastResult(null);
      setTransitioning(false);
    });
  }, [seenPokemon, transitioning]);

  if (!canPlay || !pair) return null;

  const leftVal = pair.left.stats[pair.stat];
  const rightVal = pair.right.stats[pair.stat];

  function tileHighlight(side: "left" | "right"): "winner" | "loser" | "tie" | null {
    if (phase !== "revealed") return null;
    if (lastResult === "tie") return "tie";
    const isWinningSide =
      side === "left" ? leftVal > rightVal : rightVal > leftVal;
    return isWinningSide ? "winner" : "loser";
  }

  return (
    <section
      aria-label="Higher or Lower mini-game"
      className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto pt-6 border-t border-zinc-200 dark:border-zinc-800"
    >
      <div className="flex justify-between w-full text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
        <span>
          Streak: <span className="font-semibold text-foreground">{streak}</span>
        </span>
        <span>
          Best: <span className="font-semibold text-foreground">{bestScore}</span>
        </span>
      </div>

      <p className="text-base font-medium text-foreground text-center">
        Which has higher{" "}
        <span className="font-bold">{statLabel(pair.stat)}</span>?
      </p>

      <div className="flex gap-3 w-full justify-center">
        <PokemonTile
          pokemon={pair.left}
          stat={pair.stat}
          phase={phase}
          onPick={() => handlePick("left")}
          highlight={tileHighlight("left")}
        />
        <PokemonTile
          pokemon={pair.right}
          stat={pair.stat}
          phase={phase}
          onPick={() => handlePick("right")}
          highlight={tileHighlight("right")}
        />
      </div>

      {phase === "revealed" && lastResult !== null && (
        <div
          aria-live="polite"
          className="flex flex-col items-center gap-3 w-full"
        >
          {lastResult === "correct" && (
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              Correct!
            </p>
          )}
          {lastResult === "tie" && (
            <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
              Equal, both count.
            </p>
          )}
          {lastResult === "wrong" && (
            <p className="text-sm font-medium text-red-500 dark:text-red-400">
              Game over! Streak of {streak}.
            </p>
          )}

          {lastResult === "wrong" ? (
            <button
              type="button"
              onClick={handlePlayAgain}
              disabled={transitioning}
              className="min-h-[44px] rounded-lg bg-foreground px-6 py-2 text-sm font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:opacity-50"
            >
              Play again
            </button>
          ) : (
            <button
              type="button"
              onClick={handleNext}
              disabled={transitioning}
              className="min-h-[44px] rounded-lg bg-foreground px-6 py-2 text-sm font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:opacity-50"
            >
              Next pair
            </button>
          )}
        </div>
      )}
    </section>
  );
}
