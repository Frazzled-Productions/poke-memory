/**
 * Pure URL helpers for Pokémon sprite paths.
 *
 * - `spriteVariantUrl` - returns the pre-generated WebP path for a given
 *   species ID and render width. These are static files committed under
 *   `public/sprites/pokemon/webp/<id>/<width>.webp` and served directly
 *   without any Vercel Image Optimisation transformation.
 *
 * - `rawSpriteUrl` - returns the raw PNG path
 *   (`/sprites/pokemon/<id>.png`). The PNG files live in `public/` and are
 *   the build-time source for `npm run seed:sprites`. After #1740 nothing
 *   in the app requests these at runtime (the Pokédex grid switched to the
 *   64 px WebP variant), but the function is retained for tooling that may
 *   need the canonical raw path.
 */

/**
 * Pre-generated static WebP sprite URL for the given species ID and render
 * width. The file must exist at `public/sprites/pokemon/webp/${id}/${width}.webp`
 * - use only widths produced by `npm run seed:sprites`.
 */
export function spriteVariantUrl(id: number, width: number): string {
  return `/sprites/pokemon/webp/${id}/${width}.webp`;
}

/**
 * Raw PNG sprite URL for the given species ID.
 *
 * Returns the path served directly from `public/sprites/pokemon/${id}.png`.
 * After #1740 nothing in the app requests these at runtime - the Pokédex
 * grid now serves `spriteVariantUrl(id, POKEDEX_GRID_SPRITE_SIZE)` instead.
 * All other surfaces go through `next/image`, which the global loader
 * redirects to the pre-generated WebP variant. Retained for tooling that
 * references the canonical raw PNG path.
 */
export function rawSpriteUrl(id: number): string {
  return `/sprites/pokemon/${id}.png`;
}
