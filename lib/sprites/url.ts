/**
 * Pure URL helpers for Pokémon sprite paths.
 *
 * - `spriteVariantUrl` - returns the pre-generated WebP path for a given
 *   species ID and render width. These are static files committed under
 *   `public/sprites/pokemon/webp/<id>/<width>.webp` and served directly
 *   without any Vercel Image Optimisation transformation.
 *
 * - `spriteGridSrcSet` - returns a DPR-aware `srcset` string for the Pokédex
 *   grid tile (64 CSS px). Uses the 64 px WebP for 1x, 120 px for 2x, and
 *   192 px for 3x. All three variants are already in the offline precache
 *   (#1789), so no extra download cost for offline users.
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
 * DPR-aware `srcset` string for the Pokédex grid tile (64 CSS px).
 *
 * Returns a descriptor string suitable for the `srcSet` attribute on the
 * grid `<img>` element. The browser automatically selects the best variant
 * for the device pixel ratio:
 *
 * - 1x (non-retina): 64 px WebP
 * - 2x (standard retina, e.g. iPhone non-Pro): 120 px WebP
 * - 3x (super-retina, e.g. iPhone Pro): 192 px WebP
 *
 * All three widths (64, 120, 192) are in `GENERATED_SPRITE_WIDTHS` and are
 * already included in the offline precache, so this attribute adds zero extra
 * precache bytes for offline users. Online retina users fetch the larger
 * variant on demand - the intended trade.
 *
 * Single source of truth: all grid srcset construction MUST go through this
 * helper, never be inlined.
 */
export function spriteGridSrcSet(id: number): string {
  return (
    `${spriteVariantUrl(id, 64)} 1x, ` +
    `${spriteVariantUrl(id, 120)} 2x, ` +
    `${spriteVariantUrl(id, 192)} 3x`
  );
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
