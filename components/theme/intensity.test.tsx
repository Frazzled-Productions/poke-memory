/**
 * Tests for lib/theme/intensity.ts - lives under components/ so the jsdom
 * vitest project picks it up (lib/ runs in the node environment without a DOM;
 * see AGENTS.md "Testing" section for the partitioning rules).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { applyIntensity } from "@/lib/theme/intensity";

beforeEach(() => {
  // Reset the attribute between tests.
  document.documentElement.removeAttribute("data-intensity");
});

describe("applyIntensity", () => {
  it('sets data-intensity="tinted" when called with "tinted"', () => {
    applyIntensity("tinted");
    expect(document.documentElement.getAttribute("data-intensity")).toBe("tinted");
  });

  it('sets data-intensity="full" when called with "full"', () => {
    applyIntensity("full");
    expect(document.documentElement.getAttribute("data-intensity")).toBe("full");
  });

  it('removes data-intensity when called with "accents"', () => {
    // First put something on the attribute to ensure it is really removed.
    document.documentElement.setAttribute("data-intensity", "full");
    applyIntensity("accents");
    expect(document.documentElement.hasAttribute("data-intensity")).toBe(false);
  });

  it('removes data-intensity when called with "accents" and no prior attribute', () => {
    // Should not throw when the attribute is already absent.
    expect(() => applyIntensity("accents")).not.toThrow();
    expect(document.documentElement.hasAttribute("data-intensity")).toBe(false);
  });
});
