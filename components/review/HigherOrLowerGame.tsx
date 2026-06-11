"use client";

import React from "react";
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
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";
import { usePokemonLocaleContext } from "@/lib/i18n/PokemonLocaleContext";

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
  /** Optional ref forwarded to the tile root button element. Used to move
   *  focus to the first tile when the game view is entered (#1882). */
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
};

function PokemonTile({ pokemon, stat, phase, onPick, highlight, buttonRef }: PokemonTileProps) {
  const statVal = pokemon.stats[stat];
  const { locale } = usePokemonLocaleContext();
  // eslint-disable-next-line no-restricted-syntax -- English fallback arg, not a direct render
  const { name: localeName } = useLocalePokemonName(pokemon.speciesId, pokemon.displayName);

  let ringClass = "";
  if (highlight === "winner")
    ringClass = "ring-2 ring-green-500";
  else if (highlight === "loser")
    ringClass = "ring-2 ring-red-400";
  else if (highlight === "tie")
    ringClass = "ring-2 ring-yellow-400";

  return (
    /* flex-1 h-full: the tile fills half the available width (flex-1 in the
       row direction) and the full height of the tiles row (h-full avoids the
       Webkit bug where flex-1 + min-h-0 on the cross-axis resolves to
       zero-height, making the button click-center landing on a sibling element
       instead of the button itself, #1837). */
    <button
      ref={buttonRef}
      type="button"
      onClick={onPick}
      disabled={phase === "revealed"}
      className={[
        "flex flex-1 h-full flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 transition-colors",
        "hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2",
        "disabled:cursor-default disabled:hover:bg-zinc-50",
        "dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:disabled:hover:bg-zinc-900",
        ringClass,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={localeName}
    >
      {/* Sprite is capped at max-h-24 / sm:max-h-32 so it does not overflow
          the tile on short viewports (e.g. iPhone SE). The sprite grows to fill
          available space via flex-1 min-h-0 but never exceeds the cap.
          object-contain preserves aspect ratio. */}
      {/* unoptimized: sprites are self-hosted static PNGs; keeping the URL
          identical to what decodeSpriteUrls warms means the decode pre-warm
          prevents names swapping before the sprite has loaded (#879). */}
      <Image
        src={pokemon.spriteUrl}
        alt={localeName}
        width={POKEDEX_FORM_SPRITE_SIZE}
        height={POKEDEX_FORM_SPRITE_SIZE}
        className="flex-1 min-h-0 w-auto max-h-24 object-contain sm:max-h-32"
        unoptimized
      />
      <p
        className="flex-none text-sm font-semibold capitalize text-foreground"
        lang={locale !== "en" ? locale : undefined}
      >
        {localeName}
      </p>
      {phase === "revealed" ? (
        <p className="flex-none text-lg font-bold tabular-nums text-foreground">{statVal}</p>
      ) : (
        <p className="flex-none text-lg font-bold text-zinc-300 dark:text-zinc-600 select-none">—</p>
      )}
    </button>
  );
}

type Props = {
  seenPokemon: SeedPokemon[];
  /**
   * When true, the game renders without the top border-separator and outer
   * top padding that were used in the old stacked-below-summary layout (#1837).
   * Set to true when the game occupies its own view in the card position (#1882).
   * Defaults false to preserve backward compatibility.
   */
  standalone?: boolean;
  /**
   * Optional ref forwarded to the first (left) tile button so the parent can
   * move focus to it when entering the game view (#1882).
   */
  firstTileRef?: React.RefObject<HTMLButtonElement | null>;
};

export function HigherOrLowerGame({ seenPokemon, standalone = false, firstTileRef }: Props) {
  const t = useTranslations("review");
  const [pair, setPair] = useState<Pair | null>(null);
  const [phase, setPhase] = useState<Phase>("picking");
  const [streak, setStreak] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [lastResult, setLastResult] = useState<LastResult>(null);
  // True while sprite decode is in-flight; prevents a second click from racing.
  const [transitioning, setTransitioning] = useState(false);

  // resultBlockRef retained as a no-op fallback - the layout now pins the
  // action button as flex-none so it is always visible without scrolling
  // (#1837). The scrollIntoView workaround from #1447 has been removed.
  const resultBlockRef = useRef<HTMLDivElement | null>(null);

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
    /* When standalone=true (game in its own card-position view, #1882): no
       border-t or top padding - the highlights bar above provides visual
       separation.
       When standalone=false (legacy stacked layout, #1837): border-t and pt-4
       separate the game from the EndOfSessionScreen content above it. */
    <section
      aria-label={t("higherOrLower.sectionAriaLabel")}
      className={`flex flex-col flex-1 min-h-0 w-full max-w-sm mx-auto${standalone ? "" : " pt-4 border-t border-zinc-200 dark:border-zinc-800"}`}
    >
      {/* flex-none: streak/best counters always visible, do not shrink. */}
      <div className={`flex-none flex justify-between w-full ${mutedTextXs} tabular-nums mb-3`}>
        <span>
          Streak: <span className="font-semibold text-foreground">{streak}</span>
        </span>
        <span>
          Best: <span className="font-semibold text-foreground">{bestScore}</span>
        </span>
      </div>

      {/* flex-none: stat prompt always visible. */}
      <p className="flex-none text-base font-medium text-foreground text-center mb-3">
        Which has higher{" "}
        <span className="font-bold">{statLabel(pair.stat)}</span>?
      </p>

      {/* flex-1 min-h-0: sprite tiles region absorbs the remaining height
          inside the section and can shrink on short viewports (e.g. iPhone SE)
          so the pinned footer stays on-screen. overflow-hidden is intentionally
          omitted: it caused Webkit to lose the height context for the tile
          buttons, collapsing their computed height to zero (#1837). The sprite
          max-h cap prevents overflow instead. */}
      <div className="flex flex-1 min-h-0 gap-3 w-full justify-center">
        <PokemonTile
          pokemon={pair.left}
          stat={pair.stat}
          phase={phase}
          onPick={() => handlePick("left")}
          highlight={tileHighlight("left")}
          buttonRef={firstTileRef}
        />
        <PokemonTile
          pokemon={pair.right}
          stat={pair.stat}
          phase={phase}
          onPick={() => handlePick("right")}
          highlight={tileHighlight("right")}
        />
      </div>

      {/* flex-none: result message and action button are always pinned at the
          bottom of the game section so the user never needs to scroll to reach
          them (#1837). min-h-[72px] reserves space so there is no layout shift
          on reveal. pointer-events-none in the picking phase prevents Webkit
          from routing clicks intended for the tile buttons to this placeholder
          div (empty but hit-testable on Webkit, #1837). */}
      <div
        ref={resultBlockRef}
        className={`flex-none flex flex-col items-center gap-3 w-full pt-3 pb-2 min-h-[72px] justify-center${phase !== "revealed" ? " pointer-events-none" : ""}`}
      >
        {phase === "revealed" && lastResult !== null && (
          <>
            <div aria-live="polite">
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
            </div>

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
          </>
        )}
      </div>
    </section>
  );
}
