import Image from "next/image";
import { PRACTICE_SPRITE_SIZE } from "@/lib/sprites/sizes";

/** A sprite URL paired with the CSS pixel size it will be rendered at. */
export type SizedSpriteUrl = { src: string; width: number };

type Props = {
  /**
   * Sprite URLs to warm in the browser cache at {@link PRACTICE_SPRITE_SIZE}
   * (320 px). Used for flip-card sprites (name, cry, evolution).
   */
  urls?: readonly string[];
  /**
   * Sprite URLs that each need a specific render size. Use this when the
   * consumer renders the image at a size other than {@link PRACTICE_SPRITE_SIZE}
   * — e.g. the `SpritePicker` four-tile grid, which uses 150 px tiles.
   * Preloading at the wrong size would request a different optimiser variant
   * and produce no cache benefit.
   */
  sizedUrls?: readonly { src: string; width: number }[];
};

/**
 * Off-screen sprite preloader (#705, extended in #708).
 *
 * Renders each URL as a hidden, eagerly-loaded `next/image` at the correct
 * size so the browser fetches the exact pre-generated WebP variant ahead of
 * time. The global custom loader redirects sprite paths to
 * `/sprites/pokemon/webp/<id>/<width>.webp` automatically — no `/_next/image`
 * endpoint is involved. When the real card later mounts an `<Image>` with the
 * same `src` and `width`, it is served from cache and appears without the
 * pop-in delay.
 *
 * Two entry-point props:
 * - `urls` — flip-card sprites rendered at {@link PRACTICE_SPRITE_SIZE}.
 * - `sizedUrls` — entries with an explicit `width`, for surfaces (such as
 *   the `SpritePicker` 2×2 grid) that render at a different size.
 *
 * Eager (rather than `priority`) loading is deliberate: these sprites are
 * not yet on screen, so they should not contend with the visible card's
 * high-priority fetch — they just need to start before the user grades.
 *
 * The container is a 1px, fully-transparent, non-interactive box: 1px (not
 * 0px) guarantees a painted area so engines that skip fetches for
 * zero-area images still load the sprites; `opacity-0` and
 * `pointer-events-none` keep it invisible and unhittable.
 *
 * Keyed by `${width}:${url}` so a sprite that stays in the preload set
 * across renders keeps its `<img>` mounted and is not refetched.
 */
export function SpritePreloader({ urls = [], sizedUrls = [] }: Props) {
  // Normalise both inputs into a single { src, width } list, deduplicating
  // by (width, src) pair. `next/image` throws on an empty `src`, so filter
  // those out — a stray empty URL should skip a preload, not crash practice.
  const seen = new Set<string>();
  const entries: { src: string; width: number }[] = [];

  for (const src of urls) {
    if (!src) continue;
    const key = `${PRACTICE_SPRITE_SIZE}:${src}`;
    if (!seen.has(key)) {
      seen.add(key);
      entries.push({ src, width: PRACTICE_SPRITE_SIZE });
    }
  }

  for (const { src, width } of sizedUrls) {
    if (!src) continue;
    const key = `${width}:${src}`;
    if (!seen.has(key)) {
      seen.add(key);
      entries.push({ src, width });
    }
  }

  return (
    <div
      aria-hidden="true"
      className="absolute h-px w-px overflow-hidden opacity-0 pointer-events-none"
    >
      {entries.map(({ src, width }) => (
        <Image
          key={`${width}:${src}`}
          src={src}
          alt=""
          width={width}
          height={width}
          loading="eager"
        />
      ))}
    </div>
  );
}
