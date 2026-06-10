import { describe, it, expect } from "vitest";
import {
  classifyRequest,
  shouldCache,
  CACHE_NAMES,
  SPRITE_CACHE_MAX_ENTRIES,
  SPRITE_CACHE_MAX_AGE_SECONDS,
  CRY_CACHE_MAX_ENTRIES,
  CRY_CACHE_MAX_AGE_SECONDS,
} from "./cacheStrategy";

const ORIGIN = "https://pokememory.com";

describe("classifyRequest", () => {
  it("caches sprite art cache-first under the sprite bucket", () => {
    const result = classifyRequest(`${ORIGIN}/sprites/pokemon/25.png`, ORIGIN);
    expect(result.strategy).toBe("cache-first");
    expect(result.cacheName).toBe(CACHE_NAMES.sprites);
  });

  it("caches Next.js build output cache-first under the static bucket", () => {
    const result = classifyRequest(`${ORIGIN}/_next/static/chunks/main-abc123.js`, ORIGIN);
    expect(result.strategy).toBe("cache-first");
    expect(result.cacheName).toBe(CACHE_NAMES.static);
  });

  it("uses stale-while-revalidate for fonts", () => {
    const woff2 = classifyRequest(`${ORIGIN}/fonts/geist.woff2`, ORIGIN);
    expect(woff2.strategy).toBe("stale-while-revalidate");
    expect(woff2.cacheName).toBe(CACHE_NAMES.fonts);

    expect(classifyRequest(`${ORIGIN}/x.ttf`, ORIGIN).strategy).toBe("stale-while-revalidate");
    expect(classifyRequest(`${ORIGIN}/x.otf`, ORIGIN).strategy).toBe("stale-while-revalidate");
  });

  it("uses stale-while-revalidate for top-level navigations (#1803 cold-launch fix)", () => {
    // Navigation strategy was changed from NetworkFirst(10 s) to
    // StaleWhileRevalidate in #1803 to eliminate the ~5 s cold-launch hang.
    // The cached shell is served instantly; the network response updates it in
    // the background. Offline behaviour is unchanged (the cached shell is still
    // returned when the network is unavailable).
    const result = classifyRequest(`${ORIGIN}/pokedex`, ORIGIN, "navigate");
    expect(result.strategy).toBe("stale-while-revalidate");
    expect(result.cacheName).toBe(CACHE_NAMES.pages);
  });

  it("uses stale-while-revalidate for the PWA cold-launch navigation to /?source=pwa", () => {
    // The cold launch hits /?source=pwa with requestMode === "navigate".
    // It must NOT block on the network (the prior NetworkFirst strategy did).
    const result = classifyRequest(`${ORIGIN}/?source=pwa`, ORIGIN, "navigate");
    expect(result.strategy).toBe("stale-while-revalidate");
    expect(result.cacheName).toBe(CACHE_NAMES.pages);
  });

  it("uses stale-while-revalidate for same-origin data requests", () => {
    const result = classifyRequest(`${ORIGIN}/api/something`, ORIGIN);
    expect(result.strategy).toBe("stale-while-revalidate");
    expect(result.cacheName).toBe(CACHE_NAMES.pages);
  });

  it("uses stale-while-revalidate for seed data (pokemon-data/*.json)", () => {
    // Seed files are precached by the SW manifest (scripts/build-sw.mjs) and
    // served by the precache handler before this runtime rule fires. This rule
    // is a fallback and ensures the files are always in the pages cache bucket.
    const core = classifyRequest(`${ORIGIN}/pokemon-data/generated-core.json`, ORIGIN);
    expect(core.strategy).toBe("stale-while-revalidate");
    expect(core.cacheName).toBe(CACHE_NAMES.pages);

    const chains = classifyRequest(`${ORIGIN}/pokemon-data/generated-chains.json`, ORIGIN);
    expect(chains.strategy).toBe("stale-while-revalidate");
    expect(chains.cacheName).toBe(CACHE_NAMES.pages);
  });

  it("classifies seed requests as stale-while-revalidate even with navigate mode", () => {
    // Seed files are under /pokemon-data/, which matches the path rule before
    // the navigation check. The result must be stale-while-revalidate regardless
    // of the requestMode.
    const result = classifyRequest(
      `${ORIGIN}/pokemon-data/generated-locale-names.json`,
      ORIGIN,
      "navigate",
    );
    expect(result.strategy).toBe("stale-while-revalidate");
  });

  it("never caches cross-origin requests (Supabase sync, avatars)", () => {
    expect(classifyRequest("https://abc.supabase.co/rest/v1/card_reviews", ORIGIN).strategy).toBe(
      "network-only",
    );
    expect(
      classifyRequest("https://avatars.githubusercontent.com/u/1", ORIGIN, "navigate").strategy,
    ).toBe("network-only");
  });

  it("does not assign a cache name to network-only requests", () => {
    expect(classifyRequest("https://other.example/x", ORIGIN).cacheName).toBeUndefined();
  });

  it("treats an unparseable URL as network-only", () => {
    expect(classifyRequest("not a url", ORIGIN).strategy).toBe("network-only");
  });

  it("classifies sprites cache-first even when the request mode is navigate", () => {
    // A navigation request mode must not override the immutable-asset rule.
    const result = classifyRequest(`${ORIGIN}/sprites/pokemon/1.png`, ORIGIN, "navigate");
    expect(result.strategy).toBe("cache-first");
  });

  it("matches the sprite prefix exactly, not as a substring", () => {
    // A path that merely contains "sprites" later on is not a sprite asset.
    // It falls through to the pages bucket (stale-while-revalidate since #1803).
    const result = classifyRequest(`${ORIGIN}/pokedex/sprites/info`, ORIGIN, "navigate");
    expect(result.strategy).toBe("stale-while-revalidate");
    expect(result.cacheName).toBe(CACHE_NAMES.pages);
  });

  it("caches cry audio cache-first under the cries bucket", () => {
    const result = classifyRequest(`${ORIGIN}/cries/25.ogg`, ORIGIN);
    expect(result.strategy).toBe("cache-first");
    expect(result.cacheName).toBe(CACHE_NAMES.cries);
  });

  it("routes an optimised sprite URL (/_next/image) to the sprites bucket", () => {
    // next/image encodes the src path into the `url` query param.
    const url = `${ORIGIN}/_next/image?url=%2Fsprites%2Fpokemon%2F25.png&w=384&q=75`;
    const result = classifyRequest(url, ORIGIN);
    expect(result.strategy).toBe("cache-first");
    expect(result.cacheName).toBe(CACHE_NAMES.sprites);
  });

  it("routes a pre-generated WebP sprite URL to the sprites bucket", () => {
    // With the custom loader, sprites are served from static WebP files under
    // /sprites/pokemon/webp/<id>/<width>.webp - they match the /sprites/ prefix
    // rule directly, no /_next/image indirection needed.
    const url = `${ORIGIN}/sprites/pokemon/webp/25/320.webp`;
    const result = classifyRequest(url, ORIGIN);
    expect(result.strategy).toBe("cache-first");
    expect(result.cacheName).toBe(CACHE_NAMES.sprites);
  });

  it("routes a raw sprite URL (not via next/image) to the sprites bucket", () => {
    // The Pokédex grid exemption uses a plain <img> rather than next/image;
    // the raw /sprites/ path must still classify correctly.
    const result = classifyRequest(`${ORIGIN}/sprites/pokemon/25.png`, ORIGIN);
    expect(result.strategy).toBe("cache-first");
    expect(result.cacheName).toBe(CACHE_NAMES.sprites);
  });

  it("falls through to the pages bucket for /_next/image with a cross-origin source", () => {
    // A GitHub avatar routed through the optimiser: the request itself is
    // same-origin, but the decoded `url` param is cross-origin, so no
    // immutable-asset rule matches and it falls through to the pages bucket
    // (stale-while-revalidate since #1803).
    const encoded = encodeURIComponent("https://avatars.githubusercontent.com/u/123");
    const url = `${ORIGIN}/_next/image?url=${encoded}&w=96&q=75`;
    const result = classifyRequest(url, ORIGIN);
    expect(result.strategy).toBe("stale-while-revalidate");
    expect(result.cacheName).toBe(CACHE_NAMES.pages);
  });

  it("falls through to the pages bucket for /_next/image with a cross-origin /sprites/ path", () => {
    // A cross-origin URL whose path begins with /sprites/ must NOT be routed
    // into the local sprite bucket. The same-origin guard must reject it even
    // though the pathname would otherwise match the sprites prefix rule.
    const encoded = encodeURIComponent("https://malicious.example/sprites/pokemon/25.png");
    const url = `${ORIGIN}/_next/image?url=${encoded}&w=384&q=75`;
    const result = classifyRequest(url, ORIGIN);
    // Must fall through to the pages (stale-while-revalidate) bucket, not the sprite bucket.
    expect(result.strategy).toBe("stale-while-revalidate");
    expect(result.cacheName).toBe(CACHE_NAMES.pages);
  });

  it("falls through to the pages bucket for /_next/image with a non-immutable same-origin source", () => {
    // An image from a dynamic page route (not a sprite or cry) falls through
    // to the pages bucket (stale-while-revalidate since #1803).
    const encoded = encodeURIComponent("/some-dynamic-page/hero.jpg");
    const url = `${ORIGIN}/_next/image?url=${encoded}&w=800&q=80`;
    const result = classifyRequest(url, ORIGIN);
    expect(result.strategy).toBe("stale-while-revalidate");
    expect(result.cacheName).toBe(CACHE_NAMES.pages);
  });
});

describe("shouldCache", () => {
  it("returns true for cacheable same-origin assets", () => {
    expect(shouldCache(`${ORIGIN}/sprites/pokemon/4.png`, ORIGIN)).toBe(true);
    expect(shouldCache(`${ORIGIN}/_next/static/chunk.js`, ORIGIN)).toBe(true);
    expect(shouldCache(`${ORIGIN}/stats`, ORIGIN, "navigate")).toBe(true);
  });

  it("returns false for cross-origin requests", () => {
    expect(shouldCache("https://abc.supabase.co/rest/v1/x", ORIGIN)).toBe(false);
  });
});

describe("cache config constants", () => {
  it("caps the sprite cache above the full offline-download pack size (~11,740 entries)", () => {
    // The offline-download feature writes up to ~11,740 sprite URLs into the
    // sprite bucket (10 pre-generated WebP width variants + 1 raw PNG per
    // species/form × ~1,067 entries). The cap must exceed this to prevent
    // ExpirationPlugin from culling downloaded sprites during a long offline
    // session.
    expect(SPRITE_CACHE_MAX_ENTRIES).toBeGreaterThan(11_740);
  });

  it("keeps sprites for a long, positive duration", () => {
    expect(SPRITE_CACHE_MAX_AGE_SECONDS).toBeGreaterThan(0);
  });

  it("caps the cry cache above the full 1025-species set", () => {
    expect(CRY_CACHE_MAX_ENTRIES).toBeGreaterThan(1025);
  });

  it("keeps cries for a long, positive duration", () => {
    expect(CRY_CACHE_MAX_AGE_SECONDS).toBeGreaterThan(0);
  });

  it("exposes a distinct cache name per asset class", () => {
    const names = Object.values(CACHE_NAMES);
    expect(new Set(names).size).toBe(names.length);
  });
});
