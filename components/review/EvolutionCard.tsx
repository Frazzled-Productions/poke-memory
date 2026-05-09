import Image from "next/image";
import type { EvolutionTarget } from "@/lib/pokemon/seed";

type Props = {
  spriteUrl: string;
  name: string;
  evolvesInto: EvolutionTarget[];
  revealed: boolean;
};

export function EvolutionCard({ spriteUrl, name, evolvesInto, revealed }: Props) {
  return (
    <div className="flex flex-col items-center gap-4">
      {revealed ? (
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
                width={96}
                height={96}
                className="object-contain"
              />
              <span className="text-lg font-semibold tracking-wide capitalize text-foreground">
                {evo.name}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <Image
          src={spriteUrl}
          alt="A Pokémon sprite — answer hidden"
          width={320}
          height={320}
          priority
          className="object-contain"
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
