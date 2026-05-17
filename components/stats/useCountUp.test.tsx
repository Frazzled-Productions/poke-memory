/**
 * Tests for the useCountUp hook.
 * Lives under components/ (jsdom project) because renderHook requires a DOM.
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useCountUp } from "@/lib/stats/useCountUp";

describe("useCountUp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Provide a minimal performance.now() if the test environment lacks it.
    if (typeof performance === "undefined") {
      (globalThis as unknown as Record<string, unknown>).performance = { now: () => Date.now() };
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 immediately when target is 0", () => {
    const { result } = renderHook(() => useCountUp(0));
    expect(result.current).toBe(0);
  });

  it("starts from 0 and reaches the target after the duration", async () => {
    const { result } = renderHook(() => useCountUp(100, 200));

    // Initially 0 or a very small value.
    expect(result.current).toBeLessThanOrEqual(10);

    // Advance time past the full duration and flush any pending rAFs.
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe(100);
  });

  it("returns a non-negative integer throughout the animation", async () => {
    const values: number[] = [];
    const { result, rerender } = renderHook(() => useCountUp(50, 100));

    for (let t = 0; t <= 150; t += 20) {
      await act(async () => {
        vi.advanceTimersByTime(20);
      });
      rerender();
      values.push(result.current);
    }

    // All observed values must be non-negative integers.
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(v)).toBe(true);
    }
    // Final value must be the target.
    expect(result.current).toBe(50);
  });
});
