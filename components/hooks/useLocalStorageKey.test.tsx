/**
 * Tests for useLocalStorageKey (issue #923).
 *
 * Covers:
 *   - The counter starts at 0.
 *   - A `storage` event for the watched key increments the counter.
 *   - A `storage` event for a different key does NOT increment the counter.
 *   - The listener is removed on unmount (no further increments after unmount).
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";

function dispatchStorageEvent(key: string) {
  const event = new StorageEvent("storage", { key });
  window.dispatchEvent(event);
}

describe("useLocalStorageKey", () => {
  it("starts at 0", () => {
    const { result } = renderHook(() => useLocalStorageKey("poke-memory:test"));
    expect(result.current).toBe(0);
  });

  it("increments when the watched key fires", () => {
    const { result } = renderHook(() =>
      useLocalStorageKey("poke-memory:test-key"),
    );

    act(() => {
      dispatchStorageEvent("poke-memory:test-key");
    });

    expect(result.current).toBe(1);

    act(() => {
      dispatchStorageEvent("poke-memory:test-key");
    });

    expect(result.current).toBe(2);
  });

  it("does NOT increment for a different key", () => {
    const { result } = renderHook(() =>
      useLocalStorageKey("poke-memory:watched"),
    );

    act(() => {
      dispatchStorageEvent("poke-memory:other");
    });

    expect(result.current).toBe(0);
  });

  it("removes the listener on unmount", () => {
    const { result, unmount } = renderHook(() =>
      useLocalStorageKey("poke-memory:unmount-key"),
    );

    unmount();

    act(() => {
      dispatchStorageEvent("poke-memory:unmount-key");
    });

    // Counter should remain at 0 - listener was cleaned up.
    expect(result.current).toBe(0);
  });
});
