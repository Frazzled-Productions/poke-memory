"use client";

import { useMemo, useState, useCallback, useId, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { filterPokemon, parseFilters } from "@/lib/pokemon/filter";
import type { PokemonCellData, PokedexFilters, MasteryStatus } from "@/lib/pokemon/filter";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { sortPokemon, parseSort } from "@/lib/pokedex/sort";
import type { PokedexSortOrder } from "@/lib/pokedex/sort";
import PokedexFilterBar from "./PokedexFilterBar";
import PokedexGrid from "./PokedexGrid";

// ---------------------------------------------------------------------------
// Active filter count
// ---------------------------------------------------------------------------

function countActiveFilters(filters: PokedexFilters): number {
  let count = 0;
  if (filters.query.trim() !== "") count += 1;
  if (filters.types.length > 0) count += 1;
  if (filters.gen !== null) count += 1;
  if (filters.hasAlternateForms) count += 1;
  if (filters.masteryStatus !== "all") count += 1;
  return count;
}

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

function buildUrl(filters: PokedexFilters, sort: PokedexSortOrder): string {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.types.length > 0) params.set("type", filters.types.join(","));
  if (filters.gen !== null) params.set("gen", String(filters.gen));
  if (filters.hasAlternateForms) params.set("forms", "1");
  if (filters.masteryStatus !== "all") params.set("mastery", filters.masteryStatus);
  if (sort !== "national") params.set("sort", sort);
  const qs = params.toString();
  return qs ? `/pokedex?${qs}` : "/pokedex";
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = { enrichedPokemon: PokemonCellData[] };

// ---------------------------------------------------------------------------
// PokedexFiltered
// ---------------------------------------------------------------------------

export default function PokedexFiltered({ enrichedPokemon }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { flags } = useSuperuser();

  const filters = parseFilters(searchParams);
  const sort = parseSort(searchParams.get("sort"));

  // Disclosure state — collapsed by default so the grid is visible first.
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();

  // Local state for query so the input is immediately responsive; URL updates
  // are debounced so we don't push a new history entry on every keystroke.
  const [localQuery, setLocalQuery] = useState(filters.query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleQueryChange = useCallback(
    (q: string) => {
      setLocalQuery(q);
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        router.replace(buildUrl({ ...filters, query: q }, sort), { scroll: false });
      }, 150);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, filters.types, filters.gen, sort],
  );

  const handleTypeToggle = useCallback(
    (type: string) => {
      const newTypes = filters.types.includes(type)
        ? filters.types.filter((t) => t !== type)
        : [...filters.types, type];
      router.replace(buildUrl({ ...filters, types: newTypes }, sort), {
        scroll: false,
      });
    },
    [router, filters, sort],
  );

  const handleGenChange = useCallback(
    (gen: number | null) => {
      router.replace(buildUrl({ ...filters, gen }, sort), { scroll: false });
    },
    [router, filters, sort],
  );

  const handleAlternateFormsToggle = useCallback(() => {
    router.replace(
      buildUrl({ ...filters, hasAlternateForms: !filters.hasAlternateForms }, sort),
      { scroll: false },
    );
  }, [router, filters, sort]);

  const handleMasteryChange = useCallback(
    (masteryStatus: MasteryStatus) => {
      router.replace(buildUrl({ ...filters, masteryStatus }, sort), { scroll: false });
    },
    [router, filters, sort],
  );

  const handleSortChange = useCallback(
    (newSort: PokedexSortOrder) => {
      router.replace(buildUrl(filters, newSort), { scroll: false });
    },
    [router, filters],
  );

  // When pretendAllMastered is on, every Pokémon reads as mastered in the grid,
  // so "not-yet-mastered" would always yield an empty result. Override the
  // effective mastery filter to "all" so the grid stays coherent.
  const effectiveMasteryStatus: MasteryStatus = flags.pretendAllMastered
    ? "all"
    : filters.masteryStatus;

  const effectiveFilters: PokedexFilters = {
    ...filters,
    query: localQuery,
    masteryStatus: effectiveMasteryStatus,
  };

  const filtered = filterPokemon(enrichedPokemon, effectiveFilters);

  // Apply sort. Memoised to avoid re-sorting 1025 items on every render when
  // only unrelated state changes. WebKit note: sort of 1025 items is O(n log n)
  // and runs in <1 ms on modern devices — no measurable per-render cost.
  const sorted = useMemo(
    () => sortPokemon(filtered, sort, flags.pretendAllMastered),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, sort, flags.pretendAllMastered],
  );

  const activeCount = countActiveFilters(effectiveFilters);

  // When a custom sort is active, collapse into a flat list so the generation
  // headings (which assume national-number order within each section) do not
  // produce misleading groupings. National-number sort preserves the original
  // gen-sectioned layout.
  const isCustomSort = sort !== "national";
  const activeGen = !isCustomSort ? (filters.gen ?? undefined) : undefined;

  return (
    <>
      {/* Filter disclosure — collapsed by default so the grid is the first visible content */}
      <div className="mb-6">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className="h-4 w-4 text-zinc-500"
            aria-hidden="true"
          >
            <path
              d="M2 4h12M4 8h8M6 12h4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <span>Filters</span>
          {!isOpen && activeCount > 0 && (
            <span
              aria-label={`${activeCount} active filter${activeCount === 1 ? "" : "s"}`}
              className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--theme-accent)] px-1.5 text-xs font-semibold text-white"
            >
              {activeCount}
            </span>
          )}
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className={[
              "ml-auto h-4 w-4 text-zinc-400 transition-transform",
              isOpen ? "rotate-180" : "",
            ].join(" ")}
            aria-hidden="true"
          >
            <path
              d="M4 6L8 10L12 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* Panel is always in the DOM so aria-controls references a real element (#856) */}
        <div id={panelId} hidden={!isOpen}>
          <PokedexFilterBar
            filters={effectiveFilters}
            sort={sort}
            onQueryChange={handleQueryChange}
            onTypeToggle={handleTypeToggle}
            onGenChange={handleGenChange}
            onAlternateFormsToggle={handleAlternateFormsToggle}
            onMasteryChange={handleMasteryChange}
            onSortChange={handleSortChange}
            superuserMasteryLocked={flags.pretendAllMastered}
          />
        </div>
      </div>

      <PokedexGrid
        pokemon={sorted}
        activeGen={activeGen}
        flatList={isCustomSort}
      />
    </>
  );
}
