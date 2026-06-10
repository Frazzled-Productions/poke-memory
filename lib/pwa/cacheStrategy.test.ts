import { describe, it, expect } from "vitest";
import {
  classifyRequest,
  shouldCache,
  CACHE_NAMES,
  LEGACY_SPRITE_CACHE_NAME,
  LEGACY_CRY_CACHE_NAME,
} from "./cacheStrategy";

const ORIGIN = "https://pokememory.com";

describe("classifyRequest", () => {
  it("routes sprite art to idb-first (offline pack lives in IndexedDB since #1803)", () => {
    const result = classifyRequest(`${ORIGIN}/sprites/pokemon/25.png`, ORIGIN);
    expect(result.strategy).toBe("idb-first");
    // No Cache Storage bucket - sprites are served from IndexedDB by the SW handler.
    expect(result.cacheName).toBeUndefined();
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

  it("classifies sprites as idb-first even when the request mode is navigate", () => {
    // A navigation request mode must not override the sprite/cry rule.
    const result = classifyRequest(`${ORIGIN}/sprites/pokemon/1.png`, ORIGIN, "navigate");
    expect(result.strategy).toBe("idb-first");
  });

  it("matches the sprite prefix exactly, not as a substring", () => {
    // A path that merely contains "sprites" later on is not a sprite asset.
    // It falls through to the pages bucket (stale-while-revalidate since #1803).
    const result = classifyRequest(`${ORIGIN}/pokedex/sprites/info`, ORIGIN, "navigate");
    expect(result.strategy).toBe("stale-while-revalidate");
    expect(result.cacheName).toBe(CACHE_NAMES.pages);
  });

  it("routes cry audio to idb-first (offline pack lives in IndexedDB since #1803)", () => {
    const result = classifyRequest(`${ORIGIN}/cries/25.ogg`, ORIGIN);
    expect(result.strategy).toBe("idb-first");
    // No Cache Storage bucket - cries are served from IndexedDB by the SW handler.
    expect(result.cacheName).toBeUndefined();
  });

  it("routes an optimised sprite URL (/_next/image) to idb-first", () => {
    // next/image encodes the src path into the `url` query param.
    const url = `${ORIGIN}/_next/image?url=%2Fsprites%2Fpokemon%2F25.png&w=384&q=75`;
    const result = classifyRequest(url, ORIGIN);
    expect(result.strategy).toBe("idb-first");
    expect(result.cacheName).toBeUndefined();
  });

  it("routes a pre-generated WebP sprite URL to idb-first", () => {
    // With the custom loader, sprites are served from static WebP files under
    // /sprites/pokemon/webp/<id>/<width>.webp - they match the /sprites/ prefix
    // rule directly, no /_next/image indirection needed.
    const url = `${ORIGIN}/sprites/pokemon/webp/25/320.webp`;
    const result = classifyRequest(url, ORIGIN);
    expect(result.strategy).toBe("idb-first");
    expect(result.cacheName).toBeUndefined();
  });

  it("routes a raw sprite URL (not via next/image) to idb-first", () => {
    // The Pokédex grid exemption uses a plain <img> rather than next/image;
    // the raw /sprites/ path must still classify correctly.
    const result = classifyRequest(`${ORIGIN}/sprites/pokemon/25.png`, ORIGIN);
    expect(result.strategy).toBe("idb-first");
    expect(result.cacheName).toBeUndefined();
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
  it("exposes a distinct cache name per asset class", () => {
    const names = Object.values(CACHE_NAMES);
    expect(new Set(names).size).toBe(names.length);
  });

  it("exposes legacy sprite cache name as a constant for cleanup", () => {
    // LEGACY_SPRITE_CACHE_NAME is the old Cache Storage bucket that existed
    // before the IndexedDB migration (#1803). The SW activate handler and the
    // OfflineSection delete button both use this constant to delete the bucket.
    expect(typeof LEGACY_SPRITE_CACHE_NAME).toBe("string");
    expect(LEGACY_SPRITE_CACHE_NAME.length).toBeGreaterThan(0);
  });

  it("exposes legacy cry cache name as a constant for cleanup", () => {
    expect(typeof LEGACY_CRY_CACHE_NAME).toBe("string");
    expect(LEGACY_CRY_CACHE_NAME.length).toBeGreaterThan(0);
  });
});
