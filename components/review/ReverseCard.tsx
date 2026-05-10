import Image from "next/image";
import type { PokemonFact } from "@/lib/pokemon/facts";

type Props = {
  name: string;
  spriteUrl: string;
  revealed: boolean;
  fact?: PokemonFact | null;
};

export function ReverseCard({ name, spriteUrl, revealed, fact }: Props) {
  return (
    <div className="flex flex-col items-center gap-4">
      {revealed ? (
        <Image
          src={spriteUrl}
          alt={name}
          width={320}
          height={320}
          priority
          className="object-contain"
        />
      ) : (
        <div
          className="w-[320px] h-[320px] rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center"
          role="img"
          aria-label="Sprite hidden — name shown as prompt"
        >
          <span className="text-6xl select-none" aria-hidden="true">?</span>
        </div>
      )}
      <div
        className="min-h-[2.5rem] flex flex-col items-center justify-center"
        aria-live="polite"
      >
        <p className="text-3xl font-semibold tracking-wide capitalize text-foreground">
          {name}
        </p>
        {revealed && fact && (
          <div className="mt-2 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
              {fact.label}
            </span>
            <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300 max-w-xs">
              {fact.value}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
