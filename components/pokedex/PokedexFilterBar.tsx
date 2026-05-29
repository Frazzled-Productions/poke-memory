"use client";

import type { PokedexFilters, MasteryStatus, PokedexSort } from "@/lib/pokemon/filter";
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
  onAlternateFormsToggle: () => void;
  onMasteryChange: (masteryStatus: MasteryStatus) => void;
  onSortChange: (sort: PokedexSort) => void;
  /** When true (superuser pretendAllMastered on), the mastery filter is locked to "all" and disabled. */
  superuserMasteryLocked?: boolean;
};

// ---------------------------------------------------------------------------
// PokedexFilterBar
// ---------------------------------------------------------------------------

const MASTERY_OPTIONS: { value: MasteryStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mastered", label: "Mastered" },
  { value: "not-yet-mastered", label: "Not yet mastered" },
];

const SORT_OPTIONS: { value: PokedexSort; label: string }[] = [
  { value: "national", label: "National Number" },
  { value: "alpha", label: "Alphabetical (A-Z)" },
  { value: "proximity", label: "Closest to mastery" },
];

export default function PokedexFilterBar({
  filters,
  onQueryChange,
  onTypeToggle,
  onGenChange,
  onAlternateFormsToggle,
  onMasteryChange,
  onSortChange,
  superuserMasteryLocked = false,
}: FilterBarProps) {
  return (
    <div className="rounded-b-lg border border-t-0 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-4">
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
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 pr-8 text-sm text-foreground placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)] dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500"
        />
        {filters.query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]"
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
                "rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-1",
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
        className="flex flex-wrap gap-2 mb-3"
      >
        <button
          type="button"
          onClick={() => onGenChange(null)}
          aria-pressed={filters.gen === null}
          className={[
            "rounded-full px-3 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-1",
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
              "rounded-full px-3 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-1",
              filters.gen === gen
                ? "bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
            ].join(" ")}
          >
            Gen {ROMAN[gen]}
          </button>
        ))}
      </div>

      {/* Extra toggles */}
      <div
        role="group"
        aria-label="Additional filters"
        className="flex flex-wrap gap-2 mb-3"
      >
        <button
          type="button"
          onClick={onAlternateFormsToggle}
          aria-pressed={filters.hasAlternateForms}
          className={[
            "rounded-full px-3 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-1",
            filters.hasAlternateForms
              ? "bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
          ].join(" ")}
        >
          Has alternate forms
        </button>
      </div>

      {/* Mastery status filter */}
      <div
        role="group"
        aria-label="Filter by mastery"
        className="flex flex-wrap gap-2 mb-3"
      >
        {MASTERY_OPTIONS.map(({ value, label }) => {
          const isSelected = filters.masteryStatus === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onMasteryChange(value)}
              aria-pressed={isSelected}
              disabled={superuserMasteryLocked && value !== "all"}
              title={
                superuserMasteryLocked && value !== "all"
                  ? "Mastery filter unavailable while pretend-all-mastered is on"
                  : undefined
              }
              className={[
                "rounded-full px-3 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-1",
                superuserMasteryLocked && value !== "all"
                  ? "cursor-not-allowed opacity-40 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  : isSelected
                    ? "bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
              ].join(" ")}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Sort order */}
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="pokedex-sort"
          className="text-xs font-semibold text-zinc-500 dark:text-zinc-400"
        >
          Sort:
        </label>
        <select
          id="pokedex-sort"
          value={filters.sort}
          onChange={(e) => onSortChange(e.target.value as PokedexSort)}
          className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)] dark:border-zinc-700 dark:bg-zinc-900"
          aria-label="Sort Pokédex"
        >
          {SORT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
