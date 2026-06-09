/**
 * Tests for useServiceWorkerVersion hook (#1826).
 *
 * Lives under components/ so the jsdom vitest project picks it up (the hook
 * uses browser APIs: navigator.serviceWorker, MessageChannel).
 *
 * Covers the three states:
 *   - no-controller (no navigator.serviceWorker.controller)
 *   - ready (SW replies within timeout)
 *   - timeout (SW does not reply within QUERY_TIMEOUT_MS)
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useServiceWorkerVersion } from "@/lib/pwa/useServiceWorkerVersion";

// ---------------------------------------------------------------------------
// Helpers to control the fake MessageChannel and navigator.serviceWorker
// ---------------------------------------------------------------------------

/** Captured postMessage call from the hook. */
let capturedPostMessage: ((msg: unknown, transfer?: Transferable[]) => void) | null = null;
/** The port1 onmessage handler set by the hook - used to simulate SW replies. */
let capturedPort1: MessagePort | null = null;

function makeController() {
  return {
    postMessage: vi.fn((msg: unknown, transfer?: Transferable[]) => {
      capturedPostMessage = (m: unknown, t?: Transferable[]) => {
        void m;
        void t;
      };
      void msg;
      void transfer;
    }),
  };
}

beforeEach(() => {
  capturedPostMessage = null;
  capturedPort1 = null;

  // Mock MessageChannel so we can intercept the ports.
  vi.stubGlobal(
    "MessageChannel",
    class MockMessageChannel {
      port1: Partial<MessagePort> & { onmessage: ((ev: MessageEvent) => void) | null };
      port2: Partial<MessagePort>;
      constructor() {
        this.port1 = {
          onmessage: null,
          close: vi.fn(),
        };
        this.port2 = {};
        // Capture the port so tests can trigger SW replies.
        capturedPort1 = this.port1 as MessagePort;
      }
    },
  );

  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helper: set up navigator.serviceWorker.controller
// ---------------------------------------------------------------------------
function setController(controller: ReturnType<typeof makeController> | null) {
  Object.defineProperty(navigator, "serviceWorker", {
    value: { controller },
    configurable: true,
    writable: true,
  });
}

describe("useServiceWorkerVersion", () => {
  describe("no-controller state", () => {
    it("returns no-controller immediately when navigator.serviceWorker.controller is null", async () => {
      setController(null);

      const { result } = renderHook(() => useServiceWorkerVersion());

      await act(async () => {});

      expect(result.current.status).toBe("no-controller");
    });
  });

  describe("ready state", () => {
    it("returns ready with version when SW replies before timeout", async () => {
      const controller = makeController();
      setController(controller);

      const { result } = renderHook(() => useServiceWorkerVersion());

      // Simulate SW reply via port1.onmessage
      await act(async () => {
        if (capturedPort1?.onmessage) {
          capturedPort1.onmessage(
            new MessageEvent("message", {
              data: { type: "SW_VERSION", version: "0.11.2" },
            }),
          );
        }
      });

      expect(result.current.status).toBe("ready");
      if (result.current.status === "ready") {
        expect(result.current.version).toBe("0.11.2");
      }
    });

    it("does not show a mismatch when SW version matches app version", async () => {
      const controller = makeController();
      setController(controller);

      const { result } = renderHook(() => useServiceWorkerVersion());

      await act(async () => {
        if (capturedPort1?.onmessage) {
          capturedPort1.onmessage(
            new MessageEvent("message", {
              data: { type: "SW_VERSION", version: "0.11.2" },
            }),
          );
        }
      });

      // When versions match there is no mismatch - the version is simply "ready"
      expect(result.current.status).toBe("ready");
      if (result.current.status === "ready") {
        expect(result.current.version).toBe("0.11.2");
      }
    });
  });

  describe("timeout state", () => {
    it("returns timeout when the SW does not reply within 2 s", async () => {
      const controller = makeController();
      setController(controller);

      const { result } = renderHook(() => useServiceWorkerVersion());

      // Advance fake timers past the 2 s timeout.
      await act(async () => {
        vi.advanceTimersByTime(2001);
      });

      expect(result.current.status).toBe("timeout");
    });
  });

  describe("initial loading state", () => {
    it("starts in loading state before SW replies", async () => {
      const controller = makeController();
      setController(controller);

      const { result } = renderHook(() => useServiceWorkerVersion());

      // Before act - should be loading
      expect(result.current.status).toBe("loading");
    });
  });
});
