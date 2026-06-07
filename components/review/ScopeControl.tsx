"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { POKEMON_TYPES, TYPE_COLORS } from "@/lib/pokemon/types";
import { useSeed } from "@/lib/pokemon/SeedContext";
import type { SeedPokemon } from "@/lib/pokemon/seed";
import type { FormCategory } from "@/lib/pokemon/forms";
import { colStack, mutedTextXs, sectionLabel } from "@/lib/utils/class-names";
import {
  EMPTY_SCOPE,
  countMatchingSpecies,
  isScopeEmpty,
  scopeLabel,
  type FormCategoryFilter,
  type PracticeScope,
  type PracticeScopePreset,
  type ScopeMatchContext,
} from "@/lib/review/scope";
import { GameScopePicker } from "@/components/review/GameScopePicker";
import { getTypeName, type TypeTranslations } from "@/lib/i18n/typeNames";

type Props = {
  scope: PracticeScope;
  onChange: (next: PracticeScope) => void;
  /**
   * When false (the default), the "Alternate forms" section is hidden entirely
   * - the gate in Settings is the master switch. When true, the per-category
   * filter is rendered as normal (#658).
   */
  alternateFormsEnabled?: boolean;
  /**
   * Species ids in an incomplete evolution chain (#995). Supplied by
   * `ReviewSession` so the live "X of N match" count is accurate when the
   * "Incomplete evolution chains" preset is selected. When omitted, an
   * `incomplete-chains` scope counts as matching nothing.
   */
  incompleteChainSpeciesIds?: ReadonlySet<number>;
  /**
   * Species ids where exactly one practice leg is mastered and the other is
   * not (#1767). Supplied by `ReviewSession` so the live "X of N match" count
   * is accurate when the "Almost mastered" preset is selected. When omitted,
   * the preset counts as matching nothing.
   */
  masteryBlockingSpeciesIds?: ReadonlySet<number>;
};

const GENS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const ROMAN: Record<number, string> = {
  1: "I", 2: "II", 3: "III", 4: "IV", 5: "V",
  6: "VI", 7: "VII", 8: "VIII", 9: "IX",
};
// Keys only - labels are resolved via t() at render time to support locale switching.
const PRESET_KEYS: PracticeScopePreset[] = ["starters", "legendaries", "incomplete-chains", "mastery-blockers"];

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
function presentFormCategories(seed: readonly SeedPokemon[]): FormCategory[] {
  const seen = new Set<FormCategory>();
  for (const p of seed) {
    const cat = (p as { formCategory?: FormCategory }).formCategory;
    if (cat && cat !== "default") seen.add(cat);
  }
  // Return in a stable, user-facing order.
  const ORDER: FormCategory[] = ["regional", "forme", "mega", "gmax", "primal"];
  return ORDER.filter((c) => seen.has(c));
}

// Form category labels are resolved via tScope() at render time - see ScopeControl.

const UNSELECTED_PILL =
  "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
const SELECTED_ACCENT = "border-rose-500 bg-rose-500 text-white";
const PILL_BASE =
  "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors";

/**
 * A collapsible section inside the scope panel (#1110). Uses `<details>` and
 * `<summary>` for accessibility-by-default expand/collapse - no JS state
 * needed. The surrounding `<div role="group">` preserves the ARIA group
 * semantics that E2E and assistive-technology selectors rely on.
 *
 * Multiple sections can be open simultaneously (expansion-panels model, not
 * exclusive accordion). `defaultOpen` is true when the section already has
 * an active filter so the user can see the active state immediately.
 */
function ScopeSection({
  legend,
  legendId,
  defaultOpen,
  hasDivider = true,
  children,
}: {
  legend: string;
  /** Unique id used to link the group role to the visible label. */
  legendId: string;
  defaultOpen: boolean;
  hasDivider?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-labelledby={legendId}
      className={hasDivider ? "border-b border-zinc-100 dark:border-zinc-800/60" : ""}
    >
      <details open={defaultOpen} className="group/details py-1">
        <summary
          id={legendId}
          className="flex cursor-pointer list-none items-center justify-between gap-2 py-0.5 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500"
        >
          <span className={sectionLabel}>
            {legend}
          </span>
          {/* Chevron rotates when the <details> is open via the group-open variant. */}
          <span
            aria-hidden="true"
            className="text-zinc-400 transition-transform duration-150 group-open/details:rotate-180"
          >
            ▾
          </span>
        </summary>
        <div className="mt-2 pb-2">{children}</div>
      </details>
    </div>
  );
}

export function ScopeControl({
  scope,
  onChange,
  alternateFormsEnabled = false,
  incompleteChainSpeciesIds,
  masteryBlockingSpeciesIds,
}: Props) {
  const [open, setOpen] = useState(false);
  const { seed } = useSeed();
  const seedPokemon = seed?.seedPokemon ?? [];
  // Note: the loop variable inside POKEMON_TYPES.map is named `type` (not `t`)
  // to avoid shadowing the `tTypes` translation function. See LANDMINE note in
  // issue #1389 specialist notes.
  const tTypes = useTranslations("types") as TypeTranslations;
  const tScope = useTranslations("practice.scope");
  const active = !isScopeEmpty(scope);
  // Context for progress-dependent presets (#995, #1767): the live count must
  // consult the same species sets the session uses, so both counts agree.
  const scopeContext: ScopeMatchContext = useMemo(
    () => ({ incompleteChainSpeciesIds, masteryBlockingSpeciesIds }),
    [incompleteChainSpeciesIds, masteryBlockingSpeciesIds],
  );
  // When the forms gate is off, alternate-form entries are excluded from the
  // count so the "X of N" display is consistent with what the session builds.
  const matchCount = countMatchingSpecies(
    seedPokemon,
    scope,
    alternateFormsEnabled,
    scopeContext,
  );
  const totalCount = countMatchingSpecies(seedPokemon, EMPTY_SCOPE, alternateFormsEnabled);
  const availableFormCategories = useMemo(() => presentFormCategories(seedPokemon), [seedPokemon]);

  const formFilter: FormCategoryFilter = scope.formCategories ?? { mode: "all" };

  function setFormFilter(fc: FormCategoryFilter): void {
    onChange({ ...scope, formCategories: fc });
  }

  // Determine which accordion sections should start open. A section opens by
  // default when it already has an active filter so the active state is
  // visible immediately without extra interaction.
  const gensActive = scope.gens.length > 0;
  const typesActive = scope.types.length > 0;
  const presetsActive = scope.presets.length > 0;
  const gamesActive = (scope.games ?? []).length > 0;
  const formsActive = alternateFormsEnabled && formFilter.mode !== "all";

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
          <span className={sectionLabel}>
            {tScope("label")}
          </span>
          <span
            className={
              active
                ? "rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                : mutedTextXs
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
            {tScope("clear")}
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          id="scope-panel"
          className="mt-2 flex flex-col rounded-lg border border-zinc-200 bg-background p-3 text-sm dark:border-zinc-800"
        >
          {/* Generation axis - filters by species introduction generation.
              Label reads "I"–"IX" so it is visually distinct from the
              games-axis bulk-action labels which spell out game names. */}
          <ScopeSection
            legend={tScope("generation")}
            legendId="scope-section-generation"
            defaultOpen={gensActive}
          >
            <div className="flex flex-wrap gap-1.5">
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
          </ScopeSection>

          {/* Type axis. */}
          <ScopeSection
            legend={tScope("type")}
            legendId="scope-section-type"
            defaultOpen={typesActive}
          >
            <div className="flex flex-wrap gap-1.5">
              {POKEMON_TYPES.map((type) => {
                const selected = scope.types.includes(type);
                const colors = TYPE_COLORS[type];
                const selectedClasses = colors
                  ? `border-transparent ${colors.bg} ${colors.text}`
                  : SELECTED_ACCENT;
                const typeName = getTypeName(type, tTypes);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onChange({ ...scope, types: toggleStr(scope.types, type) })}
                    aria-label={typeName}
                    aria-pressed={selected}
                    className={
                      PILL_BASE +
                      " " +
                      (selected ? selectedClasses : UNSELECTED_PILL)
                    }
                  >
                    {typeName}
                  </button>
                );
              })}
            </div>
          </ScopeSection>

          {/* Presets axis. */}
          <ScopeSection
            legend={tScope("groups")}
            legendId="scope-section-groups"
            defaultOpen={presetsActive}
          >
            <div className="flex flex-wrap gap-1.5">
              {PRESET_KEYS.map((key) => {
                const selected = scope.presets.includes(key);
                const presetLabel =
                  key === "starters" ? tScope("presetStarters")
                  : key === "legendaries" ? tScope("presetLegendaries")
                  : key === "incomplete-chains" ? tScope("presetIncompleteChains")
                  : tScope("presetMasteryBlockers");
                const ariaLabel =
                  key === "mastery-blockers"
                    ? tScope("presetMasteryBlockersDescription")
                    : presetLabel;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() =>
                      onChange({ ...scope, presets: togglePreset(scope.presets, key) })
                    }
                    aria-pressed={selected}
                    aria-label={ariaLabel}
                    className={
                      PILL_BASE + " " + (selected ? SELECTED_ACCENT : UNSELECTED_PILL)
                    }
                  >
                    {presetLabel}
                  </button>
                );
              })}
            </div>
          </ScopeSection>

          {/* Games axis - filters by appearance in a specific game's Pokédex.
              Distinct from the gens axis: "Generation II games" (Gold/Silver/Crystal)
              includes many Gen I species via the Johto dex. The gens axis strictly
              filters by species introduction generation. Bulk-action labels spell
              out game names to prevent confusion with the gens-axis labels (#1110). */}
          <ScopeSection
            legend={tScope("games")}
            legendId="scope-section-games"
            defaultOpen={gamesActive}
            hasDivider={alternateFormsEnabled}
          >
            <p className={`mb-2 ${mutedTextXs}`}>
              {tScope("gamesDescription")}
            </p>
            <GameScopePicker
              selected={scope.games ?? []}
              onChange={(games) => onChange({ ...scope, games })}
            />
          </ScopeSection>

          {/* "Alternate forms" category filter - only shown when the master
              gate in Settings is on. When it is off, the section is hidden
              entirely because no form cards surface in practice (#658). */}
          {alternateFormsEnabled ? (
            <ScopeSection
              legend={tScope("alternateForms")}
              legendId="scope-section-forms"
              defaultOpen={formsActive}
              hasDivider={false}
            >
              <div className={colStack}>
                {(
                  [
                    { value: "all" as const, labelKey: "formIncludeAll" as const },
                    { value: "default-only" as const, labelKey: "formDefaultOnly" as const },
                    { value: "include" as const, labelKey: "formChooseCategories" as const },
                  ]
                ).map(({ value, labelKey }) => (
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
                    <span className="text-zinc-700 dark:text-zinc-300">{tScope(labelKey)}</span>
                  </label>
                ))}
                {formFilter.mode === "include" && availableFormCategories.length > 0 ? (
                  <div className="ml-5 mt-1 flex flex-col gap-1.5">
                    {availableFormCategories.map((cat) => {
                      const checked =
                        formFilter.mode === "include" && formFilter.categories.includes(cat);
                      const formCatLabel =
                        cat === "regional" ? tScope("formCategoryRegional")
                        : cat === "forme" ? tScope("formCategoryForme")
                        : cat === "mega" ? tScope("formCategoryMega")
                        : cat === "gmax" ? tScope("formCategoryGmax")
                        : cat === "primal" ? tScope("formCategoryPrimal")
                        : cat;
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
                            {formCatLabel}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
                {formFilter.mode === "include" && availableFormCategories.length === 0 ? (
                  <p className="ml-5 text-xs text-zinc-400 dark:text-zinc-500">
                    {tScope("noAlternateForms")}
                  </p>
                ) : null}
              </div>
            </ScopeSection>
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
              {tScope("matchCount", { match: matchCount, total: totalCount })}
            </p>
            {active ? (
              <p className={mutedTextXs}>
                {tScope("hiddenCardsPaused")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
