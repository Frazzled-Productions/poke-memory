import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSpritePrefetch } from "@/lib/sprites/useSpritePrefetch";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSpritePrefetch", () => {
  it("returns a decodeAhead function", () => {
    const { result } = renderHook(() => useSpritePrefetch());
    expect(typeof result.current.decodeAhead).toBe("function");
  });

  it("decodeAhead resolves immediately for an empty URL list", async () => {
    const { result } = renderHook(() => useSpritePrefetch());
    await act(async () => {
      await expect(result.current.decodeAhead([])).resolves.toBeUndefined();
    });
  });

  it("decodeAhead resolves when all decode() promises settle", async () => {
    const resolvers: Array<() => void> = [];
    const originalImage = window.Image;

    window.Image = class FakeImage {
      src = "";
      decode() {
        return new Promise<void>((resolve) => {
          resolvers.push(resolve);
        });
      }
    } as unknown as typeof window.Image;

    const { result } = renderHook(() => useSpritePrefetch());

    let settled = false;
    const promise = act(async () => {
      await result.current.decodeAhead(["/sprites/1.png", "/sprites/2.png"]);
      settled = true;
    });

    // Pending until resolvers fire.
    expect(settled).toBe(false);
    expect(resolvers).toHaveLength(2);
    resolvers.forEach((r) => r());

    await promise;
    expect(settled).toBe(true);

    window.Image = originalImage;
  });

  it("decodeAhead function reference is stable across re-renders", () => {
    const { result, rerender } = renderHook(() => useSpritePrefetch());
    const first = result.current.decodeAhead;
    rerender();
    expect(result.current.decodeAhead).toBe(first);
  });
});
