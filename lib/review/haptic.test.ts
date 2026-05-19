import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  prefersReducedMotion,
  supportsVibration,
  supportsSwitchHaptic,
  triggerHaptic,
} from "./haptic";

// ---------------------------------------------------------------------------
// Helpers — stub browser globals on globalThis for the node test environment.
// ---------------------------------------------------------------------------

function stubMatchMedia(reducedMotion: boolean) {
  (globalThis as Record<string, unknown>).window = {
    matchMedia: (query: string) => ({
      matches:
        query === "(prefers-reduced-motion: reduce)" ? reducedMotion : false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  };
}

function clearWindow() {
  delete (globalThis as Record<string, unknown>).window;
}

function stubNavigatorVibrate(fn?: () => boolean) {
  (globalThis as Record<string, unknown>).navigator = { vibrate: fn ?? vi.fn() };
}

function clearNavigator() {
  delete (globalThis as Record<string, unknown>).navigator;
}

// ---------------------------------------------------------------------------
// prefersReducedMotion
// ---------------------------------------------------------------------------

describe("prefersReducedMotion", () => {
  afterEach(clearWindow);

  it("returns false when window is undefined (SSR)", () => {
    clearWindow();
    expect(prefersReducedMotion()).toBe(false);
  });

  it("returns false when reduced-motion is not set", () => {
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("returns true when reduced-motion is set", () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// supportsVibration
// ---------------------------------------------------------------------------

describe("supportsVibration", () => {
  afterEach(clearNavigator);

  it("returns false when navigator is undefined", () => {
    clearNavigator();
    expect(supportsVibration()).toBe(false);
  });

  it("returns false when navigator.vibrate is not a function", () => {
    (globalThis as Record<string, unknown>).navigator = { vibrate: undefined };
    expect(supportsVibration()).toBe(false);
  });

  it("returns true when navigator.vibrate is a function", () => {
    stubNavigatorVibrate();
    expect(supportsVibration()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// supportsSwitchHaptic
// ---------------------------------------------------------------------------

describe("supportsSwitchHaptic", () => {
  it("returns false in the node environment (no document)", () => {
    // In node, document is undefined — supportsSwitchHaptic must not throw.
    expect(supportsSwitchHaptic()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// triggerHaptic
// ---------------------------------------------------------------------------

describe("triggerHaptic", () => {
  beforeEach(() => {
    stubMatchMedia(false);
  });

  afterEach(() => {
    clearWindow();
    clearNavigator();
  });

  it("does nothing when reduced-motion is active", () => {
    stubMatchMedia(true);
    const ios = vi.fn();
    const vibrate = vi.fn();
    stubNavigatorVibrate(vibrate);
    triggerHaptic(4, ios);
    expect(vibrate).not.toHaveBeenCalled();
    expect(ios).not.toHaveBeenCalled();
  });

  it("calls navigator.vibrate with the correct pattern for Again (grade 1)", () => {
    const vibrate = vi.fn();
    stubNavigatorVibrate(vibrate);
    triggerHaptic(1, null);
    expect(vibrate).toHaveBeenCalledWith([30, 60, 30]);
  });

  it("calls navigator.vibrate with the correct pattern for Hard (grade 2)", () => {
    const vibrate = vi.fn();
    stubNavigatorVibrate(vibrate);
    triggerHaptic(2, null);
    expect(vibrate).toHaveBeenCalledWith(40);
  });

  it("calls navigator.vibrate with the correct pattern for Good (grade 4)", () => {
    const vibrate = vi.fn();
    stubNavigatorVibrate(vibrate);
    triggerHaptic(4, null);
    expect(vibrate).toHaveBeenCalledWith(20);
  });

  it("calls navigator.vibrate with the correct pattern for Easy (grade 5)", () => {
    const vibrate = vi.fn();
    stubNavigatorVibrate(vibrate);
    triggerHaptic(5, null);
    expect(vibrate).toHaveBeenCalledWith(15);
  });

  it("calls the iOS trigger when vibration is unavailable", () => {
    clearNavigator();
    const ios = vi.fn();
    triggerHaptic(4, ios);
    expect(ios).toHaveBeenCalledOnce();
  });

  it("does not call ios trigger when vibration is available", () => {
    const ios = vi.fn();
    const vibrate = vi.fn();
    stubNavigatorVibrate(vibrate);
    triggerHaptic(4, ios);
    expect(ios).not.toHaveBeenCalled();
  });

  it("does nothing when both vibrate is absent and triggerIos is null", () => {
    clearNavigator();
    // Should not throw.
    expect(() => triggerHaptic(4, null)).not.toThrow();
  });
});
