"use client";

import { useMemo, useState } from "react";
import { POKEMON_TYPES, TYPE_COLORS } from "@/lib/pokemon/types";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import type { FormCategory } from "@/lib/pokemon/forms";
import {
  EMPTY_SCOPE,
  countMatchingSpecies,
  isScopeEmpty,
  scopeLabel,
  type FormCategoryFilter,
  type PracticeScope,
  type PracticeScopePreset,
} from "@/lib/review/scope";

type Props = {
  scope: PracticeScope;
  onChange: (next: PracticeScope) => void;
  /**
   * When false (the default), the "Alternate forms" section is hidden entirely
   * — the gate in Settings is the master switch. When true, the per-category
   * filter is rendered as normal (#658).
   */
  alternateFormsEnabled?: boolean;
};

const GENS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const ROMAN: Record<number, string> = {
  1: "I", 2: "II", 3: "III", 4: "IV", 5: "V",
  6: "VI", 7: "VII", 8: "VIII", 9: "IX",
};
const PRESETS: { key: PracticeScopePreset; label: string }[] = [
  { key: "starters", label: "Starters" },
  { key: "legendaries", label: "Legendaries" },
];

function toggleNum(arr: number[], v: number): number[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}
function toggleStr(arr: string[], v: string): string[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}
function togglePreset(arr: PracticeScopePreset[], v: PracticeScopePreset): PracticeScopePreset[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}
function toggleCategory(arr: FormCategory[], v: FormCategory): FormCategory[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

/** Derive the set of non-default form categories present in the seed at runtime. */
function presentFormCategories(seed: typeof SEED_POKEMON): FormCategory[] {
  const seen = new Set<FormCategory>();
  for (const p of seed) {
    const cat = (p as { formCategory?: FormCategory }).formCategory;
    if (cat && cat !== "default") seen.add(cat);
  }
  // Return in a stable, user-facing order.
  const ORDER: FormCategory[] = ["regional", "forme", "mega", "gmax", "primal"];
  return ORDER.filter((c) => seen.has(c));
}

const FORM_CATEGORY_LABELS: Partial<Record<FormCategory, string>> = {
  regional: "Regional variants",
  forme: "Out-of-battle formes",
  mega: "Mega Evolutions",
  gmax: "Gigantamax",
  primal: "Primal Reversion",
};

const UNSELECTED_PILL =
  "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
const SELECTED_ACCENT = "border-rose-500 bg-rose-500 text-white";
const PILL_BASE =
  "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors";

export function ScopeControl({ scope, onChange, alternateFormsEnabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const active = !isScopeEmpty(scope);
  const matchCount = countMatchingSpecies(SEED_POKEMON, scope);
  const totalCount = SEED_POKEMON.length;
  const availableFormCategories = useMemo(() => presentFormCategories(SEED_POKEMON), []);

  const formFilter: FormCategoryFilter = scope.formCategories ?? { mode: "all" };

  function setFormFilter(fc: FormCategoryFilter): void {
    onChange({ ...scope, formCategories: fc });
  }

  return (
    <div className="w-full max-w-xl">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-background px-3 py-2 text-sm dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left focus-visible:outline-none"
          aria-expanded={open}
          aria-controls="scope-panel"
        >
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Scope
          </span>
          <span
            className={
              active
                ? "rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                : "text-xs text-zinc-500 dark:text-zinc-400"
            }
          >
            {scopeLabel(scope)}
          </span>
          <span aria-hidden="true" className="ml-auto text-zinc-400">
            {open ? "▴" : "▾"}
          </span>
        </button>
        {active ? (
          <button
            type="button"
            onClick={() => onChange(EMPTY_SCOPE)}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Clear
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          id="scope-panel"
          className="mt-2 flex flex-col gap-4 rounded-lg border border-zinc-200 bg-background p-3 text-sm dark:border-zinc-800"
        >
          <fieldset>
            <legend className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Generation
            </legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {GENS.map((g) => {
                const selected = scope.gens.includes(g);
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => onChange({ ...scope, gens: toggleNum(scope.gens, g) })}
                    aria-label={`Generation ${ROMAN[g]}`}
                    aria-pressed={selected}
                    className={
                      PILL_BASE + " " + (selected ? SELECTED_ACCENT : UNSELECTED_PILL)
                    }
                  >
                    {ROMAN[g]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Type
            </legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {POKEMON_TYPES.map((t) => {
                const selected = scope.types.includes(t);
                const colors = TYPE_COLORS[t];
                const selectedClasses = colors
                  ? `border-transparent ${colors.bg} ${colors.text}`
                  : SELECTED_ACCENT;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onChange({ ...scope, types: toggleStr(scope.types, t) })}
                    aria-label={`Type ${t}`}
                    aria-pressed={selected}
                    className={
                      PILL_BASE +
                      " capitalize " +
                      (selected ? selectedClasses : UNSELECTED_PILL)
                    }
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Groups
            </legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => {
                const selected = scope.presets.includes(p.key);
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() =>
                      onChange({ ...scope, presets: togglePreset(scope.presets, p.key) })
                    }
                    aria-pressed={selected}
                    className={
                      PILL_BASE + " " + (selected ? SELECTED_ACCENT : UNSELECTED_PILL)
                    }
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* "Alternate forms" category filter — only shown when the master
              gate in Settings is on. When it is off, the section is hidden
              entirely because no form cards surface in practice (#658). */}
          {alternateFormsEnabled ? (
            <fieldset>
              <legend className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Alternate forms
              </legend>
              <div className="mt-2 flex flex-col gap-2">
                {(
                  [
                    { value: "all", label: "Include all" },
                    { value: "default-only", label: "Default form only" },
                    { value: "include", label: "Choose categories…" },
                  ] as const
                ).map(({ value, label }) => (
                  <label key={value} className="flex cursor-pointer items-center gap-2 text-xs">
                    <input
                      type="radio"
                      name="form-filter-mode"
                      value={value}
                      checked={formFilter.mode === value}
                      onChange={() => {
                        if (value === "include") {
                          setFormFilter({ mode: "include", categories: [] });
                        } else {
                          setFormFilter({ mode: value });
                        }
                      }}
                      className="accent-rose-500"
                    />
                    <span className="text-zinc-700 dark:text-zinc-300">{label}</span>
                  </label>
                ))}
                {formFilter.mode === "include" && availableFormCategories.length > 0 ? (
                  <div className="ml-5 mt-1 flex flex-col gap-1.5">
                    {availableFormCategories.map((cat) => {
                      const checked =
                        formFilter.mode === "include" && formFilter.categories.includes(cat);
                      return (
                        <label
                          key={cat}
                          className="flex cursor-pointer items-center gap-2 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              if (formFilter.mode === "include") {
                                setFormFilter({
                                  mode: "include",
                                  categories: toggleCategory(formFilter.categories, cat),
                                });
                              }
                            }}
                            className="accent-rose-500"
                          />
                          <span className="text-zinc-700 dark:text-zinc-300">
                            {FORM_CATEGORY_LABELS[cat] ?? cat}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
                {formFilter.mode === "include" && availableFormCategories.length === 0 ? (
                  <p className="ml-5 text-xs text-zinc-400 dark:text-zinc-500">
                    No alternate forms in the current seed.
                  </p>
                ) : null}
              </div>
            </fieldset>
          ) : null}

          <div className="flex flex-col gap-1 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <p
              aria-live="polite"
              className={
                "text-xs " +
                (matchCount === 0
                  ? "font-medium text-red-600 dark:text-red-400"
                  : "text-zinc-600 dark:text-zinc-400")
              }
            >
              {matchCount} of {totalCount} Pokémon match
            </p>
            {active ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Hidden cards are paused — their review dates shift forward by the time
                they&apos;re hidden, so removing the scope won&apos;t flood your queue with overdue
                reviews.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
