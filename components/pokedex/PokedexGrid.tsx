"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { GEN_RANGES, generationOf } from "@/lib/stats/derive";
import type { PokemonCellData } from "@/lib/pokemon/filter";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { mutedText } from "@/lib/utils/class-names";
import { POKEDEX_GRID_SPRITE_SIZE } from "@/lib/sprites/sizes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zeroPad(id: number): string {
  return String(id).padStart(3, "0");
}

// ---------------------------------------------------------------------------
// Cell component
// ---------------------------------------------------------------------------

// PokemonCell uses a plain <img> rather than next/image — deliberate exemption
// from the "default to next/image" rule (#932; see docs/sprites.md "The Pokédex
// grid exemption"). We render ~1025 of these at a fixed 64×64 size, where
// next/image's automatic sizing wrapper adds per-cell DOM overhead with no
// responsive benefit. A plain `loading="lazy"` <img> gives exactly the
// by-design pop-in we want for off-screen tiles, and a blanket preload of the
// full set would be counter-productive.
//
// This surface intentionally serves the raw PNG (`/sprites/pokemon/<id>.png`),
// not the pre-generated WebP variants. The raw PNG is slightly larger but
// avoids loading 1025 of these images through the global imageLoader path.
// The size literal below is intentionally kept inline — this surface opts out
// of next/image entirely, so it does not participate in the loader's WebP
// variant routing that the shared size constants exist for.
function PokemonCell({
  pokemon,
  localeOverride,
}: {
  pokemon: PokemonCellData;
  localeOverride?: LocaleNameOverride;
}) {
  const { flags } = useSuperuser();
  const { id, name, spriteUrl, cardClass: rawCardClass } = pokemon;
  // PokemonCellData.cardClass is CardClass (never "pending"), so no pending guard needed.
  const cardClass = flags.pretendAllMastered ? "mastered" : rawCardClass;

  const isLocked = cardClass === "locked";
  const isMastered = cardClass === "mastered";
  const isLearning = cardClass === "learning";

  // Resolved display name: locale override when available, English name as fallback.
  const displayName = localeOverride?.name ?? name;
  const displayLang = localeOverride?.lang;

  return (
    <li className="flex flex-col items-center gap-1">
      <Link
        href={"/pokedex/" + id}
        aria-label={isLocked ? "Pokémon #" + zeroPad(id) : displayName}
        className="block w-full"
      >
        <div
          className={[
            "relative flex h-20 w-full items-center justify-center rounded-xl border transition-colors",
            "[@media(hover:hover)]:hover:ring-2 [@media(hover:hover)]:hover:ring-offset-1",
            isMastered
              ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40 [@media(hover:hover)]:hover:bg-emerald-100 [@media(hover:hover)]:hover:ring-emerald-400 dark:[@media(hover:hover)]:hover:bg-emerald-900/60 dark:[@media(hover:hover)]:hover:ring-emerald-600"
              : isLearning
                ? "border-amber-200 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/30 [@media(hover:hover)]:hover:bg-amber-100 [@media(hover:hover)]:hover:ring-amber-300 dark:[@media(hover:hover)]:hover:bg-amber-900/40 dark:[@media(hover:hover)]:hover:ring-amber-700"
                : "border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 [@media(hover:hover)]:hover:bg-zinc-200 [@media(hover:hover)]:hover:ring-zinc-400 dark:[@media(hover:hover)]:hover:bg-zinc-800 dark:[@media(hover:hover)]:hover:ring-zinc-600",
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
            alt={isLocked ? `#${zeroPad(id)} (locked)` : displayName}
            width={POKEDEX_GRID_SPRITE_SIZE}
            height={POKEDEX_GRID_SPRITE_SIZE}
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

      {/* Name — visible for learning/mastered, sr-only for locked.
          lang attribute applied when locale differs from the page language
          (WCAG 3.1.2) so screen readers use correct pronunciation rules. */}
      {isLocked ? (
        <span className="sr-only">{name}</span>
      ) : (
        <span
          lang={displayLang}
          className="text-center text-[11px] leading-tight text-zinc-700 dark:text-zinc-300 line-clamp-2"
        >
          {displayName}
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
  localeNames,
}: {
  gen: number;
  name: string;
  pokemon: PokemonCellData[];
  localeNames?: ReadonlyMap<number, LocaleNameOverride>;
}) {
  const t = useTranslations("pokedex");
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
          · {t("masteryCount", { mastered, total })}
        </span>
      </h2>
      <ul
        className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10"
        role="list"
        aria-label={t("generationPokemonAriaLabel", { name })}
      >
        {pokemon.map((p) => (
          <PokemonCell
            key={p.id}
            pokemon={p}
            localeOverride={localeNames?.get(p.speciesId ?? p.id)}
          />
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

export function LoadingSkeleton() {
  const t = useTranslations("pokedex");
  return (
    <div
      className="flex flex-col gap-10"
      aria-busy="true"
      aria-label={t("loadingAriaLabel")}
    >
      {GEN_RANGES.map((range) => (
        <div key={range.gen} className="flex flex-col gap-3">
          <div className="h-4 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
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

/**
 * Per-tile locale name override: the resolved name and the BCP 47 language
 * tag to apply via the `lang` attribute (WCAG 3.1.2). Absent for locked tiles
 * where no name is shown, or when the active locale is English.
 */
export type LocaleNameOverride = {
  /** The resolved locale name to display in place of the English `pokemon.name`. */
  name: string;
  /** BCP 47 language tag — e.g. `"ja"`, `"zh-Hans"`. Set `lang` on the name element. */
  lang: string;
};

type PokedexGridProps = {
  pokemon: PokemonCellData[];
  activeGen?: number;
  /**
   * When true, renders all Pokémon in a single flat grid without generation
   * headings. Used when a non-national sort is active — generation sections
   * assume national-number order within each group, so they would be misleading
   * under alphabetical or closest-to-mastery sorts.
   */
  flatList?: boolean;
  /** Optional locale-name overrides keyed by speciesId. Computed in PokedexFiltered. */
  localeNames?: ReadonlyMap<number, LocaleNameOverride>;
};

// ---------------------------------------------------------------------------
// PokedexGrid
// ---------------------------------------------------------------------------

export default function PokedexGrid({ pokemon, activeGen, flatList = false, localeNames }: PokedexGridProps) {
  const t = useTranslations("pokedex");
  if (pokemon.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className={mutedText}>
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

  // Flat list — no generation headings. Used for non-national sort orders.
  if (flatList) {
    return (
      <ul
        className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10"
        role="list"
        aria-label={t("allPokemonAriaLabel")}
      >
        {pokemon.map((p) => (
          <PokemonCell
            key={p.id}
            pokemon={p}
            localeOverride={localeNames?.get(p.speciesId ?? p.id)}
          />
        ))}
      </ul>
    );
  }

  if (activeGen !== undefined) {
    const genName =
      GEN_RANGES.find((r) => r.gen === activeGen)?.name ??
      `Generation ${activeGen}`;
    return (
      <div className="flex flex-col gap-12">
        <GenerationSection
          gen={activeGen}
          name={genName}
          pokemon={pokemon}
          localeNames={localeNames}
        />
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
            localeNames={localeNames}
          />
        );
      })}
    </div>
  );
}
