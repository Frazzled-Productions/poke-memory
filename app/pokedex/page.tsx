"use client";

import { useEffect, useState, Suspense } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { mutedText, pageTitle } from "@/lib/utils/class-names";
import { PageShell } from "@/components/ui/PageShell";
import { buildSession, hydrateSession } from "@/lib/review/session";
import type { ReviewableCard } from "@/lib/review/session";
import { loadSession, saveSession, STORAGE_KEY as SESSION_STORAGE_KEY } from "@/lib/review/persistence";
import { useSeed } from "@/lib/pokemon/SeedContext";
import { classifyCard } from "@/lib/stats/derive";
import type { CardClass } from "@/lib/stats/derive";
import type { MasteryProgress } from "@/lib/pokedex/sort";
import { loadSettings } from "@/lib/settings/persistence";
import type { PokemonCellData } from "@/lib/pokemon/filter";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import { LoadingSkeleton } from "@/components/pokedex/PokedexGrid";
import PokedexFiltered from "@/components/pokedex/PokedexFiltered";

export default function PokedexPage() {
  const t = useTranslations("pokedex");
  const format = useFormatter();
  const { seed } = useSeed();
  const [cards, setCards] = useState<ReviewableCard[] | null>(null);
  const storageVersion = useLocalStorageKey(SESSION_STORAGE_KEY);

  useEffect(() => {
    if (seed === null) return;
    const currentSeed = seed; // capture non-null reference for async closure
    async function load() {
      const saved = await loadSession();
      if (saved !== null) {
        const { cards: hydrated, anyHealed } = hydrateSession(saved.cards, currentSeed.seedPokemon, []);
        // Persist healed cards so the fixed point is durable across all entry
        // points, not only Practice (#1506).
        if (anyHealed) {
          await saveSession({ cards: hydrated, limits: saved.limits });
        }
        setCards(hydrated);
      } else {
        setCards(buildSession(currentSeed.seedPokemon, []));
      }
    }
    void load();
  }, [storageVersion, seed]);

  const cardClassById = new Map<number, CardClass>();
  const masteryProgressById = new Map<number, MasteryProgress>();
  if (cards !== null) {
    for (const card of cards) {
      if (card.cardType !== "name") continue;
      cardClassById.set(card.id, classifyCard(card));
      // Populate the mastery-progress snapshot used by "closest to mastery" sort.
      if (card.state.lastReview !== null) {
        masteryProgressById.set(card.id, {
          reps: card.state.reps,
          scheduledDays: card.state.scheduledDays,
        });
      }
    }
  }

  // Default forms only - one tile per species. Falls back to all entries when
  // the seed hasn't been re-run yet (isDefaultForm will be undefined on older
  // generated.json) to avoid an empty grid.
  const defaultFormPokemon = (seed?.seedPokemon ?? []).filter(
    (p) => p.isDefaultForm === undefined || p.isDefaultForm,
  );

  const introduced =
    cards !== null
      ? cards.filter((c) => c.cardType === "name" && c.state.lastReview !== null).length
      : 0;

  const enrichedPokemon: PokemonCellData[] = defaultFormPokemon.map((p) => {
    const progress = masteryProgressById.get(p.id);
    return {
      ...p,
      cardClass: cardClassById.get(p.id) ?? "locked",
      ...(progress !== undefined ? { masteryProgress: progress } : {}),
    };
  });

  return (
    <PageShell width="wide">
        <h1 className={`mb-2 ${pageTitle}`}>
          {t("title")}
        </h1>
        <p className={`mb-8 ${mutedText} tabular-nums`}>
          {cards === null ? (
            <span className="inline-block h-4 w-36 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          ) : (
            t("introduced", {
              introduced: format.number(introduced),
              total: format.number(defaultFormPokemon.length),
            })
          )}
        </p>

        {cards === null ? (
          <LoadingSkeleton />
        ) : (
          <Suspense fallback={<LoadingSkeleton />}>
            <PokedexFiltered enrichedPokemon={enrichedPokemon} />
          </Suspense>
        )}
    </PageShell>
  );
}
