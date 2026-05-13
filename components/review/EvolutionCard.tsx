import Image from "next/image";
import type { PokemonFact } from "@/lib/pokemon/facts";

type Props = {
  preEvoSpriteUrl: string;
  preEvoName: string;
  postEvoName: string;
  postEvoSpriteUrl: string;
  triggerPhrase: string | null;
  revealed: boolean;
  fact?: PokemonFact | null;
};

export function EvolutionCard({
  preEvoSpriteUrl,
  preEvoName,
  postEvoName,
  postEvoSpriteUrl,
  triggerPhrase,
  revealed,
  fact,
}: Props) {
  return (
    <div className="flex flex-col items-center gap-2 sm:gap-4">
      {revealed ? (
        <>
          <div
            className="flex flex-col items-center gap-1"
            aria-live="polite"
            aria-atomic="true"
          >
            <Image
              src={postEvoSpriteUrl}
              alt={postEvoName}
              width={320}
              height={320}
              className="h-48 w-48 object-contain sm:h-80 sm:w-80"
            />
            <span className="text-lg font-semibold tracking-wide capitalize text-foreground">
              {postEvoName}
            </span>
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
        <Image
          src={preEvoSpriteUrl}
          alt="A Pokémon sprite — answer hidden"
          width={320}
          height={320}
          priority
          className="h-48 w-48 object-contain sm:h-80 sm:w-80"
        />
      )}
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          What does <span className="capitalize">{preEvoName}</span> evolve into
          {triggerPhrase ? <> {triggerPhrase}</> : null}?
        </p>
        <div className="min-h-[2.5rem] flex flex-col items-center justify-center">
          {!revealed && (
            <p
              className="text-3xl font-semibold tracking-wide text-zinc-300 dark:text-zinc-600 select-none"
              aria-hidden="true"
            >
              ???
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
