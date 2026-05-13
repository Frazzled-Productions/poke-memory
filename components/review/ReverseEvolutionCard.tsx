import Image from "next/image";
import type { PokemonFact } from "@/lib/pokemon/facts";
import { DirectionBadge } from "@/components/review/DirectionBadge";
import { speakName } from "@/lib/audio/tts";

type Props = {
  preEvoName: string;
  preEvoSpriteUrl: string;
  postEvoName: string;
  postEvoSpriteUrl: string;
  triggerPhrase: string | null;
  revealed: boolean;
  fact?: PokemonFact | null;
};

const SPRITE_CLASS = "h-28 w-28 object-contain sm:h-48 sm:w-48";
const ARROW_CLASS =
  "text-3xl font-semibold text-zinc-400 dark:text-zinc-500 sm:text-5xl";
const PLACEHOLDER_CLASS =
  "flex h-28 w-28 items-center justify-center rounded-2xl border-2 border-dashed border-zinc-300 text-3xl font-semibold text-zinc-400 sm:h-48 sm:w-48 sm:text-5xl dark:border-zinc-700 dark:text-zinc-600";
const INLINE_SPEAK_BUTTON_CLASS =
  "ml-1 inline-flex h-7 w-7 items-center justify-center rounded-full align-middle text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";
const REVEAL_SPEAK_BUTTON_CLASS =
  "flex h-11 w-11 items-center justify-center rounded-full text-xl text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

/**
 * Reverse-direction evolution card (#343). Mirror of `EvolutionCard`:
 *   - Prompt: "Which Pokémon evolves into {postEvoName} {triggerPhrase}?"
 *   - Pre-reveal: "?" placeholder → arrow → postEvo sprite.
 *   - Post-reveal: preEvo sprite (answer) → arrow → postEvo sprite.
 */
export function ReverseEvolutionCard({
  preEvoName,
  preEvoSpriteUrl,
  postEvoName,
  postEvoSpriteUrl,
  triggerPhrase,
  revealed,
  fact,
}: Props) {
  return (
    <div className="flex flex-col items-center gap-3 sm:gap-4">
      <DirectionBadge direction="reverse-evolution" />
      <p className="text-base font-semibold text-foreground sm:text-lg">
        Which Pokémon evolves into <span className="capitalize">{postEvoName}</span>
        <button
          type="button"
          aria-label={`Hear ${postEvoName}`}
          onClick={() => speakName(postEvoName)}
          className={INLINE_SPEAK_BUTTON_CLASS}
        >
          🔊
        </button>
        {triggerPhrase ? <> {triggerPhrase}</> : null}?
      </p>
      <div
        className="flex items-center justify-center gap-3 sm:gap-6"
        aria-live="polite"
        aria-atomic="true"
      >
        {revealed ? (
          <Image
            src={preEvoSpriteUrl}
            alt={preEvoName}
            width={320}
            height={320}
            className={SPRITE_CLASS}
          />
        ) : (
          <div className={PLACEHOLDER_CLASS} aria-hidden="true">
            ?
          </div>
        )}
        <span aria-hidden="true" className={ARROW_CLASS}>
          →
        </span>
        <Image
          src={postEvoSpriteUrl}
          alt={postEvoName}
          width={320}
          height={320}
          priority
          className={SPRITE_CLASS}
        />
      </div>
      <div className="min-h-[2.5rem] flex flex-col items-center justify-center">
        {revealed ? (
          <>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold tracking-wide capitalize text-foreground sm:text-3xl">
                {preEvoName}
              </span>
              <button
                type="button"
                aria-label={`Hear ${preEvoName}`}
                onClick={() => speakName(preEvoName)}
                className={REVEAL_SPEAK_BUTTON_CLASS}
              >
                🔊
              </button>
            </div>
            {fact && (
              <div className="w-full mt-1 text-center sm:mt-2">
                <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                  {fact.label}
                </span>
                <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300 max-w-xs mx-auto">{fact.value}</p>
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
