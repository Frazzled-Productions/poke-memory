import type { ThemeColors } from "./curated-pokemon";

/**
 * Palette choice from a sprite's colour histogram (#2187), used by
 * `scripts/seed-palettes.mjs`. Pure and import-free at runtime so Node can run
 * it with the types stripped; the contrast functions come in as `checks`.
 */

export type Rgb = readonly [number, number, number];

export type PaletteChecks = {
  contrastRatio: (a: string, b: string) => number;
  passesPaletteChecks: (p: ThemeColors) => boolean;
};

/** Smallest hue difference (degrees) for two colours to count as distinct hues. */
export const MIN_HUE_DISTANCE = 40;
/** Share of white mixed into `primary` to make `secondary`. */
export const SECONDARY_TINT = 0.45;

export function toHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function hueOf([r, g, b]: Rgb): number | null {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null; // grey: no hue
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

export function hueDistance(a: number | null, b: number | null): number {
  if (a === null || b === null) return a === b ? 0 : 180;
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

/** The palette built around `primaryRgb`, with `accent` the next distinct hue in `buckets`. */
function paletteAround(primaryRgb: Rgb, buckets: readonly Rgb[], checks: PaletteChecks): ThemeColors {
  const primaryHue = hueOf(primaryRgb);
  const accentRgb =
    buckets.find((c) => hueDistance(hueOf(c), primaryHue) >= MIN_HUE_DISTANCE) ??
    buckets[0] ??
    primaryRgb;
  const secondaryRgb = primaryRgb.map((v) => v + (255 - v) * SECONDARY_TINT) as unknown as Rgb;
  const primary = toHex(primaryRgb);
  const fgOnPrimary =
    checks.contrastRatio("#FFFFFF", primary) >= checks.contrastRatio("#000000", primary) ? "#FFFFFF" : "#000000";
  return { primary, secondary: toHex(secondaryRgb), accent: toHex(accentRgb), fgOnPrimary };
}

/** How many distinct hues are tried as `primary`, most common first. */
export const MAX_PRIMARY_HUES = 3;
/** Largest HSL lightness step (percentage points) either way from the extracted colour. */
export const MAX_LIGHTNESS_STEP = 15;

/**
 * The extracted palette for buckets sorted by pixel count (most common first),
 * or null when there are no buckets or no candidate passes the checks. Tries up
 * to `MAX_PRIMARY_HUES` distinct hues as `primary`, each at its own lightness
 * and then stepped 1, 2, ... `MAX_LIGHTNESS_STEP` points darker and lighter
 * (hue and saturation kept), and keeps the first palette that passes.
 */
export function choosePalette(buckets: readonly Rgb[], checks: PaletteChecks): ThemeColors | null {
  const hues: Rgb[] = [];
  for (const c of buckets) {
    if (hues.length === MAX_PRIMARY_HUES) break;
    if (hues.every((h) => hueDistance(hueOf(h), hueOf(c)) >= MIN_HUE_DISTANCE)) hues.push(c);
  }
  for (const base of hues) {
    const [h, s, l] = rgbToHsl(base);
    const others = buckets.filter((c) => c !== base);
    for (let step = 0; step <= MAX_LIGHTNESS_STEP; step++) {
      for (const delta of step === 0 ? [0] : [-step, step]) {
        const lightness = l + delta;
        if (lightness < 0 || lightness > 100) continue;
        const primaryRgb = delta === 0 ? base : hslToRgb([h, s, lightness]);
        const palette = paletteAround(primaryRgb, others, checks);
        if (checks.passesPaletteChecks(palette)) return palette;
      }
    }
  }
  return null;
}

/** `[r, g, b]` in 0..255 to `[h, s, l]` with h in degrees and s, l in percent. */
export function rgbToHsl(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [hueOf(rgb) ?? 0, s * 100, l * 100];
}

/** `[h, s, l]` (degrees, percent, percent) to `[r, g, b]` in 0..255, unrounded. */
export function hslToRgb([h, s, l]: readonly [number, number, number]): Rgb {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  };
  return [f(0), f(8), f(4)];
}
