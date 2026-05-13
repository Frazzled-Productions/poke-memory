"use client";

import { useEffect, useState, Suspense } from "react";
import { buildSession, hydrateSession } from "@/lib/review/session";
import type { ReviewableCard } from "@/lib/review/session";
import { loadSession } from "@/lib/review/persistence";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import { classifyCard } from "@/lib/stats/derive";
import type { CardClass } from "@/lib/stats/derive";
import { loadSettings } from "@/lib/settings/persistence";
import type { PokemonCellData } from "@/lib/pokemon/filter";
import { useSessionStorageKey } from "@/lib/review/useSessionStorageKey";
import { LoadingSkeleton } from "@/components/pokedex/PokedexGrid";
import PokedexFiltered from "@/components/pokedex/PokedexFiltered";

export default function PokedexPage() {
  const [cards, setCards] = useState<ReviewableCard[] | null>(null);
  const [masteryRepetitions, setMasteryRepetitions] = useState<number | null>(null);
  const storageVersion = useSessionStorageKey();

  useEffect(() => {
    const { masteryRepetitions: mr } = loadSettings();
    setMasteryRepetitions(mr);
    const saved = loadSession();
    if (saved !== null) {
      setCards(hydrateSession(saved.cards, SEED_POKEMON, []));
    } else {
      setCards(buildSession(SEED_POKEMON, []));
    }
  }, [storageVersion]);

  const cardClassById = new Map<number, CardClass>();
  if (cards !== null && masteryRepetitions !== null) {
    for (const card of cards) {
      cardClassById.set(card.id, classifyCard(card, masteryRepetitions));
    }
  }

  // Default forms only — one tile per species. Falls back to all entries when
  // the seed hasn't been re-run yet (isDefaultForm will be undefined on older
  // generated.json) to avoid an empty grid.
  const defaultFormPokemon = SEED_POKEMON.filter(
    (p) => p.isDefaultForm === undefined || p.isDefaultForm,
  );

  const introduced =
    cards !== null
      ? cards.filter((c) => c.cardType === "name" && c.state.lastReview !== null).length
      : 0;

  const enrichedPokemon: PokemonCellData[] = defaultFormPokemon.map((p) => ({
    ...p,
    cardClass: cardClassById.get(p.id) ?? "locked",
  }));

  return (
    <div className="flex flex-1 flex-col items-center bg-background px-4 py-10 sm:py-14">
      <div className="w-full max-w-5xl">
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">
          Pokédex
        </h1>
        <p className="mb-8 text-sm text-zinc-500 dark:text-zinc-400 tabular-nums">
          {cards === null ? (
            <span className="inline-block h-4 w-36 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          ) : (
            <>
              {introduced.toLocaleString()} / {defaultFormPokemon.length.toLocaleString()}{" "}
              introduced
            </>
          )}
        </p>

        {cards === null ? (
          <LoadingSkeleton />
        ) : (
          <Suspense fallback={<LoadingSkeleton />}>
            <PokedexFiltered enrichedPokemon={enrichedPokemon} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
