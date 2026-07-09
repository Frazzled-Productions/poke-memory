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

const { mockRegister, mockUpdate, mockMessageSW, serwistListeners } =
  vi.hoisted(() => {
    type SerwistListener = (event?: unknown) => void;
    const serwistListeners: Record<string, SerwistListener[]> = {};
    return {
      mockRegister: vi.fn<() => Promise<void>>(async () => {}),
      mockUpdate: vi.fn<() => Promise<void>>(async () => {}),
      // messageSW is now called directly (not via Serwist.messageSkipWaiting)
      // so we can assert the REQUEST_SKIP_WAITING type is sent (#1858 F34).
      mockMessageSW: vi.fn<() => Promise<void>>(async () => {}),
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
    },
    messageSW: mockMessageSW,
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
  mockMessageSW.mockClear();
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

describe("ServiceWorkerProvider - silent activation and multi-tab gate", () => {
  it("sends REQUEST_SKIP_WAITING (not SKIP_WAITING) when the tab hides and a SW is waiting (#1858 F34)", async () => {
    // Provide a waiting SW registration so the component can message it.
    const waitingWorker = {} as ServiceWorker;
    mockGetRegistration.mockResolvedValue({ waiting: waitingWorker } as unknown as {
      waiting: null;
    });

    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    // Simulate the SW firing the 'waiting' event to arm the activator.
    serwistListeners["waiting"]?.forEach((l) => l());

    await act(async () => {
      fireVisibilityChange("hidden");
      // Flush the getRegistration() promise inside the handler.
      await Promise.resolve();
    });

    // Must use REQUEST_SKIP_WAITING, not the built-in SKIP_WAITING, so
    // Serwist's unconditional listener does not fire before our client-count
    // gate runs in the SW.
    expect(mockMessageSW).toHaveBeenCalledWith(waitingWorker, {
      type: "REQUEST_SKIP_WAITING",
    });
  });

  it("does NOT send REQUEST_SKIP_WAITING when no SW is waiting", async () => {
    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    // No 'waiting' event fired.
    await act(async () => {
      fireVisibilityChange("hidden");
      await Promise.resolve();
    });

    expect(mockMessageSW).not.toHaveBeenCalled();
  });

  it("does NOT send REQUEST_SKIP_WAITING when a review session is active", async () => {
    mockIsSessionActive.mockReturnValue(true);
    const waitingWorker = {} as ServiceWorker;
    mockGetRegistration.mockResolvedValue({ waiting: waitingWorker } as unknown as {
      waiting: null;
    });

    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    serwistListeners["waiting"]?.forEach((l) => l());
    await act(async () => {
      fireVisibilityChange("hidden");
      await Promise.resolve();
    });

    expect(mockMessageSW).not.toHaveBeenCalled();
  });

  it("does NOT send REQUEST_SKIP_WAITING from the timing changes alone (no waiting SW)", async () => {
    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    // Advance through both timing thresholds without a waiting SW.
    await act(async () => {
      fireVisibilityChange("hidden");
      vi.advanceTimersByTime(90_000);
      fireVisibilityChange("visible");
      vi.advanceTimersByTime(60 * 60 * 1000);
      await Promise.resolve();
    });

    // update() fired on the interval and visibility check, but no REQUEST_SKIP_WAITING
    // was posted because no SW is in the waiting state.
    expect(mockMessageSW).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled(); // both thresholds fired update()
  });
});

// ---------------------------------------------------------------------------
// Tests: rejection handling (#1913).
//
// Every promise the component starts is fire-and-forget. Before #1913 they were
// floated with a bare `void`, which discards the resolved value but leaves a
// rejection unhandled - it reached `window.onunhandledrejection` and Sentry
// captured it as an unhandled `error`-level exception in production.
//
// Each test below drives one rejecting branch and asserts the `.catch()` ran,
// which is what proves the rejection was handled rather than escaping.
// ---------------------------------------------------------------------------

describe("ServiceWorkerProvider - rejection handling", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
  });

  /** Assert console.debug logged the given context, with the causing error. */
  function expectSwFailureLogged(context: string, error: Error) {
    expect(debugSpy).toHaveBeenCalledWith(
      `[sw] ${context} failed; continuing without a service worker`,
      error,
    );
  }

  it("handles a rejecting register() and still renders", async () => {
    // The GoogleOther crawler stubs navigator.serviceWorker.register to reject
    // outright; WebKit rejects natively with `TypeError: Internal error`.
    const error = new Error("Rejected");
    mockRegister.mockRejectedValueOnce(error);

    const { container } = render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expectSwFailureLogged("registration", error);
    // The component renders nothing, but the tree must not have thrown.
    expect(container).toBeEmptyDOMElement();
  });

  it("handles a rejecting getRegistration() on mount", async () => {
    const error = new Error("Internal error");
    mockGetRegistration.mockRejectedValueOnce(error);

    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expectSwFailureLogged("getRegistration on mount", error);
  });

  it("handles a rejecting update() on the visibility check", async () => {
    const error = new Error("script fetch failed");
    mockUpdate.mockRejectedValueOnce(error);

    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    // Hide for long enough to arm the update check, then return.
    await act(async () => {
      fireVisibilityChange("hidden");
      vi.advanceTimersByTime(90_000);
      fireVisibilityChange("visible");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockUpdate).toHaveBeenCalled();
    expectSwFailureLogged("visibility update check", error);
  });

  it("handles a rejecting update() on the background interval", async () => {
    const error = new Error("script fetch failed");

    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    mockUpdate.mockRejectedValueOnce(error);

    await act(async () => {
      vi.advanceTimersByTime(60 * 60 * 1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expectSwFailureLogged("background update check", error);
  });

  it("handles a rejecting getRegistration() in the REQUEST_SKIP_WAITING path", async () => {
    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    // Arm the activator, then make the second getRegistration() reject.
    serwistListeners["waiting"]?.forEach((l) => l());
    const error = new Error("Internal error");
    mockGetRegistration.mockRejectedValueOnce(error);

    await act(async () => {
      fireVisibilityChange("hidden");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockMessageSW).not.toHaveBeenCalled();
    expectSwFailureLogged("REQUEST_SKIP_WAITING dispatch", error);
  });

  it("handles a rejecting messageSW() in the REQUEST_SKIP_WAITING path", async () => {
    const waitingWorker = {} as ServiceWorker;
    mockGetRegistration.mockResolvedValue({ waiting: waitingWorker } as unknown as {
      waiting: null;
    });

    render(<ServiceWorkerProvider />);
    await act(async () => {
      await Promise.resolve();
    });

    serwistListeners["waiting"]?.forEach((l) => l());
    const error = new Error("postMessage failed");
    mockMessageSW.mockRejectedValueOnce(error);

    await act(async () => {
      fireVisibilityChange("hidden");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockMessageSW).toHaveBeenCalled();
    expectSwFailureLogged("REQUEST_SKIP_WAITING dispatch", error);
  });

  it("lets no rejection escape to the process as an unhandled rejection", async () => {
    // The regression test for the two Sentry issues in #1913. Runs on real
    // timers so the rejection can settle across a genuine macrotask, which is
    // when Node decides a rejection went unhandled.
    vi.useRealTimers();

    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    try {
      mockRegister.mockRejectedValueOnce(new Error("Rejected"));
      mockGetRegistration.mockRejectedValueOnce(new Error("Internal error"));

      render(<ServiceWorkerProvider />);
      await act(async () => {
        await new Promise((resolve) => setImmediate(resolve));
      });

      expect(unhandled).not.toHaveBeenCalled();
      // Both rejections were routed through the catch handler, not dropped.
      expect(debugSpy).toHaveBeenCalledTimes(2);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
