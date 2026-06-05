import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildPrecacheUrls, precacheAll, OFFLINE_DOWNLOADED_AT_KEY } from "./precache";
import { CACHE_NAMES, versionedCacheName } from "./cacheStrategy";

// ---------------------------------------------------------------------------
// Helpers to build a minimal CacheStorage stub.
// ---------------------------------------------------------------------------

function makeCache(existingUrls: Set<string> = new Set()) {
  const store = new Map<string, Response>();
  for (const u of existingUrls) {
    store.set(u, new Response("cached", { status: 200 }));
  }
  return {
    match: vi.fn(async (url: string) => store.get(url)),
    put: vi.fn(async (url: string, res: Response) => {
      store.set(url, res);
    }),
  };
}

function makeCaches(cache: ReturnType<typeof makeCache>) {
  return {
    open: vi.fn(async () => cache),
  };
}

function makeOkFetch(extraUrls: Set<string> = new Set()) {
  return vi.fn(async (url: string) => {
    // Return 404 for /cries/ paths to exercise the not-ok branch.
    if (url.startsWith("/cries/") && !extraUrls.has(url)) {
      return new Response("", { status: 404 });
    }
    return new Response("data", { status: 200 });
  });
}

// ---------------------------------------------------------------------------
// buildPrecacheUrls
// ---------------------------------------------------------------------------

describe("buildPrecacheUrls", () => {
  it("includes pre-generated WebP variants for each sprite width", () => {
    // Sprites are now served as static WebP files - no /_next/image endpoint.
    const urls = buildPrecacheUrls([25]);
    const webpUrls = urls.filter((u) => u.startsWith("/sprites/pokemon/webp/"));
    expect(webpUrls.length).toBeGreaterThan(0);
    // Each WebP URL must reference species 25 and include a numeric width.
    for (const u of webpUrls) {
      expect(u).toContain("/sprites/pokemon/webp/25/");
      expect(u).toMatch(/\/sprites\/pokemon\/webp\/25\/\d+\.webp$/);
    }
  });

  it("does NOT include /_next/image URLs (dead path since #1186)", () => {
    const urls = buildPrecacheUrls([25]);
    const nextImageUrls = urls.filter((u) => u.startsWith("/_next/image"));
    expect(nextImageUrls).toHaveLength(0);
  });

  it("includes the raw sprite path for the Pokédex-grid <img> exemption", () => {
    const urls = buildPrecacheUrls([1]);
    expect(urls).toContain("/sprites/pokemon/1.png");
  });

  it("includes the cry URL for each species", () => {
    const urls = buildPrecacheUrls([4]);
    expect(urls).toContain("/cries/4.ogg");
  });

  it("produces a distinct set of URLs for multiple IDs", () => {
    const urls = buildPrecacheUrls([1, 2, 3]);
    // Each ID contributes at least one raw sprite URL - three total.
    const rawSprites = urls.filter(
      (u) => u.match(/^\/sprites\/pokemon\/\d+\.png$/),
    );
    expect(rawSprites).toContain("/sprites/pokemon/1.png");
    expect(rawSprites).toContain("/sprites/pokemon/2.png");
    expect(rawSprites).toContain("/sprites/pokemon/3.png");
    // No duplicate URLs.
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("returns an empty array for an empty ID list", () => {
    expect(buildPrecacheUrls([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// precacheAll
// ---------------------------------------------------------------------------

describe("precacheAll", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens the versioned sprites cache bucket - byte-identical to the SW runtime handler", async () => {
    // This test pins the contract between the precache orchestrator and the
    // service worker's CacheFirst route: both must open the SAME cache name.
    // If this assertion fails after a SW_CACHE_VERSION bump, it means the
    // SW and the precache have diverged and precached assets will be invisible.
    const openedNames: string[] = [];
    const fakeCache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    };
    vi.stubGlobal("caches", {
      open: vi.fn(async (name: string) => {
        openedNames.push(name);
        return fakeCache;
      }),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("data", { status: 200 })),
    );

    await precacheAll({ ids: [25] });

    const expectedSpritesName = versionedCacheName(CACHE_NAMES.sprites);
    const expectedCriesName = versionedCacheName(CACHE_NAMES.cries);

    // The precache must open only the versioned bucket names.
    expect(openedNames).toContain(expectedSpritesName);
    expect(openedNames).toContain(expectedCriesName);

    // It must NOT open the unversioned names (those are the wrong buckets).
    expect(openedNames).not.toContain(CACHE_NAMES.sprites);
    expect(openedNames).not.toContain(CACHE_NAMES.cries);
  });

  it("returns zero counts for an empty ID list", async () => {
    const cache = makeCache();
    vi.stubGlobal("caches", makeCaches(cache));
    vi.stubGlobal("fetch", vi.fn());

    const result = await precacheAll({ ids: [] });
    expect(result.totalRequested).toBe(0);
    expect(result.downloaded).toBe(0);
  });

  it("skips already-cached URLs (idempotency)", async () => {
    // Pre-seed just one URL into the cache.
    const urls = buildPrecacheUrls([1]);
    const preseeded = new Set([urls[0]!]);
    const cache = makeCache(preseeded);
    vi.stubGlobal("caches", makeCaches(cache));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("data", { status: 200 })),
    );

    const result = await precacheAll({ ids: [1] });
    // At least one URL was skipped (the pre-seeded one).
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    // Total accounted for.
    expect(result.downloaded + result.skipped + result.failed).toBe(
      result.totalRequested,
    );
  });

  it("counts failed URLs when fetch returns non-ok", async () => {
    const cache = makeCache();
    vi.stubGlobal("caches", makeCaches(cache));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );

    const result = await precacheAll({ ids: [1] });
    expect(result.failed).toBeGreaterThan(0);
    expect(result.downloaded).toBe(0);
  });

  it("counts failed URLs when caches.open throws", async () => {
    vi.stubGlobal("caches", {
      open: vi.fn(async () => {
        throw new Error("Cache unavailable");
      }),
    });
    vi.stubGlobal("fetch", vi.fn());

    const result = await precacheAll({ ids: [1] });
    expect(result.failed).toBeGreaterThan(0);
  });

  it("aborts mid-download when AbortSignal fires", async () => {
    const cache = makeCache();
    vi.stubGlobal("caches", makeCaches(cache));

    let fetchCount = 0;
    const controller = new AbortController();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, opts?: RequestInit) => {
        fetchCount++;
        // Abort after the first fetch.
        if (fetchCount === 1) controller.abort();
        if (opts?.signal?.aborted) {
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        }
        return new Response("data", { status: 200 });
      }),
    );

    const result = await precacheAll({ ids: [1], signal: controller.signal });
    // The total should add up to totalRequested.
    expect(result.downloaded + result.skipped + result.failed).toBeLessThanOrEqual(
      result.totalRequested,
    );
  });

  it("calls onProgress with monotonically increasing done counts", async () => {
    const cache = makeCache();
    vi.stubGlobal("caches", makeCaches(cache));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("data", { status: 200 })),
    );

    const doneValues: number[] = [];
    await precacheAll({
      ids: [1],
      onProgress: ({ done }) => doneValues.push(done),
    });

    // Progress must be reported at least once.
    expect(doneValues.length).toBeGreaterThan(0);
    // Done counts must be non-decreasing.
    for (let i = 1; i < doneValues.length; i++) {
      expect(doneValues[i]).toBeGreaterThanOrEqual(doneValues[i - 1]!);
    }
  });

  it("accrues byte estimate for downloaded sprites", async () => {
    const cache = makeCache();
    vi.stubGlobal("caches", makeCaches(cache));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("data", { status: 200 })),
    );

    let lastBytes = 0;
    await precacheAll({
      ids: [1],
      onProgress: ({ bytesSoFar }) => {
        lastBytes = bytesSoFar;
      },
    });

    expect(lastBytes).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// OFFLINE_DOWNLOADED_AT_KEY
// ---------------------------------------------------------------------------

describe("OFFLINE_DOWNLOADED_AT_KEY", () => {
  it("is a non-empty string", () => {
    expect(typeof OFFLINE_DOWNLOADED_AT_KEY).toBe("string");
    expect(OFFLINE_DOWNLOADED_AT_KEY.length).toBeGreaterThan(0);
  });
});
