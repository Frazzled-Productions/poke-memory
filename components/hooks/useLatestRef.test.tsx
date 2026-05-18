import { renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useLatestRef } from "@/lib/hooks/useLatestRef";

describe("useLatestRef", () => {
  it("ref.current equals the initial value on first render", () => {
    const { result } = renderHook(() => useLatestRef("initial"));
    expect(result.current.current).toBe("initial");
  });

  it("ref.current reflects the new value after a re-render", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useLatestRef(value),
      { initialProps: { value: "first" } },
    );

    expect(result.current.current).toBe("first");

    rerender({ value: "second" });

    expect(result.current.current).toBe("second");
  });

  it("the same ref object is returned across renders (stable identity)", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: number }) => useLatestRef(value),
      { initialProps: { value: 1 } },
    );

    const refBefore = result.current;
    rerender({ value: 2 });
    const refAfter = result.current;

    expect(refBefore).toBe(refAfter);
    expect(refAfter.current).toBe(2);
  });
});
