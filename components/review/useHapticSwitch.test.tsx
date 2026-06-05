import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useHapticSwitch } from "@/components/review/useHapticSwitch";

// ---------------------------------------------------------------------------
// Helpers - stub document.createElement so supportsSwitchHaptic() is
// controllable in the jsdom environment.
// ---------------------------------------------------------------------------

function stubSwitchSupport(supported: boolean) {
  const original = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = original(tag);
    if (tag === "input" && supported) {
      // Make the `switch` property appear on the element, mimicking iOS Safari.
      Object.defineProperty(el, "switch", { value: true, configurable: true });
    }
    return el;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// useHapticSwitch
// ---------------------------------------------------------------------------

describe("useHapticSwitch", () => {
  describe("when the switch attribute is NOT supported", () => {
    beforeEach(() => stubSwitchSupport(false));

    it("returns supported=false", () => {
      const { result } = renderHook(() => useHapticSwitch());
      expect(result.current.supported).toBe(false);
    });

    it("returns triggerIosHaptic=null", () => {
      const { result } = renderHook(() => useHapticSwitch());
      expect(result.current.triggerIosHaptic).toBeNull();
    });

    it("labelRef starts as null", () => {
      const { result } = renderHook(() => useHapticSwitch());
      expect(result.current.labelRef.current).toBeNull();
    });
  });

  describe("when the switch attribute IS supported", () => {
    beforeEach(() => stubSwitchSupport(true));

    it("returns supported=true", () => {
      const { result } = renderHook(() => useHapticSwitch());
      expect(result.current.supported).toBe(true);
    });

    it("returns a non-null triggerIosHaptic function", () => {
      const { result } = renderHook(() => useHapticSwitch());
      expect(result.current.triggerIosHaptic).toBeTypeOf("function");
    });

    it("triggerIosHaptic clicks the label when the ref is attached", () => {
      const { result } = renderHook(() => useHapticSwitch());

      // Attach a mock label element to the ref.
      const label = document.createElement("label");
      const clickSpy = vi.spyOn(label, "click");
      // Assign directly - React's useRef returns a mutable ref object.
      (result.current.labelRef as React.MutableRefObject<HTMLLabelElement>).current = label;

      result.current.triggerIosHaptic!();

      expect(clickSpy).toHaveBeenCalledOnce();
    });

    it("triggerIosHaptic is a no-op when the ref is not yet attached", () => {
      const { result } = renderHook(() => useHapticSwitch());
      // labelRef.current is null (no DOM node assigned).
      expect(() => result.current.triggerIosHaptic!()).not.toThrow();
    });
  });
});
