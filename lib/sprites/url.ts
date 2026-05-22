/**
 * Pure URL helpers for Pokémon sprite paths.
 *
 * - `spriteVariantUrl` — returns the pre-generated WebP path for a given
 *   species ID and render width. These are static files committed under
 *   `public/sprites/pokemon/webp/<id>/<width>.webp` and served directly
 *   without any Vercel Image Optimisation transformation.
 *
 * - `rawSpriteUrl` — returns the raw PNG path. Used by the Pokédex-grid
 *   plain-`<img>` exemption, which intentionally does not go through
 *   `next/image` or the WebP tree.
 */

/**
 * Pre-generated static WebP sprite URL for the given species ID and render
 * width. The file must exist at `public/sprites/pokemon/webp/${id}/${width}.webp`
 * — use only widths produced by `npm run seed:sprites`.
 */
export function spriteVariantUrl(id: number, width: number): string {
  return `/sprites/pokemon/webp/${id}/${width}.webp`;
}

/**
 * Raw PNG sprite URL for the given species ID.
 *
 * This is the path served directly from `public/sprites/pokemon/${id}.png`.
 * Use it only for the Pokédex-grid plain-`<img>` exemption — all other
 * surfaces should go through `next/image` which the global loader redirects
 * to the pre-generated WebP variant.
 */
export function rawSpriteUrl(id: number): string {
  return `/sprites/pokemon/${id}.png`;
}
