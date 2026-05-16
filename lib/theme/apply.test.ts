import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { applyTheme } from "./apply";
import type { ThemeColors } from "./curated-pokemon";

// ---------------------------------------------------------------------------
// Stub document.documentElement so the node environment can exercise applyTheme.
// ---------------------------------------------------------------------------

const COLORS: ThemeColors = {
  primary: "#E8631A",
  secondary: "#F4A460",
  accent: "#FFD700",
  fgOnPrimary: "#1A0A00",
};

function makeMockRoot() {
  const style = new Map<string, string>();
  return {
    style: {
      setProperty: (name: string, value: string) => style.set(name, value),
      removeProperty: (name: string) => style.delete(name),
      getPropertyValue: (name: string) => style.get(name) ?? "",
      _store: style,
    },
  };
}

let mockRoot: ReturnType<typeof makeMockRoot>;

beforeEach(() => {
  mockRoot = makeMockRoot();
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { documentElement: mockRoot });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applyTheme", () => {
  it("sets all four CSS custom properties when colors are provided", () => {
    applyTheme(COLORS);
    expect(mockRoot.style.getPropertyValue("--theme-primary")).toBe(COLORS.primary);
    expect(mockRoot.style.getPropertyValue("--theme-secondary")).toBe(COLORS.secondary);
    expect(mockRoot.style.getPropertyValue("--theme-accent")).toBe(COLORS.accent);
    expect(mockRoot.style.getPropertyValue("--theme-fg-on-primary")).toBe(COLORS.fgOnPrimary);
  });

  it("removes all four CSS custom properties when colors is null (reset path)", () => {
    // First set them, then clear
    applyTheme(COLORS);
    applyTheme(null);
    expect(mockRoot.style.getPropertyValue("--theme-primary")).toBe("");
    expect(mockRoot.style.getPropertyValue("--theme-secondary")).toBe("");
    expect(mockRoot.style.getPropertyValue("--theme-accent")).toBe("");
    expect(mockRoot.style.getPropertyValue("--theme-fg-on-primary")).toBe("");
  });

  it("calling null when nothing was set does not throw", () => {
    expect(() => applyTheme(null)).not.toThrow();
  });

  it("calling with colors when already set overwrites them", () => {
    const first: ThemeColors = { primary: "#AAA", secondary: "#BBB", accent: "#CCC", fgOnPrimary: "#DDD" };
    const second: ThemeColors = { primary: "#111", secondary: "#222", accent: "#333", fgOnPrimary: "#FFF" };
    applyTheme(first);
    applyTheme(second);
    expect(mockRoot.style.getPropertyValue("--theme-primary")).toBe("#111");
    expect(mockRoot.style.getPropertyValue("--theme-fg-on-primary")).toBe("#FFF");
  });

  it("is a no-op when window is undefined (SSR path)", () => {
    vi.unstubAllGlobals();
    // With window undefined the function should guard and not touch document
    expect(() => applyTheme(COLORS)).not.toThrow();
  });
});
