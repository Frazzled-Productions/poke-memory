import Image from "next/image";
import type { PokemonFact } from "@/lib/pokemon/facts";
import { DirectionBadge } from "@/components/review/DirectionBadge";
import { NameTtsButton } from "@/components/pokedex/NameTtsButton";

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
  return (
    <div className="flex flex-col items-center gap-1 sm:gap-4">
      <DirectionBadge direction={direction} />
      <Image
        src={spriteUrl}
        alt={revealed ? name : "A Pokémon sprite, answer hidden"}
        width={320}
        height={320}
        priority
        className="h-36 w-36 object-contain sm:h-80 sm:w-80"
      />
      {/*
        Reserve the revealed-state height (name row + Pokédex-entry fact, ~7rem
        worst case) in the unrevealed state too, so the card's bounding box is
        the same height either way. That lets the parent region centre the
        card without the sprite drifting upward when Reveal expands the answer
        area below it (#1104).
      */}
      <div className="min-h-[7rem] flex flex-col items-center justify-center" aria-live="polite">
        {revealed ? (
          <>
            <div className="flex items-center gap-2">
              <p className="text-3xl font-semibold tracking-wide capitalize text-foreground">
                {name}
              </p>
              <NameTtsButton name={name} id={id} size="reveal" />
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
