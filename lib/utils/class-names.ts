/**
 * Shared Tailwind class-name constants.
 *
 * Extract repeated Tailwind literals into named constants so dark-mode variant
 * changes, spacing adjustments, and border colour tweaks propagate everywhere
 * from a single edit. Only patterns that appear verbatim in 8+ places are
 * extracted — one-off strings stay inline.
 *
 * Import individual constants as needed:
 *   import { cardPanel, colStack } from "@/lib/utils/class-names";
 */

/** Rounded card panel with a standard `p-4` inset. Used by all Stats chart cards. */
export const cardPanel =
  "rounded-xl border border-zinc-200 bg-background p-4 dark:border-zinc-800";

/**
 * Rounded card panel with `px-5 py-4` inset. Used by Settings section panels
 * and similar surfaces that need slightly wider horizontal padding.
 */
export const cardPanelPadded =
  "rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800";

/** Vertical flex stack with a 2-unit gap. */
export const colStack = "flex flex-col gap-2";

/** Vertical flex stack with a 4-unit gap. */
export const colStackLg = "flex flex-col gap-4";

/**
 * Muted chart-axis / label text colour.
 * Lighter than the body-muted shade — used on recharts tick labels and
 * secondary annotations inside chart areas.
 */
export const chartTickText = "text-zinc-400 dark:text-zinc-500";

/**
 * Standard muted body text at `text-sm`. Used for helper paragraphs,
 * empty-state copy, and supporting metadata throughout the app.
 */
export const mutedText = "text-sm text-zinc-500 dark:text-zinc-400";

/**
 * Uppercase section/group label used in Settings panels and onboarding
 * surfaces. Applied to `<p>`, `<legend>`, and `<h3>` elements that head a
 * labelled group of controls.
 */
export const sectionLabel =
  "text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

/**
 * Modal `<dialog>` panel with the standard rounded border, shadow, and
 * semi-transparent backdrop. Completes the `cardPanel` / `cardPanelPadded`
 * panel family for the dialog surface.
 */
export const dialogPanel =
  "rounded-xl border border-zinc-200 bg-background p-6 shadow-xl backdrop:bg-black/50 dark:border-zinc-800";

/**
 * Numeric value text on Stats chart tooltip cards. Tabular figures with a
 * neutral muted tone, consistent across all six chart components.
 */
export const statValue = "tabular-nums text-zinc-600 dark:text-zinc-300";
