'use client';

/**
 * Global custom `next/image` loader.
 *
 * Configured in `next.config.ts` as `images.loaderFile`. Every `<Image>`
 * component in the app (that does not override `loader` at the call site)
 * goes through this function.
 *
 * Behaviour by source URL:
 *
 * - `/sprites/pokemon/<id>.png` paths → redirect to the pre-generated static
 *   WebP variant at `/sprites/pokemon/webp/<id>/<snapped-width>.webp`. The
 *   browser fetches a static file directly; no `/_next/image` endpoint is
 *   involved, so Vercel bills zero Image Optimisation transformations.
 *
 * - `https://avatars.githubusercontent.com/...` → returned unchanged. GitHub
 *   OAuth avatar URLs are user-controlled and potentially mutable; they are
 *   allowed through as-is so the `<Image>` falls back to the default browser
 *   loading behaviour for that src. The `remotePatterns` entry for this host
 *   in `next.config.ts` is kept for defence-in-depth.
 *
 * - All other paths → returned unchanged. Returning `src` unchanged tells
 *   `next/image` to treat the URL as-is (same effect as `unoptimized` for
 *   that one image). This is the safe fallback for any future image surface
 *   not yet in the allowlist above — it never generates a broken URL.
 */

import type { ImageLoaderProps } from 'next/image';
import { GENERATED_SPRITE_WIDTHS, snapToGeneratedWidth } from './imageLoaderHelpers';
import { spriteVariantUrl } from './url';

export { GENERATED_SPRITE_WIDTHS };

/**
 * Extract the numeric species ID from a raw sprite path.
 * Accepts `/sprites/pokemon/<id>.png` (already-validated by the caller).
 * Returns `null` if the path does not match the expected shape.
 */
function extractSpriteId(src: string): number | null {
  // Match exactly /sprites/pokemon/<digits>.png
  const match = src.match(/^\/sprites\/pokemon\/(\d+)\.png$/);
  if (!match) return null;
  const id = parseInt(match[1]!, 10);
  return Number.isFinite(id) ? id : null;
}

export default function imageLoader({ src, width }: ImageLoaderProps): string {
  // -----------------------------------------------------------------------
  // Sprite path — redirect to pre-generated WebP variant.
  // -----------------------------------------------------------------------
  if (src.startsWith('/sprites/pokemon/') && !src.includes('/webp/')) {
    const id = extractSpriteId(src);
    if (id !== null) {
      const snapped = snapToGeneratedWidth(width);
      return spriteVariantUrl(id, snapped);
    }
  }

  // -----------------------------------------------------------------------
  // GitHub avatar (user-controlled, mutable) — pass through unchanged.
  // The remotePatterns entry in next.config.ts is kept for defence-in-depth.
  // -----------------------------------------------------------------------
  if (src.startsWith('https://avatars.githubusercontent.com/')) {
    return src;
  }

  // -----------------------------------------------------------------------
  // Everything else — pass through unchanged.
  // -----------------------------------------------------------------------
  return src;
}
