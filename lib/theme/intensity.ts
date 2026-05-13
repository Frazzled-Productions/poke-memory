import type { ThemeIntensity } from "@/lib/settings/persistence";

/**
 * Applies (or removes) the `data-intensity` attribute on `<html>` so that
 * CSS selectors in globals.css can layer tinted/full-bleed palette rules on
 * top of the baseline accent-only rules.
 *
 * `accents` is the default mode — no attribute is written so the baseline
 * `:root` rules apply. `tinted` and `full` each set a distinct value that
 * ui-coder keys off via `:root[data-intensity="…"]` selectors.
 */
export function applyIntensity(intensity: ThemeIntensity): void {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  if (intensity === "accents") {
    root.removeAttribute("data-intensity");
  } else {
    root.setAttribute("data-intensity", intensity);
  }
}
