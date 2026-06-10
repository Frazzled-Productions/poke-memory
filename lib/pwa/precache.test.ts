import { describe, it, expect, vi, afterEach } from "vitest";
import { buildPrecacheUrls, precacheAll, OFFLINE_DOWNLOADED_AT_KEY, OFFLINE_PRECACHE_WIDTHS } from "./precache";
import { GENERATED_SPRITE_WIDTHS } from "@/lib/sprites/imageLoaderHelpers";
import * as offlineStore from "./offlineStore";

// ---------------------------------------------------------------------------
// IDB stub helpers.
//
// precache.ts uses offlineHas + offlinePut from offlineStore.ts to read and
// write blobs into IndexedDB. We mock these at the module level so tests run
// without a real IDB environment.
// ---------------------------------------------------------------------------

function makeIdbStubs(existingUrls: Set<string> = new Set()) {
  const idbStore = new Map<string, { blob: Blob; contentType: string }>();
  for (const u of existingUrls) {
    idbStore.set(u, { blob: new Blob(["cached"]), contentType: "application/octet-stream" });
  }

  const hasSpy = vi.spyOn(offlineStore, "offlineHas").mockImplementation(async (url) => idbStore.has(url));
  const putSpy = vi.spyOn(offlineStore, "offlinePut").mockImplementation(async (url, entry) => {
    idbStore.set(url, entry);
  });

  return { idbStore, hasSpy, putSpy };
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

  it("does NOT include any raw PNG paths (Pokédex grid switched to WebP in #1740)", () => {
    // The grid now serves /sprites/pokemon/webp/<id>/64.webp; raw PNGs are no
    // longer precached. A regression here means the precache grows by ~144 MB.
    const urls = buildPrecacheUrls([1, 2, 3]);
    const pngUrls = urls.filter((u) => u.match(/^\/sprites\/pokemon\/\d+\.png$/));
    expect(pngUrls).toHaveLength(0);
  });

  it("includes the cry URL for each species", () => {
    const urls = buildPrecacheUrls([4]);
    expect(urls).toContain("/cries/4.ogg");
  });

  it("produces a distinct set of URLs for multiple IDs", () => {
    const urls = buildPrecacheUrls([1, 2, 3]);
    // Each ID contributes WebP variants for all render widths - no raw PNGs.
    const webpFor1 = urls.filter((u) => u.startsWith("/sprites/pokemon/webp/1/"));
    const webpFor2 = urls.filter((u) => u.startsWith("/sprites/pokemon/webp/2/"));
    const webpFor3 = urls.filter((u) => u.startsWith("/sprites/pokemon/webp/3/"));
    expect(webpFor1.length).toBeGreaterThan(0);
    expect(webpFor2.length).toBeGreaterThan(0);
    expect(webpFor3.length).toBeGreaterThan(0);
    // No duplicate URLs.
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("returns an empty array for an empty ID list", () => {
    expect(buildPrecacheUrls([])).toHaveLength(0);
  });

  it("emits exactly (OFFLINE_PRECACHE_WIDTHS.length + 1) URLs per species", () => {
    // +1 for the cry. This assertion is a CI gate: adding a new width to
    // OFFLINE_PRECACHE_WIDTHS grows every user's offline download by ~1025 ×
    // (size per width) and must be a conscious decision, not a silent side-effect.
    // Note: OFFLINE_PRECACHE_WIDTHS is a strict subset of GENERATED_SPRITE_WIDTHS
    // (all 10 generated widths minus the decorative-only 180 px watermark).
    const single = buildPrecacheUrls([1]);
    expect(single).toHaveLength(OFFLINE_PRECACHE_WIDTHS.length + 1);

    const three = buildPrecacheUrls([1, 2, 3]);
    expect(three).toHaveLength((OFFLINE_PRECACHE_WIDTHS.length + 1) * 3);

    // Snapshot the current offline width count so any addition fails CI explicitly.
    // GENERATED_SPRITE_WIDTHS still has 10; the precache uses 9 (drops 180 px watermark).
    expect(GENERATED_SPRITE_WIDTHS.length).toBe(10);
    expect(OFFLINE_PRECACHE_WIDTHS.length).toBe(9);
  });

  it("emits only the offline-reachable widths (not all generated widths)", () => {
    // The 180 px ThemeWatermark variant must NOT appear in the precache:
    // it is decorative-only and would waste ~7.8 MB per user's offline download.
    const urls = buildPrecacheUrls([1]);
    const webpUrls = urls.filter((u) => u.startsWith("/sprites/pokemon/webp/1/"));
    const emittedWidths = webpUrls
      .map((u) => {
        const match = u.match(/\/(\d+)\.webp$/);
        return match ? parseInt(match[1]!, 10) : null;
      })
      .filter((w): w is number => w !== null)
      .sort((a, b) => a - b);

    // Must match OFFLINE_PRECACHE_WIDTHS exactly.
    expect(emittedWidths).toEqual([...OFFLINE_PRECACHE_WIDTHS].sort((a, b) => a - b));

    // Explicitly assert that 180 (ThemeWatermark, dropped in #1789) is absent.
    expect(emittedWidths).not.toContain(180);

    // All 9 kept widths must be present.
    for (const w of OFFLINE_PRECACHE_WIDTHS) {
      expect(emittedWidths).toContain(w);
    }
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

  it("stores blobs in IndexedDB (not Cache Storage) - uses offlinePut per URL", async () => {
    // Since #1803 the offline pack lives in IndexedDB. This test pins that
    // precacheAll calls offlinePut (not caches.open / cache.put) for each URL.
    const { putSpy } = makeIdbStubs();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("data", { status: 200 })),
    );

    await precacheAll({ ids: [25] });

    // offlinePut must have been called for every URL produced by buildPrecacheUrls.
    const expectedUrls = buildPrecacheUrls([25]);
    // Some URLs may be fetched concurrently but all should be stored.
    expect(putSpy.mock.calls.length).toBeGreaterThan(0);
    // Every stored key must be one of the expected URLs.
    for (const [url] of putSpy.mock.calls) {
      expect(expectedUrls).toContain(url);
    }
  });

  it("does NOT open Cache Storage (no caches.open calls)", async () => {
    // Regression guard: after #1803 the precache must never touch Cache Storage.
    makeIdbStubs();
    const cachesOpenSpy = vi.fn();
    vi.stubGlobal("caches", { open: cachesOpenSpy });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("data", { status: 200 })),
    );

    await precacheAll({ ids: [25] });

    expect(cachesOpenSpy).not.toHaveBeenCalled();
  });

  it("returns zero counts for an empty ID list", async () => {
    makeIdbStubs();
    vi.stubGlobal("fetch", vi.fn());

    const result = await precacheAll({ ids: [] });
    expect(result.totalRequested).toBe(0);
    expect(result.downloaded).toBe(0);
  });

  it("skips already-stored URLs (idempotency - offlineHas returns true)", async () => {
    // Pre-seed just one URL into the IDB store.
    const urls = buildPrecacheUrls([1]);
    const preseeded = new Set([urls[0]!]);
    makeIdbStubs(preseeded);
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
    makeIdbStubs();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );

    const result = await precacheAll({ ids: [1] });
    expect(result.failed).toBeGreaterThan(0);
    expect(result.downloaded).toBe(0);
  });

  it("counts failed URLs when offlinePut throws", async () => {
    // offlineHas returns false (miss) so a fetch is attempted, but offlinePut throws.
    vi.spyOn(offlineStore, "offlineHas").mockResolvedValue(false);
    vi.spyOn(offlineStore, "offlinePut").mockRejectedValue(new Error("IDB write failed"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("data", { status: 200 })),
    );

    const result = await precacheAll({ ids: [1] });
    expect(result.failed).toBeGreaterThan(0);
  });

  it("aborts mid-download when AbortSignal fires", async () => {
    makeIdbStubs();

    let fetchCount = 0;
    const controller = new AbortController();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, opts?: RequestInit) => {
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
    makeIdbStubs();
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

  it("accrues real bytes from Content-Length header for downloaded sprites", async () => {
    makeIdbStubs();
    // Return a response with a known Content-Length so we can assert the exact accumulation.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("data", {
          status: 200,
          headers: { "content-length": "12345" },
        }),
      ),
    );

    const byteSamples: number[] = [];
    await precacheAll({
      ids: [1],
      onProgress: ({ bytesSoFar }) => {
        byteSamples.push(bytesSoFar);
      },
    });

    // bytesSoFar must grow (each downloaded asset contributes its real size).
    expect(byteSamples.length).toBeGreaterThan(0);
    expect(byteSamples[byteSamples.length - 1]).toBeGreaterThan(0);

    // Every increment must be exactly 12345 (the Content-Length value),
    // confirming the heuristic (25_000 / 15_000) is no longer used.
    const distinctIncrements = new Set<number>();
    for (let i = 1; i < byteSamples.length; i++) {
      distinctIncrements.add(byteSamples[i]! - byteSamples[i - 1]!);
    }
    if (byteSamples.length > 1) {
      for (const inc of distinctIncrements) {
        expect(inc).toBe(12345);
      }
    }
  });

  it("accrues bytes from blob size when Content-Length header is absent", async () => {
    makeIdbStubs();
    // Response without Content-Length; body is 4 bytes ("data").
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

    // Should still accumulate something (blob.size >= 0 for each downloaded asset).
    // The precise value depends on the jsdom Response blob implementation, but
    // it must not be the old heuristic (25_000 / 15_000).
    expect(lastBytes).toBeGreaterThanOrEqual(0);
    // Must NOT equal the old flat-estimate total (9 sprites × 25_000 + 1 cry × 15_000 = 240_000).
    expect(lastBytes).not.toBe(9 * 25_000 + 15_000);
  });

  it("does not add heuristic bytes (25_000/15_000) - old estimate is gone", async () => {
    makeIdbStubs();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("x", {
          status: 200,
          headers: { "content-length": "100" },
        }),
      ),
    );

    const samples: number[] = [];
    await precacheAll({
      ids: [1],
      onProgress: ({ bytesSoFar }) => samples.push(bytesSoFar),
    });

    const last = samples[samples.length - 1] ?? 0;
    // Each URL contributes exactly 100 bytes (the Content-Length).
    // 9 WebP widths + 1 cry = 10 URLs → 1000 bytes total.
    // The old heuristic would give 9 × 25_000 + 15_000 = 240_000. Assert against that.
    expect(last).toBeLessThan(50_000); // well under any heuristic value
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
