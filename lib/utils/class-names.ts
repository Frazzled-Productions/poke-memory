/**
 * Shared Tailwind class-name constants.
 *
 * Extract repeated Tailwind literals into named constants so dark-mode variant
 * changes, spacing adjustments, and border colour tweaks propagate everywhere
 * from a single edit. Only patterns that appear verbatim in 8+ places are
 * extracted - one-off strings stay inline.
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
 * Lighter than the body-muted shade - used on recharts tick labels and
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
 * `text-sm` variant of `sectionLabel`. Used for Settings section headings
 * (`CollapsibleSection`, `IntensityPicker`, `FsrsOptimizerSection`) and the
 * What's New changelog kind labels, where a slightly larger size gives the
 * heading a clearer hierarchy above its body content.
 */
export const sectionLabelSm =
  "text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

/**
 * Subtle section label with `tracking-widest` and inverted zinc tones
 * (`text-zinc-400 dark:text-zinc-500`). Used for in-card fact labels on the
 * practice card reveal surfaces (`PokemonCard`, `EvolutionCardLayout`) where
 * the label sits against a brighter value and intentionally recedes.
 */
export const sectionLabelSubtle =
  "text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500";

/**
 * `text-sm` variant of `sectionLabelSubtle`. Used for Pokédex detail section
 * headings (`PokemonDetailDisclosure`) where the heading must stand slightly
 * taller while still using the inverted zinc tone of the detail surface.
 */
export const sectionLabelSmSubtle =
  "text-sm font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500";

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

/**
 * Muted body text at `text-xs`. The `text-xs` companion to `mutedText`
 * (`text-sm`). Used for helper paragraphs, field descriptions, and supporting
 * metadata throughout Settings, Stats, and review surfaces.
 *
 * Compose spacing at call sites: `\`mt-1 \${mutedTextXs}\`` or
 * `cn("mt-1", mutedTextXs)` - do not inline the colour classes directly.
 */
export const mutedTextXs = "text-xs text-zinc-500 dark:text-zinc-400";

/**
 * Standard in-prose hyperlink style. Underlined with a theme-accent focus ring
 * and a subtle zinc hover tone. Used across the privacy and terms pages, and
 * `ChildFriendlySummary`.
 */
export const inlineLink =
  "underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded";

/**
 * Chart tooltip card container used by all five Stats custom tooltips
 * (`DirectionBreakdownChart`, `MasteryOverTimeChart`, `DifficultyHistogram`,
 * `GradeDistributionChart`, `ActivityHistoryChart`). Uses `border-zinc-700`
 * in dark mode - distinct from the `cardPanel` / `cardPanelPadded` family
 * which use `border-zinc-800`.
 */
export const chartTooltipCard =
  "rounded-lg border border-zinc-200 bg-background px-3 py-2 text-xs shadow-lg dark:border-zinc-700";

// ---------------------------------------------------------------------------
// Page layout tokens (added for #1729 / #1735)
// ---------------------------------------------------------------------------

/**
 * Page title: the single `<h1>` on every page.
 * `text-2xl font-bold tracking-tight text-foreground`.
 */
export const pageTitle =
  "text-2xl font-bold tracking-tight text-foreground";

/**
 * Super-section `<h2>` heading (text-xl). Used for top-level sections inside
 * a page (e.g. Journey's "Your progress / Collection / Breakdown" groups).
 * `text-xl font-semibold text-foreground`.
 */
export const sectionHeadingLg =
  "text-xl font-semibold text-foreground";

/**
 * Content-section `<h3>` (or occasionally `<h2>`) heading (text-lg). Used
 * for subsections below a super-section heading (or the sole heading level
 * where no super-sections exist).
 * `text-lg font-semibold text-foreground`.
 */
export const sectionHeading =
  "text-lg font-semibold text-foreground";

/**
 * Deep-subsection `<h4>` heading (text-base). Used for a fourth tier of
 * nesting below a content-section `<h3>`, when a page needs a finer-grained
 * heading hierarchy (added for #1759).
 * `text-base font-semibold text-foreground`.
 */
export const sectionHeadingSm =
  "text-base font-semibold text-foreground";
