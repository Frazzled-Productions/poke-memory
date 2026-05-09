import Image from "next/image";

type Props = {
  spriteUrl: string;
  name: string;
  evolvesIntoNames: string[];
  revealed: boolean;
};

export function EvolutionCard({ spriteUrl, name, evolvesIntoNames, revealed }: Props) {
  return (
    <div className="flex flex-col items-center gap-4">
      <Image
        src={spriteUrl}
        alt={revealed ? name : "A Pokémon sprite — answer hidden"}
        width={320}
        height={320}
        priority
        className="object-contain"
      />
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          What does <span className="capitalize">{name}</span> evolve into?
        </p>
        <div className="min-h-[2.5rem] flex flex-col items-center justify-center" aria-live="polite">
          {revealed ? (
            <div className="flex flex-wrap gap-x-2 gap-y-1 justify-center">
              {evolvesIntoNames.map((evoName, idx) => (
                <span key={evoName}>
                  <span className="text-3xl font-semibold tracking-wide capitalize text-foreground">
                    {evoName}
                  </span>
                  {idx < evolvesIntoNames.length - 1 && (
                    <span className="text-3xl font-semibold text-zinc-300 dark:text-zinc-600 select-none mx-1">
                      ·
                    </span>
                  )}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-3xl font-semibold tracking-wide text-zinc-300 dark:text-zinc-600 select-none">
              ???
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
