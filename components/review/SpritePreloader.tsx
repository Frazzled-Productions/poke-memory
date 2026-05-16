import Image from "next/image";
import type { ReviewableCard } from "@/lib/review/session";

/**
 * Every sprite URL a card needs to display across its front and reveal
 * faces. name / cry / reverse cards show a single sprite; evolution edges
 * show two (pre- and post-evolution).
 */
export function cardSpriteUrls(card: ReviewableCard): string[] {
  switch (card.cardType) {
    case "evolution":
    case "reverse-evolution":
      return [card.preEvoSpriteUrl, card.postEvoSpriteUrl];
    default:
      return [card.spriteUrl];
  }
}

type Props = {
  /** Sprite URLs to warm in the browser cache ahead of display. */
  urls: readonly string[];
};

/**
 * Off-screen sprite preloader (#705).
 *
 * Renders each URL as a hidden, eagerly-loaded `next/image` with the same
 * `width`/`height` the real practice cards use, so
 * the browser fetches the exact optimised variant ahead of time. When the
 * real card later mounts an `<Image>` with the same `src`, it is served
 * from cache and appears without the pop-in delay.
 *
 * Eager (rather than `priority`) loading is deliberate: these sprites are
 * not yet on screen, so they should not contend with the visible card's
 * high-priority fetch — they just need to start before the user grades.
 *
 * Keyed by URL so a sprite that stays in the preload set across renders
 * keeps its `<img>` mounted and is not refetched.
 */
export function SpritePreloader({ urls }: Props) {
  const unique = Array.from(new Set(urls)).filter(Boolean);
  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 w-0 h-0 overflow-hidden"
    >
      {unique.map((url) => (
        <Image
          key={url}
          src={url}
          alt=""
          width={320}
          height={320}
          loading="eager"
        />
      ))}
    </div>
  );
}
