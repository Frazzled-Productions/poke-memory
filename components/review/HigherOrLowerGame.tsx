"use client";

import Image from "next/image";
import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  pickPair,
  shufflePair,
  scoreGuess,
  BASE_STATS,
  type StatKey,
} from "@/lib/minigame/higherOrLower";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { decodeSpriteUrls } from "@/lib/sprites/decode";
import type { SeedPokemon } from "@/lib/pokemon/seed";
import { mutedTextXs } from "@/lib/utils/class-names";
import { POKEDEX_FORM_SPRITE_SIZE } from "@/lib/sprites/sizes";

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
      {/* unoptimized: sprites are self-hosted static PNGs; keeping the URL
          identical to what decodeSpriteUrls warms means the decode pre-warm
          prevents names swapping before the sprite has loaded (#879). */}
      <Image
        src={pokemon.spriteUrl}
        alt={pokemon.name}
        width={POKEDEX_FORM_SPRITE_SIZE}
        height={POKEDEX_FORM_SPRITE_SIZE}
        className="h-24 w-24 object-contain sm:h-32 sm:w-32"
        unoptimized
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
  const t = useTranslations("review");
  const [pair, setPair] = useState<Pair | null>(null);
  const [phase, setPhase] = useState<Phase>("picking");
  const [streak, setStreak] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [lastResult, setLastResult] = useState<LastResult>(null);
  // True while sprite decode is in-flight; prevents a second click from racing.
  const [transitioning, setTransitioning] = useState(false);

  // Ref attached to the result block (result message + action button) that
  // appears below the tiles when phase === "revealed". On reveal, we scroll
  // this element into view so the action button is reachable without manual
  // scrolling on tall mobile viewports (e.g. iPhone 17 Pro) where the reveal
  // block lands below the fold (#1447).
  // `block: "nearest"` is intentional: it only scrolls when the element is
  // already out of view, so on desktop / short viewports where everything fits
  // the tiles are never scrolled off-screen.
  const resultBlockRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (phase !== "revealed" || resultBlockRef.current === null) return;
    const prefersReducedMotion =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultBlockRef.current.scrollIntoView({
      behavior: prefersReducedMotion ? "instant" : "smooth",
      block: "nearest",
    });
  }, [phase]);

  const canPlay = seenPokemon.length >= 2;

  useEffect(() => {
    if (!canPlay) return;
    // Guard against re-running when React re-shows a preserved route segment
    // (e.g. tab away + back). pair is null only on the very first mount, so
    // this check makes the initialisation idempotent - an in-progress or
    // game-over state is never clobbered by a re-show (#887).
    // bestScore is similarly guarded: re-reading settings on re-show would
    // overwrite an in-session high score before the user has acknowledged it.
    if (pair) return;
    setBestScore(loadSettings().miniGameBestScore);
    setPair(shufflePair(pickPair(seenPokemon)));
    // pair is in deps so the lint rule is satisfied; the guard above ensures
    // we only act when pair is null (i.e. first mount only).
    // canPlay, seenPokemon, loadSettings, shufflePair, and pickPair are
    // intentionally omitted: seenPokemon is stable for the component lifetime
    // (memoised at the call site), canPlay is derived from it, and the
    // imported functions are module-level constants - none of them change, so
    // adding them would not change behaviour but would risk re-triggering the
    // effect (and therefore clobbering game state) if the reference ever
    // shifts at the call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair]);

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
      // ("Game over - streak of N!") keeps showing the correct value during
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
      aria-label={t("higherOrLower.sectionAriaLabel")}
      className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto pt-6 border-t border-zinc-200 dark:border-zinc-800"
    >
      <div className={`flex justify-between w-full ${mutedTextXs} tabular-nums`}>
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
          ref={resultBlockRef}
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
