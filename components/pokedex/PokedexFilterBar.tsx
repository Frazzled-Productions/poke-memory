"use client";

import { useTranslations } from "next-intl";
import type { PokedexFilters, MasteryStatus } from "@/lib/pokemon/filter";
import type { PokedexSortOrder } from "@/lib/pokedex/sort";
import { POKEMON_TYPES, TYPE_COLORS } from "@/lib/pokemon/types";
import { getTypeName, type TypeTranslations } from "@/lib/i18n/typeNames";
import { FilterChip } from "@/components/ui/FilterChip";
import { InfoButton } from "@/components/ui/InfoButton";

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
  sort: PokedexSortOrder;
  onQueryChange: (q: string) => void;
  onTypeToggle: (type: string) => void;
  onGenChange: (gen: number | null) => void;
  onAlternateFormsToggle: () => void;
  onMasteryChange: (masteryStatus: MasteryStatus) => void;
  onSortChange: (sort: PokedexSortOrder) => void;
  /** When true (superuser pretendAllMastered on), the mastery filter is locked to "all" and disabled. */
  superuserMasteryLocked?: boolean;
};

// ---------------------------------------------------------------------------
// PokedexFilterBar
// ---------------------------------------------------------------------------

export default function PokedexFilterBar({
  filters,
  sort,
  onQueryChange,
  onTypeToggle,
  onGenChange,
  onAlternateFormsToggle,
  onMasteryChange,
  onSortChange,
  superuserMasteryLocked = false,
}: FilterBarProps) {
  const t = useTranslations("pokedex");
  const tTypes = useTranslations("types") as TypeTranslations;

  // Defined inside the component so t() is in scope.
  const MASTERY_OPTIONS: { value: MasteryStatus; label: string }[] = [
    { value: "all", label: t("masteryAll") },
    { value: "mastered", label: t("masteryMastered") },
    { value: "not-yet-mastered", label: t("masteryNotYet") },
  ];

  const SORT_OPTIONS: { value: PokedexSortOrder; label: string }[] = [
    { value: "national", label: t("sortNational") },
    { value: "alphabetical", label: t("sortAlphabetical") },
    { value: "closest-to-mastery", label: t("sortClosestToMastery") },
  ];

  return (
    <div className="rounded-b-lg border border-t-0 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-4">
      {/* Search input */}
      <div className="relative mb-3">
        <label htmlFor="pokedex-search" className="sr-only">
          {t("searchAriaLabel")}
        </label>
        <input
          id="pokedex-search"
          type="text"
          value={filters.query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("searchPokedexPlaceholder")}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 pr-8 text-sm text-foreground placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)] dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500"
        />
        {filters.query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label={t("clearSearch")}
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

      {/* Sort control */}
      <div className="mb-3">
        <label
          htmlFor="pokedex-sort"
          className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400"
        >
          {t("sortBy")}
        </label>
        <div className="flex items-center gap-2">
          <select
            id="pokedex-sort"
            value={sort}
            onChange={(e) => onSortChange(e.target.value as PokedexSortOrder)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)] dark:border-zinc-700 dark:bg-zinc-900 sm:w-auto"
          >
            {SORT_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {sort === "closest-to-mastery" && (
            <InfoButton
              ariaLabel={t("sortClosestToMasteryInfoAriaLabel")}
              panelId="sort-closest-to-mastery-info"
              panelContent={
                <p>{t("sortClosestToMasteryInfoPanel")}</p>
              }
              panelClassName="left-0"
            />
          )}
        </div>
      </div>

      {/* Type chips */}
      <div
        role="group"
        aria-label={t("filterByTypeAriaLabel")}
        className="flex flex-wrap gap-2 mb-3"
      >
        {POKEMON_TYPES.map((type) => {
          const isSelected = filters.types.includes(type);
          const colors = TYPE_COLORS[type];
          const label = getTypeName(type, tTypes);
          return (
            <FilterChip
              key={type}
              active={isSelected}
              onClick={() => onTypeToggle(type)}
              activeClassName={colors ? `${colors.bg} ${colors.text}` : undefined}
              padding="px-2.5 py-0.5"
            >
              {label}
            </FilterChip>
          );
        })}
      </div>

      {/* Generation pills */}
      <div
        role="group"
        aria-label={t("filterByGenerationAriaLabel")}
        className="flex flex-wrap gap-2 mb-3"
      >
        <FilterChip
          active={filters.gen === null}
          onClick={() => onGenChange(null)}
        >
          {t("generationAll")}
        </FilterChip>
        {([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((gen) => (
          <FilterChip
            key={gen}
            active={filters.gen === gen}
            onClick={() => onGenChange(gen)}
          >
            {t("generationLabel", { gen: ROMAN[gen] })}
          </FilterChip>
        ))}
      </div>

      {/* Extra toggles */}
      <div
        role="group"
        aria-label={t("additionalFiltersAriaLabel")}
        className="flex flex-wrap gap-2 mb-3"
      >
        <FilterChip
          active={filters.hasAlternateForms}
          onClick={onAlternateFormsToggle}
        >
          {t("hasAlternateForms")}
        </FilterChip>
      </div>

      {/* Mastery status filter */}
      <div
        role="group"
        aria-label={t("filterByMasteryAriaLabel")}
        className="flex flex-wrap gap-2"
      >
        {MASTERY_OPTIONS.map(({ value, label }) => {
          const isSelected = filters.masteryStatus === value;
          const isLocked = superuserMasteryLocked && value !== "all";
          return (
            <FilterChip
              key={value}
              active={isSelected}
              onClick={() => onMasteryChange(value)}
              disabled={isLocked}
              title={isLocked ? t("masteryFilterUnavailable") : undefined}
              className={isLocked ? "cursor-not-allowed opacity-40" : undefined}
            >
              {label}
            </FilterChip>
          );
        })}
      </div>
    </div>
  );
}
