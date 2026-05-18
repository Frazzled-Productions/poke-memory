import type { ReviewableCard } from "@/lib/review/session";

// Re-export the two review-specific size constants from the canonical location
// so existing review importers need not change their import path.
export { PRACTICE_SPRITE_SIZE, PICKER_SPRITE_SIZE } from "@/lib/sprites/sizes";

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
