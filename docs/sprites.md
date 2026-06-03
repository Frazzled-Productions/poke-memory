# Sprite render conventions

Canonical reference for how Pokémon sprites are rendered across the app. AGENTS.md keeps a short pointer here. Read this before adding a new sprite-rendering surface or touching `lib/sprites/`, `components/sprites/`, or any existing surface's `<Image>` / `<img>` call.

**Status:** Updated 2026-05-22 (#1186 - static WebP pre-generation, custom `next/image` loader). Settled 2026-05-18 (#932, #933). Follows the shared-primitive extraction in #929 and the adoption work in #930/#931.

## TL;DR

- **Default to `next/image`.** Every sprite surface uses `next/image` *except* the Pokédex grid, which is a deliberate, documented exemption (see "The Pokédex grid exemption" below).
- **Sprite sizes live in one place** - `lib/sprites/sizes.ts`. Never hard-code a sprite pixel size at a call site; import the named constant for the surface.
- **`priority` is for above-the-fold hero sprites only.** Off-screen and below-the-fold sprites use the `next/image` default (lazy) loading; never set `priority` on them.
- **Network warming vs. decode warming are two different gaps.** `SpritePreloader` warms the *network* cache ahead of time; `decodeSpriteUrls` / `useSpritePrefetch().decodeAhead` bridges the *fetch → GPU-decode* gap just before a state swap. A surface with a visible transition often needs both.
- **`/_next/image` is NOT used for sprites.** The global custom loader (`lib/sprites/imageLoader.ts`) redirects sprite paths directly to pre-generated static WebP files; no Vercel Image Optimisation transformations are billed.

## The static WebP tree

Sprites are pre-generated at every render width used across the app and committed to the repository under `public/sprites/pokemon/webp/<id>/<width>.webp`. The script is `npm run seed:sprites` (wraps `scripts/optimise-sprites.mjs`, which uses `sharp` as a Next.js transitive dependency). Source PNGs are ~475 px wide; no variant wider than the source resolution is generated (the cap is 320 px today, matching the largest render width).

The custom `next/image` loader (`lib/sprites/imageLoader.ts`) is configured globally in `next.config.ts` (`images.loader = 'custom'`, `images.loaderFile`). Every `<Image src="/sprites/pokemon/..." width={N} />` call is automatically redirected to `/sprites/pokemon/webp/<id>/<snapped-width>.webp` - no call-site changes needed. GitHub avatar URLs and anything else pass through unchanged.

`next.config.ts` also sets `images.deviceSizes` and `images.imageSizes` to exactly the union of pre-generated widths so the loader only ever receives widths it has files for.

**When adding a new sprite surface:** add a size constant to `lib/sprites/sizes.ts`, add it to `GENERATED_SPRITE_WIDTHS` in `lib/sprites/imageLoaderHelpers.ts`, and run `npm run seed:sprites` to generate the new width folder. Commit the generated WebP files.

## The shared primitive (`lib/sprites/` + `components/sprites/`)

Sprite infrastructure is neutral and lives outside `lib/review/` so non-review surfaces can consume it without a review-flow dependency.

| Module | Role |
|---|---|
| `lib/sprites/sizes.ts` | Single source of truth for sprite render sizes (CSS px). |
| `lib/sprites/url.ts` | Pure URL helpers: `spriteVariantUrl(id, width)` and `rawSpriteUrl(id)`. |
| `lib/sprites/imageLoaderHelpers.ts` | `GENERATED_SPRITE_WIDTHS` (the canonical generated width set) and `snapToGeneratedWidth(requested)`. Pure, unit-tested. |
| `lib/sprites/imageLoader.ts` | Global `next/image` loader - redirects sprite paths to pre-generated WebP; passes GitHub avatars and everything else through unchanged. |
| `lib/sprites/decode.ts` | `decodeSpriteUrls(urls)` - races each `HTMLImageElement.decode()` against a 500 ms safety-valve timeout. Pure, framework-agnostic. |
| `lib/sprites/useSpritePrefetch.ts` | `useSpritePrefetch()` hook - exposes a `decodeAhead(urls)` callback wrapping `decodeSpriteUrls`. Mounts no DOM. |
| `components/sprites/SpritePreloader.tsx` | Renders hidden, eagerly-loaded `next/image` elements so the browser fetches the exact pre-generated WebP variant ahead of time. |

`lib/review/sprites.ts` re-exports `PRACTICE_SPRITE_SIZE` / `PICKER_SPRITE_SIZE` from `lib/sprites/sizes.ts` and keeps `preloadableSpriteUrls(card)` - that helper is `ReviewableCard`-shaped and stays review-specific. `components/review/SpritePreloader.tsx` is a re-export shim kept for legacy import paths; new code should import from `@/components/sprites/SpritePreloader`.

## `next/image` vs. plain `<img>`

**Use `next/image` by default.** It resolves to the pre-generated static WebP variant via the global loader (no Vercel Image Optimisation transformation), sets explicit dimensions (so there is no layout shift), and integrates with `SpritePreloader` - the preloader's hidden `<Image>` and the visible `<Image>` share a `src` + `width`, so the visible one is served from cache.

**Use a plain `<img>` only with a documented reason.** Today the single exemption is the Pokédex grid (below). Any future plain-`<img>` surface must carry an inline comment explaining why and the `// eslint-disable-next-line @next/next/no-img-element` directive, and should be recorded here.

## `priority` and `loading`

`next/image` is lazy by default. Choose per surface class:

| Surface class | Example | `priority` / `loading` |
|---|---|---|
| Above-the-fold hero sprite | Pokédex detail main sprite | `priority` - it is the focal point of the route and should not lazy-load. |
| Below-the-fold / off-screen list tile | Pasture tiles, Stats "worst cards" list, Pokédex detail evo-chain nodes | Leave the default (lazy). Never set `priority`. |
| Hidden preloader entry | `SpritePreloader` internals | `loading="eager"` - deliberately eager (not `priority`) so it warms the cache without contending with the visible card's high-priority fetch. |
| Multiple-choice picker tile | `SpritePicker` 2×2 grid | `loading="eager"` - all four tiles are on screen at once and the user acts on them immediately. |
| Review flip-card sprite | `PokemonCard` name/cry/evolution sprite | `priority` - the card is the focal point of the review route. |
| Decorative / background | Theme mascot, theme watermark | Deprioritised - never block content for chrome. `ThemeWatermark` sets `priority={false}` explicitly; `FavouriteMascot` relies on the lazy default. Prefer the explicit `priority={false}` for clarity. |

Rule of thumb: `priority` is reserved for the one sprite that *is* the page (or card). Everything else is lazy. Decorative chrome is explicitly `priority={false}`.

**Note on `priority` deprecation:** In Next.js 16, `priority` is deprecated in favour of `preload`. A repo-wide migration is tracked as a follow-up - do not migrate call sites in this PR.

## Sprite sizes (`lib/sprites/sizes.ts`)

All sprite render sizes are named constants. The size passed to `next/image` (and to `SpritePreloader`) must match the CSS size the element actually paints at - a mismatch fetches a different WebP variant and produces no cache benefit.

| Constant | px | Surface |
|---|---|---|
| `PRACTICE_SPRITE_SIZE` | 320 | Review flip cards (name, cry, evolution, reverse-evolution) |
| `PICKER_SPRITE_SIZE` | 150 | `SpritePicker` four-tile grid |
| `POKEDEX_GRID_SPRITE_SIZE` | 64 | Pokédex grid tile |
| `POKEDEX_DETAIL_SPRITE_SIZE` | 192 | Pokédex detail main sprite |
| `POKEDEX_NODE_SPRITE_SIZE` | 40 | Pokédex detail evo-chain nodes and form-selector tiles |
| `POKEDEX_FORM_SPRITE_SIZE` | 120 | Pokédex detail alternate-form blocks |
| `PASTURE_SPRITE_SIZE` | 56 | Pasture tile |
| `STATS_SPRITE_SIZE` | 48 | Stats "worst cards" list |
| `FAVOURITE_MASCOT_SPRITE_SIZE` | 32 | `FavouriteMascot` nav badge |
| `THEME_WATERMARK_SPRITE_SIZE` | 180 | `ThemeWatermark` decorative background sprite |

When adding a surface, add a constant rather than inlining a literal, and use it at the call site. When two surfaces genuinely share a size, share the constant.

## Preload and decode-ahead

Two distinct performance gaps, two distinct tools. They are independent - a surface may need neither, one, or both.

- **`SpritePreloader`** - warms the *network* cache. Mount it with the URL set you expect to render soon (the next review card's sprites, the evo-chain nodes about to appear in a detail panel). The hidden `<Image>` fetches the exact pre-generated WebP variant; when the real element mounts with the same `src` + `width` it is served from cache. Use for surfaces that render a *known, bounded* set of sprites soon.
- **`decodeSpriteUrls` / `useSpritePrefetch().decodeAhead`** - bridges the *fetch → GPU-decode* gap. A warmed fetch is not a warmed decode: React can advance to the next card synchronously while the browser still needs to decode the image bytes, causing a brief pop-in. Call `decodeAhead([...urls])` and `await` it *immediately before* a state transition (card flip, grade, minigame advance) so the swap happens with the sprite already decoded.

Current consumers:

- Review flow: `ReviewSession` mounts `SpritePreloader` for the next card and calls `decodeSpriteUrls` in both `handleGrade()` and `handleReveal()` (the latter added in #946).
- Higher-or-Lower minigame: `decodeSpriteUrls` on each pair transition.
- Pokédex detail: `SpritePreloader` for the evo-chain nodes (#947).

**Do not** preload an unbounded set. A blanket preload of all ~1025 grid sprites would saturate the network for no benefit - see the grid exemption below.

## The Pokédex grid exemption (#932)

The Pokédex grid (`components/pokedex/PokedexGrid.tsx`, ~1025 tiles) is the **one deliberate exemption** from the "default to `next/image`" rule. It keeps a plain lazy `<img>` pointing at the raw PNG (`/sprites/pokemon/<id>.png`).

**Decision (the maintainer, #932): exempt the grid.** Rationale:

- Rendering ~1025 `next/image` wrappers adds per-cell DOM and component overhead with no responsive benefit - every tile is a fixed 64×64 square.
- Off-screen tiles are *meant* to pop in as the user scrolls; `loading="lazy"` on a plain `<img>` is exactly the right behaviour and costs nothing.
- A blanket preload or decode-ahead of the full set would be counter-productive (network saturation), and a viewport-aware prefetch was judged not worth the complexity for a surface whose lazy pop-in is by design.

The exemption is recorded inline in `PokedexGrid.tsx` (the comment above the `<img>` element) and here. If the grid is ever revisited, the options weighed and rejected in #932 were: (b) a viewport-aware decode-warm of near-viewport tiles, and (c) `decode()`-on-scroll for upcoming rows. Both stay on the table but are not worth the cost today.

## Adding a new sprite surface - checklist

1. Use `next/image` unless you have a documented reason not to (and if not, record the exemption here).
2. Add a named size constant to `lib/sprites/sizes.ts`; pass it as both `width` and `height`. Match the painted CSS size.
3. Add the new size to `GENERATED_SPRITE_WIDTHS` in `lib/sprites/imageLoaderHelpers.ts` (the deduped `Set` handles duplicates automatically - just add the constant).
4. Run `npm run seed:sprites` to generate the new width folder under `public/sprites/pokemon/webp/`. Commit the generated WebP files.
5. Set `priority` only if the sprite is the above-the-fold focal point of the route. Decorative chrome gets `priority={false}`. Everything else stays lazy.
6. If the surface renders a known, bounded sprite set soon, mount `SpritePreloader` to warm the network cache.
7. If the surface has a visible state transition, `await decodeAhead([...])` immediately before the swap.
8. Never inline a sprite pixel literal, and never preload an unbounded set.
