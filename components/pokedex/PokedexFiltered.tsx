"use client";

import { useState, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { filterPokemon, parseFilters } from "@/lib/pokemon/filter";
import type { PokemonCellData, PokedexFilters, MasteryStatus } from "@/lib/pokemon/filter";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import PokedexFilterBar from "./PokedexFilterBar";
import PokedexGrid from "./PokedexGrid";

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

function buildUrl(filters: PokedexFilters): string {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.types.length > 0) params.set("type", filters.types.join(","));
  if (filters.gen !== null) params.set("gen", String(filters.gen));
  if (filters.hasAlternateForms) params.set("forms", "1");
  if (filters.masteryStatus !== "all") params.set("mastery", filters.masteryStatus);
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

  // Local state for query so the input is immediately responsive; URL updates
  // are debounced so we don't push a new history entry on every keystroke.
  const [localQuery, setLocalQuery] = useState(filters.query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleQueryChange = useCallback(
    (q: string) => {
      setLocalQuery(q);
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        router.replace(buildUrl({ ...filters, query: q }), { scroll: false });
      }, 150);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, filters.types, filters.gen],
  );

  const handleTypeToggle = useCallback(
    (type: string) => {
      const newTypes = filters.types.includes(type)
        ? filters.types.filter((t) => t !== type)
        : [...filters.types, type];
      router.replace(buildUrl({ ...filters, types: newTypes }), {
        scroll: false,
      });
    },
    [router, filters],
  );

  const handleGenChange = useCallback(
    (gen: number | null) => {
      router.replace(buildUrl({ ...filters, gen }), { scroll: false });
    },
    [router, filters],
  );

  const handleAlternateFormsToggle = useCallback(() => {
    router.replace(
      buildUrl({ ...filters, hasAlternateForms: !filters.hasAlternateForms }),
      { scroll: false },
    );
  }, [router, filters]);

  const handleMasteryChange = useCallback(
    (masteryStatus: MasteryStatus) => {
      router.replace(buildUrl({ ...filters, masteryStatus }), { scroll: false });
    },
    [router, filters],
  );

  // When pretendAllMastered is on, every Pokémon reads as mastered in the grid,
  // so "not-yet-mastered" would always yield an empty result. Override the
  // effective mastery filter to "all" so the grid stays coherent.
  const effectiveMasteryStatus: MasteryStatus = flags.pretendAllMastered
    ? "all"
    : filters.masteryStatus;

  const filtered = filterPokemon(enrichedPokemon, {
    ...filters,
    masteryStatus: effectiveMasteryStatus,
    query: localQuery,
  });

  return (
    <>
      <PokedexFilterBar
        filters={{ ...filters, query: localQuery, masteryStatus: effectiveMasteryStatus }}
        onQueryChange={handleQueryChange}
        onTypeToggle={handleTypeToggle}
        onGenChange={handleGenChange}
        onAlternateFormsToggle={handleAlternateFormsToggle}
        onMasteryChange={handleMasteryChange}
        superuserMasteryLocked={flags.pretendAllMastered}
      />
      <PokedexGrid
        pokemon={filtered}
        activeGen={filters.gen ?? undefined}
      />
    </>
  );
}
