import { describe, it, expect } from "vitest";
import {
  classifyRequest,
  shouldCache,
  CACHE_NAMES,
  SPRITE_CACHE_MAX_ENTRIES,
  SPRITE_CACHE_MAX_AGE_SECONDS,
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

  it("uses network-first for top-level navigations", () => {
    const result = classifyRequest(`${ORIGIN}/pokedex`, ORIGIN, "navigate");
    expect(result.strategy).toBe("network-first");
    expect(result.cacheName).toBe(CACHE_NAMES.pages);
  });

  it("uses network-first for same-origin data requests", () => {
    const result = classifyRequest(`${ORIGIN}/api/something`, ORIGIN);
    expect(result.strategy).toBe("network-first");
    expect(result.cacheName).toBe(CACHE_NAMES.pages);
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
    const result = classifyRequest(`${ORIGIN}/pokedex/sprites/info`, ORIGIN, "navigate");
    expect(result.strategy).toBe("network-first");
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
  it("caps the sprite cache above the full 1025-species set", () => {
    expect(SPRITE_CACHE_MAX_ENTRIES).toBeGreaterThan(1025);
  });

  it("keeps sprites for a long, positive duration", () => {
    expect(SPRITE_CACHE_MAX_AGE_SECONDS).toBeGreaterThan(0);
  });

  it("exposes a distinct cache name per asset class", () => {
    const names = Object.values(CACHE_NAMES);
    expect(new Set(names).size).toBe(names.length);
  });
});
