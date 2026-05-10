"use client";

import type { PokedexFilters } from "@/lib/pokemon/filter";
import { POKEMON_TYPES, TYPE_COLORS } from "@/lib/pokemon/types";

// ---------------------------------------------------------------------------
// Roman numeral map for generation pills
// ---------------------------------------------------------------------------

const ROMAN: Record<number, string> = {
  1: "I",
  2: "II",
  3: "III",
  4: "IV",
  5: "V",
  6: "VI",
  7: "VII",
  8: "VIII",
  9: "IX",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type FilterBarProps = {
  filters: PokedexFilters;
  onQueryChange: (q: string) => void;
  onTypeToggle: (type: string) => void;
  onGenChange: (gen: number | null) => void;
};

// ---------------------------------------------------------------------------
// PokedexFilterBar
// ---------------------------------------------------------------------------

export default function PokedexFilterBar({
  filters,
  onQueryChange,
  onTypeToggle,
  onGenChange,
}: FilterBarProps) {
  return (
    <div className="sticky top-0 z-10 bg-background py-3 border-b border-zinc-200 dark:border-zinc-800 mb-6">
      {/* Search input */}
      <div className="relative mb-3">
        <label htmlFor="pokedex-search" className="sr-only">
          Search Pokémon
        </label>
        <input
          id="pokedex-search"
          type="text"
          value={filters.query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search Pokémon…"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 pr-8 text-sm text-foreground placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-foreground dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500"
        />
        {filters.query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
          >
            <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
              <path
                d="M4 4L12 12M12 4L4 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Type chips */}
      <div
        role="group"
        aria-label="Filter by type"
        className="flex flex-wrap gap-2 mb-3"
      >
        {POKEMON_TYPES.map((type) => {
          const isSelected = filters.types.includes(type);
          const colors = TYPE_COLORS[type];
          return (
            <button
              key={type}
              type="button"
              onClick={() => onTypeToggle(type)}
              aria-pressed={isSelected}
              className={[
                "rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1",
                isSelected && colors
                  ? `${colors.bg} ${colors.text}`
                  : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
              ].join(" ")}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          );
        })}
      </div>

      {/* Generation pills */}
      <div
        role="group"
        aria-label="Filter by generation"
        className="flex flex-wrap gap-2"
      >
        <button
          type="button"
          onClick={() => onGenChange(null)}
          aria-pressed={filters.gen === null}
          className={[
            "rounded-full px-3 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1",
            filters.gen === null
              ? "bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
          ].join(" ")}
        >
          All
        </button>
        {([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((gen) => (
          <button
            key={gen}
            type="button"
            onClick={() => onGenChange(gen)}
            aria-pressed={filters.gen === gen}
            className={[
              "rounded-full px-3 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1",
              filters.gen === gen
                ? "bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
            ].join(" ")}
          >
            Gen {ROMAN[gen]}
          </button>
        ))}
      </div>
    </div>
  );
}
