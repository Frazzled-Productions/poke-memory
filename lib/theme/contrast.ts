import type { ThemeColors } from "./curated-pokemon";

/**
 * Palette contrast checks (#2187). Type-only imports, so `scripts/seed-palettes.mjs`
 * can import this file directly (Node strips the types) and the seed step and
 * the unit tests apply the very same checks.
 *
 * The checks: `fgOnPrimary` against `primary` at least 4.5:1, and `primary`
 * against both page backgrounds at least 3:1. The backgrounds mirror
 * `--background` in `app/globals.css` (light `:root`, dark media query); a
 * test fails if they drift.
 */

export const LIGHT_BACKGROUND = "#fafafa";
export const DARK_BACKGROUND = "#111113";
export const MIN_FG_ON_PRIMARY_CONTRAST = 4.5;
export const MIN_PRIMARY_ON_BACKGROUND_CONTRAST = 3;

/** `#rgb` or `#rrggbb` to `[r, g, b]` in 0..255, or null when malformed. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex);
  if (m === null) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2 relative luminance of a hex colour (0 black, 1 white). */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (rgb === null) throw new Error(`Not a hex colour: ${hex}`);
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two hex colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** True when the palette passes both checks. */
export function passesPaletteChecks(p: ThemeColors): boolean {
  return (
    contrastRatio(p.fgOnPrimary, p.primary) >= MIN_FG_ON_PRIMARY_CONTRAST &&
    contrastRatio(p.primary, LIGHT_BACKGROUND) >= MIN_PRIMARY_ON_BACKGROUND_CONTRAST &&
    contrastRatio(p.primary, DARK_BACKGROUND) >= MIN_PRIMARY_ON_BACKGROUND_CONTRAST
  );
}
