/**
 * FilterChip - a rounded-full pill toggle button.
 *
 * Encapsulates the active/inactive class variants, aria-pressed, and the
 * --theme-accent focus-visible ring so a theme-token or a11y change propagates
 * from one place (DRY per AGENTS.md "Single source of truth for shared concepts").
 *
 * Usage:
 *   <FilterChip active={isSelected} onClick={() => toggle(type)}>
 *     {label}
 *   </FilterChip>
 *
 * Padding defaults to `px-3 py-0.5`. Type chips that need narrower horizontal
 * padding pass `padding="px-2.5 py-0.5"` explicitly.
 *
 * Two colour variants are supported:
 *   - "default" (zinc-800/white active, zinc-100/zinc-700 inactive) - for
 *     generation, mastery-status, and boolean-toggle pills.
 *   - "custom" - caller provides `activeClassName` for the coloured active
 *     state (e.g. Pokémon type chips where each type has its own bg+text).
 */

import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterChipProps = {
  /** Whether the chip is in its active/pressed state. */
  active: boolean;
  /** Click handler - called when the chip is toggled. */
  onClick: () => void;
  children: ReactNode;
  /**
   * Accessible label override. Provide when the visible text alone is not
   * sufficiently descriptive (e.g. screen-reader-friendly type names).
   */
  ariaLabel?: string;
  /**
   * Extra Tailwind classes applied to the active state instead of the
   * default zinc-800/white. Useful for type chips with per-type colours.
   * When omitted the component uses the standard zinc toggle colours.
   */
  activeClassName?: string;
  /**
   * Padding classes. Defaults to "px-3 py-0.5". Pass "px-2.5 py-0.5" for
   * type chips that need slightly narrower horizontal padding.
   */
  padding?: string;
  /**
   * Extra classes applied unconditionally, e.g. a disabled-state opacity
   * class added by the caller.
   */
  className?: string;
  /** Whether the chip is disabled. */
  disabled?: boolean;
  /** Tooltip title attribute - shown on hover. */
  title?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Structural classes that are always present, independent of state. */
const BASE =
  "rounded-full text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-1";
/** Inactive state - muted zinc tone. */
const INACTIVE = "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
/** Default active state - inverted zinc (dark background). */
const ACTIVE_DEFAULT = "bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FilterChip({
  active,
  onClick,
  children,
  ariaLabel,
  activeClassName,
  padding = "px-3 py-0.5",
  className,
  disabled,
  title,
}: FilterChipProps) {
  const activeClasses = activeClassName ?? ACTIVE_DEFAULT;
  const stateClasses = active ? activeClasses : INACTIVE;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      disabled={disabled}
      title={title}
      className={[BASE, padding, stateClasses, className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}
