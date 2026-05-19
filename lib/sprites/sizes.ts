/**
 * Single source of truth for sprite render sizes (CSS px) used across all
 * surfaces. Keeping them here ensures `SpritePreloader` and the corresponding
 * `next/image` consumer always request the same optimiser variant — a mismatch
 * would fetch a different variant and produce no cache benefit.
 *
 * Review-specific re-exports (`PRACTICE_SPRITE_SIZE`, `PICKER_SPRITE_SIZE`)
 * remain available from `lib/review/sprites` for callers that import them
 * together with `preloadableSpriteUrls`.
 */

// ---------------------------------------------------------------------------
// Review surfaces
// ---------------------------------------------------------------------------

/**
 * Render width (and height) in CSS px for flip-card sprites (name, cry,
 * evolution, reverse-evolution). Shared by `PokemonCard`, `EvolutionCard`,
 * and `SpritePreloader`.
 */
export const PRACTICE_SPRITE_SIZE = 320;

/**
 * Render width (and height) in CSS px for `SpritePicker` four-tile tiles.
 * Preloading at this size ensures the same optimiser variant is served from
 * cache when the picker mounts.
 */
export const PICKER_SPRITE_SIZE = 150;

// ---------------------------------------------------------------------------
// Pokédex surfaces
// ---------------------------------------------------------------------------

/** Tile sprite size in the Pokédex grid (64 px square). */
export const POKEDEX_GRID_SPRITE_SIZE = 64;

/** Main sprite size on the Pokédex detail disclosure panel (192 px square). */
export const POKEDEX_DETAIL_SPRITE_SIZE = 192;

/**
 * Sprite size for evolution-chain nodes and form-selector tiles on the
 * Pokédex detail panel (40 px square).
 */
export const POKEDEX_NODE_SPRITE_SIZE = 40;

/**
 * Full sprite size for alternate-form blocks inside the Pokédex detail
 * disclosure panel (120 px square). The element renders at `h-28 w-28`
 * (112 px), so 120 is the nearest optimiser bucket — using the 192-px
 * `POKEDEX_DETAIL_SPRITE_SIZE` constant here would fetch roughly double
 * the bytes for no visible benefit.
 */
export const POKEDEX_FORM_SPRITE_SIZE = 120;

// ---------------------------------------------------------------------------
// Pasture surface
// ---------------------------------------------------------------------------

/** Sprite size used by `PasturePokemon` tiles (56 px square). */
export const PASTURE_SPRITE_SIZE = 56;

// ---------------------------------------------------------------------------
// Stats surface
// ---------------------------------------------------------------------------

/** Sprite size used in the Stats page "worst cards" list (48 px square). */
export const STATS_SPRITE_SIZE = 48;
