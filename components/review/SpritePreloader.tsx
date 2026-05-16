import Image from "next/image";
import { PRACTICE_SPRITE_SIZE } from "@/lib/review/sprites";

type Props = {
  /** Sprite URLs to warm in the browser cache ahead of display. */
  urls: readonly string[];
};

/**
 * Off-screen sprite preloader (#705).
 *
 * Renders each URL as a hidden, eagerly-loaded `next/image` at the same
 * size the real practice flip cards use ({@link PRACTICE_SPRITE_SIZE}), so
 * the browser fetches the exact optimised variant ahead of time. When the
 * real card later mounts an `<Image>` with the same `src`, it is served
 * from cache and appears without the pop-in delay.
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
 * Keyed by URL so a sprite that stays in the preload set across renders
 * keeps its `<img>` mounted and is not refetched.
 */
export function SpritePreloader({ urls }: Props) {
  // Drop empty strings — `next/image` throws on an empty `src`, so a stray
  // empty sprite URL would crash practice rather than just skip a preload.
  const unique = Array.from(new Set(urls)).filter((url) => url !== "");
  return (
    <div
      aria-hidden="true"
      className="absolute h-px w-px overflow-hidden opacity-0 pointer-events-none"
    >
      {unique.map((url) => (
        <Image
          key={url}
          src={url}
          alt=""
          width={PRACTICE_SPRITE_SIZE}
          height={PRACTICE_SPRITE_SIZE}
          loading="eager"
        />
      ))}
    </div>
  );
}
