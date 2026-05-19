import Image from "next/image";
import type { ReactNode } from "react";
import type { PokemonFact } from "@/lib/pokemon/facts";
import { DirectionBadge } from "@/components/review/DirectionBadge";
import { NameTtsButton } from "@/components/pokedex/NameTtsButton";
import type { CardDirection } from "@/components/review/DirectionBadge";

export const SPRITE_CLASS = "h-28 w-28 object-contain sm:h-48 sm:w-48";
export const ARROW_CLASS =
  "text-3xl font-semibold text-zinc-400 dark:text-zinc-500 sm:text-5xl";
export const PLACEHOLDER_CLASS =
  "flex h-28 w-28 items-center justify-center rounded-2xl border-2 border-dashed border-zinc-300 text-3xl font-semibold text-zinc-400 sm:h-48 sm:w-48 sm:text-5xl dark:border-zinc-700 dark:text-zinc-600";

type Props = {
  /** Badge direction — determines which `DirectionBadge` label is shown. */
  direction: Extract<CardDirection, "evolution" | "reverse-evolution">;
  /** The full prompt sentence, including any inline TTS button. */
  prompt: ReactNode;
  /**
   * Which side of the arrow is hidden before reveal.
   * - `"post"`: pre-evo is always visible; post-evo is hidden until reveal.
   * - `"pre"`: post-evo is always visible; pre-evo is hidden until reveal.
   */
  hiddenSide: "pre" | "post";
  preEvoSpriteUrl: string;
  preEvoName: string;
  postEvoSpriteUrl: string;
  postEvoName: string;
  /** Name of the Pokémon shown after reveal in the answer row. */
  answerName: string;
  /** Numeric ID of the answer Pokémon, used for TTS. */
  answerId?: number | null;
  revealed: boolean;
  fact?: PokemonFact | null;
};

/**
 * Shared layout for both directions of `EvolutionCard`.
 *
 * Both directions are identical except for:
 *   - The prompt sentence (passed as `prompt`).
 *   - The direction badge (`direction`).
 *   - Which side of the arrow holds the hidden/revealed sprite (`hiddenSide`).
 *
 * The always-visible sprite gets the `priority` attribute; the hidden/revealed
 * sprite does not, matching the original per-card behaviour.
 */
export function EvolutionCardLayout({
  direction,
  prompt,
  hiddenSide,
  preEvoSpriteUrl,
  preEvoName,
  postEvoSpriteUrl,
  postEvoName,
  answerName,
  answerId,
  revealed,
  fact,
}: Props) {
  // The always-visible sprite gets `priority` for LCP; the hidden/revealed
  // sprite does not — preserving the original per-card behaviour.
  const preEvoImg = (
    <Image
      src={preEvoSpriteUrl}
      alt={preEvoName}
      width={320}
      height={320}
      priority={hiddenSide !== "pre"}
      className={SPRITE_CLASS}
    />
  );

  const postEvoImg = (
    <Image
      src={postEvoSpriteUrl}
      alt={postEvoName}
      width={320}
      height={320}
      priority={hiddenSide !== "post"}
      className={SPRITE_CLASS}
    />
  );

  const placeholder = (
    <div className={PLACEHOLDER_CLASS} aria-hidden="true">
      ?
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-3 sm:gap-4">
      <DirectionBadge direction={direction} />
      <p className="text-base font-semibold text-foreground sm:text-lg">
        {prompt}
      </p>
      <div
        className="flex items-center justify-center gap-3 sm:gap-6"
        aria-live="polite"
        aria-atomic="true"
      >
        {/* Left side: hidden when hiddenSide === "pre" and not yet revealed */}
        {hiddenSide === "pre" ? (revealed ? preEvoImg : placeholder) : preEvoImg}
        <span aria-hidden="true" className={ARROW_CLASS}>
          →
        </span>
        {/* Right side: hidden when hiddenSide === "post" and not yet revealed */}
        {hiddenSide === "post" ? (revealed ? postEvoImg : placeholder) : postEvoImg}
      </div>
      <div className="min-h-[2.5rem] flex flex-col items-center justify-center">
        {revealed ? (
          <>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold tracking-wide capitalize text-foreground sm:text-3xl">
                {answerName}
              </span>
              <NameTtsButton name={answerName} id={answerId} size="reveal" />
            </div>
            {fact && (
              <div className="w-full mt-1 text-center sm:mt-2">
                <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                  {fact.label}
                </span>
                <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300 max-w-xs mx-auto">
                  {fact.value}
                </p>
              </div>
            )}
          </>
        ) : (
          <p
            className="text-3xl font-semibold tracking-wide text-zinc-300 dark:text-zinc-600 select-none"
            aria-hidden="true"
          >
            ???
          </p>
        )}
      </div>
    </div>
  );
}
