/**
 * Pure helpers for the custom `next/image` loader.
 *
 * Kept separate from `imageLoader.ts` so the snap logic is unit-testable
 * in the `node` vitest project without pulling in the `'use client'`
 * directive that the loader file requires.
 *
 * Source PNGs are ~475 px wide (official-artwork resolution). We do not
 * generate variants wider than the source - a request for a larger width
 * snaps to the largest available generated width (320 px). This is not a
 * regression: Vercel's `/_next/image` endpoint also cannot add detail beyond
 * the source resolution.
 */

import {
  PRACTICE_SPRITE_SIZE,
  PICKER_SPRITE_SIZE,
  POKEDEX_DETAIL_SPRITE_SIZE,
  POKEDEX_FORM_SPRITE_SIZE,
  POKEDEX_GRID_SPRITE_SIZE,
  POKEDEX_NODE_SPRITE_SIZE,
  PASTURE_SPRITE_SIZE,
  STATS_SPRITE_SIZE,
  FAVOURITE_MASCOT_SPRITE_SIZE,
  THEME_WATERMARK_SPRITE_SIZE,
} from './sizes';

/**
 * The canonical set of pre-generated WebP widths, derived from the named
 * size constants. Each element corresponds to a width folder produced by
 * `npm run seed:sprites` (e.g. `public/sprites/pokemon/webp/<id>/<w>.webp`).
 *
 * Must be kept in ascending order - `snapToGeneratedWidth` relies on sorted
 * order to find the nearest match.
 */
export const GENERATED_SPRITE_WIDTHS: readonly number[] = [
  ...new Set([
    FAVOURITE_MASCOT_SPRITE_SIZE,   // 32
    POKEDEX_NODE_SPRITE_SIZE,       // 40
    STATS_SPRITE_SIZE,              // 48
    PASTURE_SPRITE_SIZE,            // 56
    POKEDEX_GRID_SPRITE_SIZE,       // 64
    POKEDEX_FORM_SPRITE_SIZE,       // 120
    PICKER_SPRITE_SIZE,             // 150
    THEME_WATERMARK_SPRITE_SIZE,    // 180
    POKEDEX_DETAIL_SPRITE_SIZE,     // 192
    PRACTICE_SPRITE_SIZE,           // 320
  ]),
].sort((a, b) => a - b);

/**
 * Snap a requested width to the nearest available generated width.
 *
 * Strategy:
 * 1. Exact match - return the width unchanged.
 * 2. Round up to the next larger generated width (serves the smallest
 *    variant that is at least as large as requested, preserving quality).
 * 3. If the request exceeds the largest generated width, return the
 *    largest available (source-resolution cap - see module comment).
 *
 * @param requested  The width value from `ImageLoaderProps.width`.
 * @returns          A width that exists in `GENERATED_SPRITE_WIDTHS`.
 */
export function snapToGeneratedWidth(requested: number): number {
  // Walk the sorted array to find the smallest generated width >= requested.
  for (const w of GENERATED_SPRITE_WIDTHS) {
    if (w >= requested) return w;
  }
  // requested > largest available - cap at the maximum.
  return GENERATED_SPRITE_WIDTHS[GENERATED_SPRITE_WIDTHS.length - 1]!;
}
