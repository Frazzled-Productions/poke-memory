import Image from "next/image";
import type { PokemonFact } from "@/lib/pokemon/facts";

type Props = {
  spriteUrl: string;
  name: string;
  revealed: boolean;
  fact?: PokemonFact | null;
};

export function PokemonCard({ spriteUrl, name, revealed, fact }: Props) {
  return (
    <div className="flex flex-col items-center gap-4">
      <Image
        src={spriteUrl}
        alt={revealed ? name : "A Pokémon sprite — answer hidden"}
        width={320}
        height={320}
        priority
        className="h-56 w-56 object-contain sm:h-80 sm:w-80"
      />
      {/*
        Use min-h instead of a fixed h so the container can grow when a fact
        is shown below the name without causing a layout shift in the empty state.
      */}
      <div className="min-h-[2.5rem] flex flex-col items-center justify-center" aria-live="polite">
        {revealed ? (
          <>
            <p className="text-3xl font-semibold tracking-wide capitalize text-foreground">
              {name}
            </p>
            {fact && (
              <div className="mt-2 text-center">
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
