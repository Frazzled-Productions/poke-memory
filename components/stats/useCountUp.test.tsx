/**
 * Tests for the useCountUp hook.
 * Lives under components/ (jsdom project) because renderHook requires a DOM.
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useCountUp } from "@/lib/stats/useCountUp";

// Helper to mock window.matchMedia for reduced-motion tests.
function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? matches : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

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

  it("returns target immediately when prefers-reduced-motion is set", async () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useCountUp(80, 600));

    // After the effect runs, displayed should jump straight to target.
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current).toBe(80);
    // Advance well past the duration — no rAF should have been scheduled.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(result.current).toBe(80);

    // Restore default (no reduced motion) for subsequent tests.
    mockMatchMedia(false);
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

  it("restarts animation from the current displayed value when target changes mid-animation", async () => {
    // Render with initial target 100.
    const { result, rerender } = renderHook(({ target }) => useCountUp(target, 600), {
      initialProps: { target: 100 },
    });

    // Advance partway through the animation (150 ms = 25% of 600 ms).
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    // The displayed value should be somewhere between 0 and 100 (non-trivial
    // progress but not yet finished).
    const midValue = result.current;
    expect(midValue).toBeGreaterThan(0);
    expect(midValue).toBeLessThan(100);

    // Rerender with a different target — the animation should restart from
    // `midValue`, not from 0, exercising the
    // `from = lastTargetRef.current === target ? 0 : displayed` branch.
    rerender({ target: 200 });

    // Immediately after the rerender, displayed is still midValue (no rAF yet).
    expect(result.current).toBe(midValue);

    // Advance past the full duration so the new animation completes.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    // Should have converged on the new target.
    expect(result.current).toBe(200);
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
