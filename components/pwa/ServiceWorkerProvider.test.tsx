/**
 * Tests for ServiceWorkerProvider timing behaviour (#1750).
 *
 * The component mounts a service worker, checks for updates on visibility
 * changes, and runs a background update interval. This file covers the
 * tightened thresholds (90 s hidden gate, 2 min throttle, 1 h background
 * interval) and verifies the silent-activation / multi-tab gate behaviour is
 * unchanged.
 *
 * Lives under components/ so the jsdom vitest project picks it up (the
 * component uses browser APIs). @serwist/window is fully mocked at the module
 * boundary via vi.hoisted(); fake timers control setInterval / Date.now()
 * throughout.
 *
 * ServiceWorkerProvider is mocked to () => null in app/layout.test.tsx - that
 * mock stays; this file exercises the REAL component directly.
 */

import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted - create the spy captures before vi.mock hoisting runs so the
// factories can close over them safely.
// ---------------------------------------------------------------------------

const { mockRegister, mockUpdate, mockMessageSkipWaiting, serwistListeners } =
  vi.hoisted(() => {
    type SerwistListener = (event?: unknown) => void;
    const serwistListeners: Record<string, SerwistListener[]> = {};
    return {
      mockRegister: vi.fn<() => Promise<void>>(async () => {}),
      mockUpdate: vi.fn<() => Promise<void>>(async () => {}),
      mockMessageSkipWaiting: vi.fn<() => void>(),
      serwistListeners,
    };
  });

// ---------------------------------------------------------------------------
// Mock @serwist/window - the factory closes over vi.hoisted values only.
// ---------------------------------------------------------------------------

vi.mock("@serwist/window", () => {
  type SerwistListener = (event?: unknown) => void;
  return {
    Serwist: class MockSerwist {
      addEventListener(event: string, listener: SerwistListener) {
        if (!serwistListeners[event]) serwistListeners[event] = [];
        serwistListeners[event].push(listener);
      }
      removeEventListener() {}
      register = mockRegister;
      update = mockUpdate;
      messageSkipWaiting = mockMessageSkipWaiting;
    },
  };
});

// ---------------------------------------------------------------------------
// Mock isSessionActive - no active review session by default.
// ---------------------------------------------------------------------------

const mockIsSessionActive = vi.hoisted(() => vi.fn<() => boolean>(() => false));

vi.mock("@/lib/review/sessionActive", () => ({
  isSessionActive: () => mockIsSessionActive(),
}));

// ---------------------------------------------------------------------------
// Browser API stubs (jsdom does not ship SW support).
// ---------------------------------------------------------------------------

const mockGetRegistration = vi.fn(async () => undefined as undefined | { waiting: null });

Object.defineProperty(navigator, "serviceWorker", {
  value: {
    getRegistration: () => mockGetRegistration(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
  writable: true,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Import the component AFTER the mocks are in place.
// ---------------------------------------------------------------------------

import { ServiceWorkerProvider } from "@/components/pwa/ServiceWorkerProvider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fire a visibilitychange event with the given state. */
function fireVisibilityChange(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Reset the listener capture map between tests. */
function resetListeners() {
  for (const key of Object.keys(serwistListeners)) {
    delete serwistListeners[key];
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Force production mode so the component's early-exit guard doesn't fire.
  vi.stubEnv("NODE_ENV", "production");

  vi.useFakeTimers();

  resetListeners();
  mockRegister.mockClear();
  mockUpdate.mockClear();
  mockMessageSkipWaiting.mockClear();
  mockIsSessionActive.mockReturnValue(false);
  mockGetRegistration.mockResolvedValue(undefined);

  // Ensure visibilityState starts as "visible".
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Tests: visibility-triggered update() thresholds.
// ---------------------------------------------------------------------------

describe("ServiceWorkerProvider - update() on visibility check", () => {
  it("does NOT call update() when the tab was hidden for less than 90 s", async () => {
    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve(); // flush register() promise
    });

    // Hide the tab.
    fireVisibilityChange("hidden");
    // Advance to just under the 90 s threshold.
    vi.advanceTimersByTime(89_999);
    // Show the tab again.
    fireVisibilityChange("visible");

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("calls update() exactly once after the tab is hidden for >= 90 s", async () => {
    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    // Hide the tab, wait exactly the 90 s threshold, then reveal.
    fireVisibilityChange("hidden");
    vi.advanceTimersByTime(90_000);
    fireVisibilityChange("visible");

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("does NOT call update() a second time if less than 2 min have passed since the first check", async () => {
    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    // First cycle: hidden 90 s then visible - update() fires.
    fireVisibilityChange("hidden");
    vi.advanceTimersByTime(90_000);
    fireVisibilityChange("visible");
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    // Second cycle: hide again 90 s, but only 90 s since last update() (< 2 min throttle).
    fireVisibilityChange("hidden");
    vi.advanceTimersByTime(90_000);
    fireVisibilityChange("visible");
    await act(async () => {
      await Promise.resolve();
    });

    // Still only 1 call - throttle blocked the second.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("calls update() again after the 2-min throttle has elapsed", async () => {
    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    // First cycle: fires.
    fireVisibilityChange("hidden");
    vi.advanceTimersByTime(90_000);
    fireVisibilityChange("visible");
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    // Advance enough real time that the throttle (2 min = 120 000 ms) has cleared.
    vi.advanceTimersByTime(120_000);

    // Second cycle: hidden 90 s then visible fires again.
    fireVisibilityChange("hidden");
    vi.advanceTimersByTime(90_000);
    fireVisibilityChange("visible");
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: 1-hour background interval.
// ---------------------------------------------------------------------------

describe("ServiceWorkerProvider - 1-hour background interval", () => {
  it("calls update() on the 1-hour interval for tabs that never hide", async () => {
    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    // No visibility changes - advance exactly 1 hour.
    vi.advanceTimersByTime(60 * 60 * 1000);
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("calls update() a second time after 2 hours", async () => {
    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it("does NOT call update() before the 1-hour mark", async () => {
    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    vi.advanceTimersByTime(60 * 60 * 1000 - 1);
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: silent-activation / multi-tab gate is unchanged.
// ---------------------------------------------------------------------------

describe("ServiceWorkerProvider - silent activation and multi-tab gate unchanged", () => {
  it("posts messageSkipWaiting when the tab hides and a SW is waiting", async () => {
    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    // Simulate the SW firing the 'waiting' event to arm the activator.
    serwistListeners["waiting"]?.forEach((l) => l());

    fireVisibilityChange("hidden");

    expect(mockMessageSkipWaiting).toHaveBeenCalledTimes(1);
  });

  it("does NOT post messageSkipWaiting when no SW is waiting", async () => {
    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    // No 'waiting' event fired.
    fireVisibilityChange("hidden");

    expect(mockMessageSkipWaiting).not.toHaveBeenCalled();
  });

  it("does NOT post messageSkipWaiting when a review session is active", async () => {
    mockIsSessionActive.mockReturnValue(true);

    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    serwistListeners["waiting"]?.forEach((l) => l());
    fireVisibilityChange("hidden");

    expect(mockMessageSkipWaiting).not.toHaveBeenCalled();
  });

  it("does NOT post messageSkipWaiting from the timing changes alone (no waiting SW)", async () => {
    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    // Advance through both timing thresholds without a waiting SW.
    fireVisibilityChange("hidden");
    vi.advanceTimersByTime(90_000);
    fireVisibilityChange("visible");
    vi.advanceTimersByTime(60 * 60 * 1000);
    await act(async () => {
      await Promise.resolve();
    });

    // update() fired on the interval and visibility check, but no SKIP_WAITING
    // was posted because no SW is in the waiting state. A reload is only
    // triggered via controllerchange after messageSkipWaiting - which requires
    // a waiting worker first.
    expect(mockMessageSkipWaiting).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled(); // both thresholds fired update()
  });
});
