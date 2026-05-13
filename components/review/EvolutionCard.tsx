import Image from "next/image";
import type { EvolutionTarget } from "@/lib/pokemon/seed";
import type { PokemonFact } from "@/lib/pokemon/facts";

type Props = {
  spriteUrl: string;
  name: string;
  evolvesInto: EvolutionTarget[];
  revealed: boolean;
  fact?: PokemonFact | null;
};

export function EvolutionCard({ spriteUrl, name, evolvesInto, revealed, fact }: Props) {
  const isBranching = evolvesInto.length > 1;
  const spriteSize = isBranching ? 96 : 320;

  return (
    <div className="flex flex-col items-center gap-4">
      {revealed ? (
        <>
          <div
            className="flex flex-wrap gap-4 justify-center"
            aria-live="polite"
            aria-atomic="true"
          >
            {evolvesInto.map((evo) => (
              <div key={evo.name} className="flex flex-col items-center gap-1">
                <Image
                  src={evo.spriteUrl}
                  alt={evo.name}
                  width={spriteSize}
                  height={spriteSize}
                  className="object-contain"
                />
                <span className="text-lg font-semibold tracking-wide capitalize text-foreground">
                  {evo.name}
                </span>
              </div>
            ))}
          </div>
          {!isBranching && fact && (
            <div className="w-full mt-2 text-center">
              <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                {fact.label}
              </span>
              <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300 max-w-xs mx-auto">{fact.value}</p>
            </div>
          )}
        </>
      ) : (
        <Image
          src={spriteUrl}
          alt="A Pokémon sprite — answer hidden"
          width={320}
          height={320}
          priority
          className="h-56 w-56 object-contain sm:h-80 sm:w-80"
        />
      )}
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          What does <span className="capitalize">{name}</span> evolve into?
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
