"use client";

import { useMemo } from "react";
import {
  VERSION_GROUP_LABELS,
  versionGroupGeneration,
  compareVersionGroupSlugs,
} from "@/lib/pokemon/versionGroupLabels";
import { SEED_POKEMON } from "@/lib/pokemon/seed";

type Props = {
  /** Currently-selected version-group slugs. */
  selected: string[];
  /** Replace the selection with `next`. */
  onChange: (next: string[]) => void;
};

const GEN_LABELS: Record<number, string> = {
  0: "Other",
  1: "Generation I",
  2: "Generation II",
  3: "Generation III",
  4: "Generation IV",
  5: "Generation V",
  6: "Generation VI",
  7: "Generation VII",
  8: "Generation VIII",
  9: "Generation IX",
};

const UNSELECTED_PILL =
  "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
const SELECTED_ACCENT = "border-rose-500 bg-rose-500 text-white";
const PILL_BASE =
  "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors text-left";

/**
 * Version-group slugs present in the seed, grouped by generation number and
 * sorted for display. Computed once at module load — the seed is a build-time
 * constant so the result is stable for the module lifetime (mirrors the
 * `_seedById` / `_legendaryIds` pattern in `scope.ts`).
 *
 * Generation 0 ("Other") is placed after all numbered generations so mainline
 * games appear first in the picker.
 */
const _groupedVersionGroups: [number, string[]][] = (() => {
  const seen = new Set<string>();
  for (const p of SEED_POKEMON) {
    for (const vg of (p as { versionGroups?: string[] }).versionGroups ?? []) seen.add(vg);
  }
  const map = new Map<number, string[]>();
  for (const slug of [...seen].sort(compareVersionGroupSlugs)) {
    const gen = versionGroupGeneration(slug);
    if (!map.has(gen)) map.set(gen, []);
    map.get(gen)!.push(slug);
  }
  return [...map.entries()].sort((a, b) => {
    if (a[0] === 0) return 1;
    if (b[0] === 0) return -1;
    return a[0] - b[0];
  });
})();

/**
 * Game / version-group scope picker (#1089). Renders a vertical list of
 * generations; each generation is a header followed by a wrap of game pills.
 *
 * Selection is multi-select. The header carries an "All" toggle that adds /
 * removes every game in that generation in one tap, so users can pick a whole
 * generation (e.g. all Gen VIII games) without 5 individual taps.
 */
export function GameScopePicker({ selected, onChange }: Props) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggleGame(slug: string): void {
    if (selectedSet.has(slug)) {
      onChange(selected.filter((s) => s !== slug));
    } else {
      onChange([...selected, slug]);
    }
  }

  function toggleGen(slugs: string[]): void {
    const allSelected = slugs.every((s) => selectedSet.has(s));
    if (allSelected) {
      // Remove every game in this generation.
      const toRemove = new Set(slugs);
      onChange(selected.filter((s) => !toRemove.has(s)));
    } else {
      // Add every game in this generation (preserving existing selection).
      const next = new Set(selected);
      for (const s of slugs) next.add(s);
      onChange([...next]);
    }
  }

  if (_groupedVersionGroups.length === 0) {
    return (
      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        No games in the current seed.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {_groupedVersionGroups.map(([gen, slugs]) => {
        const allSelected = slugs.every((s) => selectedSet.has(s));
        const genName = GEN_LABELS[gen] ?? "Other";
        return (
          <div key={gen}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {genName}
              </span>
              <button
                type="button"
                onClick={() => toggleGen(slugs)}
                className="text-xs text-rose-600 hover:underline dark:text-rose-400"
                aria-label={
                  allSelected
                    ? `Clear all games in ${genName}`
                    : `Select all games in ${genName}`
                }
              >
                {allSelected ? "Clear all" : "Select all"}
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {slugs.map((slug) => {
                const isSelected = selectedSet.has(slug);
                const label = VERSION_GROUP_LABELS[slug] ?? slug;
                return (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => toggleGame(slug)}
                    aria-pressed={isSelected}
                    aria-label={label}
                    className={
                      PILL_BASE + " " + (isSelected ? SELECTED_ACCENT : UNSELECTED_PILL)
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
