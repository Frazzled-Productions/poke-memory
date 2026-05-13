"use client";

import Link from "next/link";
import { GEN_RANGES, generationOf } from "@/lib/stats/derive";
import type { PokemonCellData } from "@/lib/pokemon/filter";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";

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
  const { flags } = useSuperuser();
  const { id, name, spriteUrl, cardClass: rawCardClass } = pokemon;
  // PokemonCellData.cardClass is CardClass (never "pending"), so no pending guard needed.
  const cardClass = flags.pretendAllMastered ? "mastered" : rawCardClass;

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
              isLocked ? "brightness-0" : isLearning ? "grayscale opacity-60" : "",
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
  const { flags } = useSuperuser();
  const total = pokemon.length;
  const mastered = flags.pretendAllMastered
    ? total
    : pokemon.filter((p) => p.cardClass === "mastered").length;

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

export function LoadingSkeleton() {
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
// Grid props
// ---------------------------------------------------------------------------

type PokedexGridProps = {
  pokemon: PokemonCellData[];
  activeGen?: number;
};

// ---------------------------------------------------------------------------
// PokedexGrid
// ---------------------------------------------------------------------------

export default function PokedexGrid({ pokemon, activeGen }: PokedexGridProps) {
  if (pokemon.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No Pokémon match your filters.
        </p>
        <Link
          href="/pokedex"
          className="text-sm font-medium text-foreground underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 rounded"
        >
          Clear filters
        </Link>
      </div>
    );
  }

  if (activeGen !== undefined) {
    const genName =
      GEN_RANGES.find((r) => r.gen === activeGen)?.name ??
      `Generation ${activeGen}`;
    return (
      <div className="flex flex-col gap-12">
        <GenerationSection gen={activeGen} name={genName} pokemon={pokemon} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      {GEN_RANGES.map((range) => {
        const genPokemon = pokemon.filter(
          // speciesId falls back to id for pre-expansion seed entries.
          (p) => generationOf(p.speciesId ?? p.id) === range.gen,
        );
        if (genPokemon.length === 0) return null;
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
  );
}
