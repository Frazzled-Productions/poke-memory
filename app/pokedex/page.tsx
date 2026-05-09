"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { buildSession, hydrateSession } from "@/lib/review/session";
import type { ReviewCard } from "@/lib/review/session";
import { loadSession } from "@/lib/review/persistence";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import type { SeedPokemon } from "@/lib/pokemon/seed";
import { classifyCard, GEN_RANGES, generationOf } from "@/lib/stats/derive";
import type { CardClass } from "@/lib/stats/derive";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PokemonCellData = SeedPokemon & { cardClass: CardClass };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zeroPad(id: number): string {
  return String(id).padStart(3, "0");
}

// ---------------------------------------------------------------------------
// Cell component
// ---------------------------------------------------------------------------

function PokemonCell({ pokemon }: { pokemon: PokemonCellData }) {
  const { id, name, spriteUrl, cardClass } = pokemon;

  const isLocked = cardClass === "locked";
  const isMastered = cardClass === "mastered";
  const isLearning = cardClass === "learning";

  return (
    <li className="flex flex-col items-center gap-1">
      <Link
        href={"/pokedex/" + id}
        aria-label={isLocked ? "Pokémon #" + zeroPad(id) : name}
        className="block w-full"
      >
        <div
          className={[
            "relative flex h-20 w-full items-center justify-center rounded-xl border transition-colors",
          isMastered
            ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40"
            : isLearning
              ? "border-amber-200 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/30"
              : "border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900",
        ].join(" ")}
      >
        {/* Mastered checkmark badge */}
        {isMastered && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-white"
          >
            <svg
              viewBox="0 0 8 8"
              fill="none"
              className="h-2 w-2"
              aria-hidden="true"
            >
              <path
                d="M1.5 4 L3.2 5.8 L6.5 2"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}

        {/* Learning dot badge */}
        {isLearning && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-400"
          />
        )}

        {/* Sprite — using a plain <img> rather than next/image because we render
            1025 of these at fixed 64×64 sizes, where next/image's automatic
            sizing wrapper adds DOM overhead per cell with no responsive benefit. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={spriteUrl}
          alt={isLocked ? `#${zeroPad(id)} (locked)` : name}
          width={64}
          height={64}
          loading="lazy"
          className={[
            "h-16 w-16 object-contain",
            isLocked ? "brightness-[0.3] grayscale" : "",
          ].join(" ")}
        />

        {/* ID always visible */}
        <span
          aria-hidden="true"
          className="absolute bottom-1 left-1.5 text-[10px] font-mono tabular-nums text-zinc-400 dark:text-zinc-600"
        >
          #{zeroPad(id)}
          </span>
        </div>
      </Link>

      {/* Name — visible for learning/mastered, sr-only for locked */}
      {isLocked ? (
        <span className="sr-only">{name}</span>
      ) : (
        <span className="text-center text-[11px] leading-tight text-zinc-700 dark:text-zinc-300 line-clamp-2">
          {name}
        </span>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Generation section
// ---------------------------------------------------------------------------

function GenerationSection({
  gen,
  name,
  pokemon,
}: {
  gen: number;
  name: string;
  pokemon: PokemonCellData[];
}) {
  const mastered = pokemon.filter((p) => p.cardClass === "mastered").length;
  const total = pokemon.length;

  return (
    <section aria-labelledby={`gen-${gen}-heading`}>
      <h2
        id={`gen-${gen}-heading`}
        className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400"
      >
        {name}
        <span className="ml-2 font-normal tabular-nums">
          · {mastered} / {total} mastered
        </span>
      </h2>
      <ul
        className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8"
        role="list"
        aria-label={`${name} Pokémon`}
      >
        {pokemon.map((p) => (
          <PokemonCell key={p.id} pokemon={p} />
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div
      className="flex flex-col gap-10"
      aria-busy="true"
      aria-label="Loading Pokédex"
    >
      {GEN_RANGES.map((range) => (
        <div key={range.gen} className="flex flex-col gap-3">
          <div className="h-4 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
            {Array.from({ length: Math.min(range.last - range.first + 1, 16) }).map(
              (_, i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800"
                />
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PokedexPage() {
  const [cards, setCards] = useState<ReviewCard[] | null>(null);

  useEffect(() => {
    const saved = loadSession();
    if (saved !== null) {
      setCards(hydrateSession(saved.cards, SEED_POKEMON, []));
    } else {
      setCards(buildSession(SEED_POKEMON, []));
    }
  }, []);

  // Build a card-class lookup map when cards are ready
  const cardClassById = new Map<number, CardClass>();
  if (cards !== null) {
    for (const card of cards) {
      cardClassById.set(card.id, classifyCard(card));
    }
  }

  const introduced =
    cards !== null
      ? cards.filter((c) => c.state.lastReview !== null).length
      : 0;

  // Enrich SEED_POKEMON with classification
  const enrichedPokemon: PokemonCellData[] = SEED_POKEMON.map((p) => ({
    ...p,
    cardClass: cardClassById.get(p.id) ?? "locked",
  }));

  // Group by generation. Defer to the shared `generationOf` helper so the
  // page doesn't re-implement the lookup logic that already lives in lib/.
  const byGen: Map<number, PokemonCellData[]> = new Map(
    GEN_RANGES.map((r) => [r.gen, []]),
  );
  for (const p of enrichedPokemon) {
    const gen = generationOf(p.id);
    if (gen >= 1 && gen <= 9) byGen.get(gen)!.push(p);
  }

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
              {introduced.toLocaleString()} / {SEED_POKEMON.length.toLocaleString()}{" "}
              introduced
            </>
          )}
        </p>

        {cards === null ? (
          <LoadingSkeleton />
        ) : (
          <div className="flex flex-col gap-12">
            {GEN_RANGES.map((range) => {
              const genPokemon = byGen.get(range.gen) ?? [];
              return (
                <GenerationSection
                  key={range.gen}
                  gen={range.gen}
                  name={range.name}
                  pokemon={genPokemon}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
