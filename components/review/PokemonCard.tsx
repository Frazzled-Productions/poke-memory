import Image from "next/image";
import type { PokemonFact } from "@/lib/pokemon/facts";
import { DirectionBadge } from "@/components/review/DirectionBadge";
import { speakName } from "@/lib/audio/tts";

type Props = {
  spriteUrl: string;
  name: string;
  revealed: boolean;
  fact?: PokemonFact | null;
  /** Which direction this card is being rendered for. Determines the badge. */
  direction?: "name" | "cry";
};

export function PokemonCard({ spriteUrl, name, revealed, fact, direction = "name" }: Props) {
  return (
    <div className="flex flex-col items-center gap-2 sm:gap-4">
      <DirectionBadge direction={direction} />
      <Image
        src={spriteUrl}
        alt={revealed ? name : "A Pokémon sprite — answer hidden"}
        width={320}
        height={320}
        priority
        className="h-48 w-48 object-contain sm:h-80 sm:w-80"
      />
      {/*
        Use min-h instead of a fixed h so the container can grow when a fact
        is shown below the name without causing a layout shift in the empty state.
      */}
      <div className="min-h-[2.5rem] flex flex-col items-center justify-center" aria-live="polite">
        {revealed ? (
          <>
            <div className="flex items-center gap-2">
              <p className="text-3xl font-semibold tracking-wide capitalize text-foreground">
                {name}
              </p>
              <button
                type="button"
                aria-label="Hear name"
                onClick={() => speakName(name)}
                className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                🔊
              </button>
            </div>
            {fact && (
              <div className="mt-1 text-center sm:mt-2">
                <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                  {fact.label}
                </span>
                <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300 max-w-xs">{fact.value}</p>
              </div>
            )}
          </>
        ) : (
          <p className="text-3xl font-semibold tracking-wide text-zinc-300 dark:text-zinc-600 select-none">
            ???
          </p>
        )}
      </div>
    </div>
  );
}
