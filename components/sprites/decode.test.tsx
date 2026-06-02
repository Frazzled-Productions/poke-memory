import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decodeSpriteUrls, DECODE_TIMEOUT_MS } from "@/lib/sprites/decode";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A fake `window.Image` whose `decode()` method is backed by a manually-
 * resolvable promise. Lets tests control exactly when decode resolves so we
 * can assert the timing-dependent behaviour of `decodeSpriteUrls`.
 */
function makeFakeImageClass(
  resolvers: Array<() => void>,
  opts: { decodeFails?: boolean } = {},
) {
  return class FakeImage {
    src = "";
    decode() {
      if (opts.decodeFails) {
        return Promise.reject(new Error("decode failed"));
      }
      return new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
    }
  } as unknown as typeof window.Image;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("decodeSpriteUrls", () => {
  let originalImage: typeof window.Image;
  let resolvers: Array<() => void>;

  beforeEach(() => {
    originalImage = window.Image;
    resolvers = [];
  });

  afterEach(() => {
    window.Image = originalImage;
    vi.restoreAllMocks();
  });

  it("resolves immediately when given an empty URL list", async () => {
    // No FakeImage needed — empty list short-circuits before creating any Image.
    await expect(decodeSpriteUrls([])).resolves.toBeUndefined();
  });

  it("resolves after all decode() promises settle", async () => {
    window.Image = makeFakeImageClass(resolvers);

    const promise = decodeSpriteUrls(["/sprites/1.png", "/sprites/2.png"]);

    // Resolve each decode in turn.
    expect(resolvers).toHaveLength(2);
    resolvers.forEach((resolve) => resolve());

    await expect(promise).resolves.toBeUndefined();
  });

  it("does not resolve before decode() promises settle", async () => {
    window.Image = makeFakeImageClass(resolvers);

    let resolved = false;
    const promise = decodeSpriteUrls(["/sprites/1.png"]).then(() => {
      resolved = true;
    });

    // At this point the decode promise is still pending.
    expect(resolved).toBe(false);

    // Resolve the decode and flush the microtask queue.
    resolvers.forEach((resolve) => resolve());
    await promise;

    expect(resolved).toBe(true);
  });

  it("resolves after the timeout even when decode never settles", async () => {
    vi.useFakeTimers();

    // FakeImage whose decode() never resolves (no resolver pushed).
    window.Image = class HangingImage {
      src = "";
      decode() {
        return new Promise<void>(() => {/* intentionally never resolves */});
      }
    } as unknown as typeof window.Image;

    const promise = decodeSpriteUrls(["/sprites/hanging.png"]);

    // Advance past the safety-valve timeout.
    vi.advanceTimersByTime(DECODE_TIMEOUT_MS + 1);

    await expect(promise).resolves.toBeUndefined();

    vi.useRealTimers();
  });

  it("resolves (does not throw) when decode() rejects for a URL", async () => {
    window.Image = makeFakeImageClass(resolvers, { decodeFails: true });

    // decodeSpriteUrls catches per-image failures and continues.
    await expect(decodeSpriteUrls(["/sprites/bad.png"])).resolves.toBeUndefined();
  });

  it("falls back gracefully when decode is not a function on the Image instance", async () => {
    window.Image = class NoDecodeImage {
      src = "";
      // No decode() method — simulates very old browsers or jsdom baseline.
    } as unknown as typeof window.Image;

    await expect(decodeSpriteUrls(["/sprites/old-browser.png"])).resolves.toBeUndefined();
  });

  it("calls onSlowLoad when the timeout wins the race", async () => {
    vi.useFakeTimers();

    window.Image = class HangingImage {
      src = "";
      decode() {
        return new Promise<void>(() => {/* intentionally never resolves */});
      }
    } as unknown as typeof window.Image;

    const onSlowLoad = vi.fn();
    const promise = decodeSpriteUrls(["/sprites/slow.png"], 500, onSlowLoad);

    // Advance past the safety-valve timeout.
    vi.advanceTimersByTime(501);
    await promise;

    expect(onSlowLoad).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  it("does NOT call onSlowLoad when decode wins the race", async () => {
    window.Image = makeFakeImageClass(resolvers);

    const onSlowLoad = vi.fn();
    const promise = decodeSpriteUrls(["/sprites/fast.png"], 500, onSlowLoad);

    // Resolve the decode immediately — decode wins before the timeout.
    resolvers.forEach((resolve) => resolve());
    await promise;

    expect(onSlowLoad).not.toHaveBeenCalled();
  });

  it("does NOT call onSlowLoad when the URL list is empty", async () => {
    const onSlowLoad = vi.fn();
    await decodeSpriteUrls([], 500, onSlowLoad);
    expect(onSlowLoad).not.toHaveBeenCalled();
  });
});
