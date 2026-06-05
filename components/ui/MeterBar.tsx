/**
 * MeterBar - a horizontal progress/meter bar with canonical accessible markup.
 *
 * Emits role="meter" with aria-valuenow / aria-valuemin / aria-valuemax and an
 * aria-label from the `label` prop. This fixes the inconsistency across the
 * codebase where some bars used role=meter+aria-valuenow, some used
 * aria-hidden+sr-only, and some had no a11y attributes at all.
 *
 * Visual contract:
 *   - Track: h-1.5, rounded-full, bg-zinc-200 + caller-supplied dark-mode track
 *   - Fill: h-full, rounded-full, colour via `fillClass`, width via inline style
 *
 * The caller owns:
 *   - `fillClass` - fill colour (e.g. "bg-emerald-500 dark:bg-emerald-400")
 *   - `trackClass` - dark-mode track override (defaults to "dark:bg-zinc-700");
 *     pass "dark:bg-zinc-800" for surfaces that use the darker track tone
 *   - `transitionClass` - CSS transition applied to the fill div. Defaults to
 *     "transition-all". Pass "" to suppress animation, or e.g.
 *     "transition-all duration-300" to match an exact original timing. Each
 *     adopted site threads its own value so the animation behaviour is
 *     identical to what it was before extraction.
 *   - `className` - extra structural classes, e.g. "flex-1" or "w-20"
 *
 * When `max === 0` the fill renders at 0% width (empty bar).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MeterBarProps = {
  /** Current value (0 ≤ value ≤ max). */
  value: number;
  /** Maximum value. When 0, the bar renders empty. */
  max: number;
  /**
   * Tailwind class(es) for the fill colour, e.g. "bg-emerald-500" or
   * "bg-emerald-500 dark:bg-emerald-400".
   */
  fillClass: string;
  /**
   * Accessible label for the meter. Passed to aria-label on the meter
   * element. Should be descriptive enough for a screen-reader user, e.g.
   * "Mastered: 42 of 100".
   */
  label: string;
  /**
   * Dark-mode track background colour. Defaults to "dark:bg-zinc-700".
   * Pass "dark:bg-zinc-800" when the site originally used that shade so
   * the visual is preserved exactly.
   */
  trackClass?: string;
  /**
   * Tailwind transition class(es) applied to the fill div. Defaults to
   * "transition-all". Pass "" to suppress animation entirely, or e.g.
   * "transition-all duration-300" to reproduce a specific original timing.
   */
  transitionClass?: string;
  /** Optional extra Tailwind classes, e.g. "flex-1" or "w-20". */
  className?: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MeterBar({
  value,
  max,
  fillClass,
  label,
  trackClass = "dark:bg-zinc-700",
  transitionClass = "transition-all",
  className,
}: MeterBarProps) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);

  return (
    <div
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className={[
        "h-1.5 overflow-hidden rounded-full bg-zinc-200",
        trackClass,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={[
          "h-full rounded-full",
          transitionClass,
          fillClass,
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
