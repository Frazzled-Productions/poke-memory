import type { ReviewableCard } from "@/lib/review/session";

/**
 * The render width (and height) in CSS px that the practice flip cards
 * pass to `next/image`. `SpritePreloader` must use the same value so the
 * optimiser produces the identical variant URL and the real card is then
 * served from cache. Kept here as the single source of truth shared by
 * `PokemonCard`, `EvolutionCard`, `ReverseEvolutionCard`, and the
 * preloader.
 */
export const PRACTICE_SPRITE_SIZE = 320;

/**
 * Sprite URLs worth preloading for a card, across its front and reveal
 * faces.
 *
 * - name / cry cards show a single sprite.
 * - evolution / reverse-evolution edges show two (pre- and post-evolution).
 * - reverse cards return nothing: they are rendered by `SpritePicker` as a
 *   four-tile multiple-choice grid at a smaller size (150px), so a 320px
 *   preload would fetch a variant the picker never requests. Preloading
 *   that surface is a separate concern from the flip-card pop-in this
 *   helper feeds.
 */
export function preloadableSpriteUrls(card: ReviewableCard): string[] {
  switch (card.cardType) {
    case "evolution":
    case "reverse-evolution":
      return [card.preEvoSpriteUrl, card.postEvoSpriteUrl];
    case "reverse":
      return [];
    default:
      return [card.spriteUrl];
  }
}
