"use client";

import Image from "next/image";
import type { PokemonFact } from "@/lib/pokemon/facts";
import { DirectionBadge } from "@/components/review/DirectionBadge";
import { NameTtsButton } from "@/components/pokedex/NameTtsButton";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";

type Props = {
  spriteUrl: string;
  name: string;
  revealed: boolean;
  fact?: PokemonFact | null;
  /** Which direction this card is being rendered for. Determines the badge. */
  direction?: "name" | "cry";
  id?: number | null;
};

export function PokemonCard({ spriteUrl, name, revealed, fact, direction = "name", id }: Props) {
  // Resolve locale-aware name from the sidecar when the languages Labs flag is
  // on (#1260). Falls back to the English `name` prop synchronously.
  const localeName = useLocalePokemonName(id ?? undefined, name);
  const displayName = localeName.name;

  return (
    <div className="flex flex-col items-center gap-1 sm:gap-4">
      <DirectionBadge direction={direction} />
      <Image
        src={spriteUrl}
        alt={revealed ? displayName : "A Pokémon sprite, answer hidden"}
        width={320}
        height={320}
        priority
        className="h-36 w-36 object-contain sm:h-80 sm:w-80"
      />
      {/*
        Reserve the revealed-state height (name row + transliteration + fact,
        ~9rem worst case) in the unrevealed state too, so the card's bounding
        box is the same height either way (#1104).
      */}
      <div className="min-h-[7rem] flex flex-col items-center justify-center" aria-live="polite">
        {revealed ? (
          <>
            <div className="flex items-center gap-2">
              <div className="flex flex-col items-center">
                <p className="text-3xl font-semibold tracking-wide capitalize text-foreground">
                  {displayName}
                </p>
                {/* Transliteration aid (rōmaji / pinyin) when locale is non-Latin */}
                {localeName.transliteration && (
                  <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                    {localeName.transliteration}
                  </p>
                )}
              </div>
              <NameTtsButton name={displayName} id={id} size="reveal" />
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
