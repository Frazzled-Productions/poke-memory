/**
 * Unit tests for the lib/pwa/downloadController module.
 *
 * Lives under components/ so the jsdom vitest project picks it up - the
 * controller writes to window.localStorage which requires a DOM environment.
 * Per AGENTS.md: "A React hook can live in lib/, but if its test calls
 * renderHook, the test file must live under components/". The same reasoning
 * applies to any module that touches browser globals.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as precacheModule from "@/lib/pwa/precache";
import {
  getState,
  subscribe,
  startDownload,
  stopDownload,
  _resetForTesting,
} from "@/lib/pwa/downloadController";

// ------------------------------------------------------------------
// localStorage stub
// ------------------------------------------------------------------
function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { store.set(k, String(v)); },
  };
}

beforeEach(() => {
  _resetForTesting();
  Object.defineProperty(window, "localStorage", {
    value: makeLocalStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetForTesting();
  delete (window as unknown as { localStorage?: unknown }).localStorage;
});

describe("downloadController", () => {
  describe("getState / initial state", () => {
    it("starts in the idle phase", () => {
      expect(getState()).toEqual({ phase: "idle" });
    });

    it("returns { phase: 'done' } on first call when localStorage holds a prior-download timestamp", () => {
      // Regression guard for Finding 1 on PR #1185: getState() must seed from
      // localStorage so useState(getState) in OfflineSection already reflects a
      // returning user's prior download on the very first render - no flash.
      window.localStorage.setItem(
        precacheModule.OFFLINE_DOWNLOADED_AT_KEY,
        "2026-05-01T10:00:00.000Z",
      );

      const state = getState();

      expect(state.phase).toBe("done");
      if (state.phase === "done") {
        expect(state.downloadedAt).toBe("2026-05-01T10:00:00.000Z");
      }
    });

    it("returns idle when localStorage has no prior-download timestamp", () => {
      // Ensure getState() does not produce a false "done" when storage is empty.
      const state = getState();
      expect(state.phase).toBe("idle");
    });
  });

  describe("subscribe", () => {
    it("calls the listener immediately with the current state", () => {
      const listener = vi.fn();
      const unsub = subscribe(listener);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({ phase: "idle" });
      unsub();
    });

    it("notifies subscribers on state transitions", async () => {
      vi.spyOn(precacheModule, "precacheAll").mockResolvedValue({
        totalRequested: 1,
        downloaded: 1,
        skipped: 0,
        failed: 0,
      });

      const states: string[] = [];
      const unsub = subscribe((s) => states.push(s.phase));

      await startDownload([1]);
      unsub();

      // Should have transitioned: idle → downloading → done.
      expect(states).toContain("idle");
      expect(states).toContain("downloading");
      expect(states).toContain("done");
    });

    it("stops notifying after unsubscribe", async () => {
      vi.spyOn(precacheModule, "precacheAll").mockResolvedValue({
        totalRequested: 1,
        downloaded: 1,
        skipped: 0,
        failed: 0,
      });

      const listener = vi.fn();
      const unsub = subscribe(listener);
      unsub(); // immediately unsubscribe

      const callCountAfterUnsub = listener.mock.calls.length;
      await startDownload([1]);

      // No extra calls after unsubscribe.
      expect(listener.mock.calls.length).toBe(callCountAfterUnsub);
    });

    it("supports multiple concurrent subscribers", async () => {
      vi.spyOn(precacheModule, "precacheAll").mockResolvedValue({
        totalRequested: 1,
        downloaded: 1,
        skipped: 0,
        failed: 0,
      });

      const a = vi.fn();
      const b = vi.fn();
      const unsubA = subscribe(a);
      const unsubB = subscribe(b);

      await startDownload([1]);
      unsubA();
      unsubB();

      // Both should have received the "done" phase.
      const aPhases = a.mock.calls.map((c) => (c[0] as { phase: string }).phase);
      const bPhases = b.mock.calls.map((c) => (c[0] as { phase: string }).phase);
      expect(aPhases).toContain("done");
      expect(bPhases).toContain("done");
    });
  });

  describe("startDownload", () => {
    it("transitions to downloading then done on success", async () => {
      vi.spyOn(precacheModule, "precacheAll").mockResolvedValue({
        totalRequested: 5,
        downloaded: 5,
        skipped: 0,
        failed: 0,
      });

      await startDownload([1]);

      const state = getState();
      expect(state.phase).toBe("done");
    });

    it("writes the timestamp to localStorage on success", async () => {
      vi.spyOn(precacheModule, "precacheAll").mockResolvedValue({
        totalRequested: 5,
        downloaded: 5,
        skipped: 0,
        failed: 0,
      });

      await startDownload([1]);

      expect(
        window.localStorage.getItem(precacheModule.OFFLINE_DOWNLOADED_AT_KEY),
      ).not.toBeNull();
    });

    it("does NOT write a timestamp when downloaded=0 and failed>0", async () => {
      vi.spyOn(precacheModule, "precacheAll").mockResolvedValue({
        totalRequested: 5,
        downloaded: 0,
        skipped: 0,
        failed: 5,
      });

      await startDownload([1]);

      expect(getState().phase).toBe("error");
      expect(
        window.localStorage.getItem(precacheModule.OFFLINE_DOWNLOADED_AT_KEY),
      ).toBeNull();
    });

    it("transitions to error on a thrown non-abort error and preserves the message", async () => {
      vi.spyOn(precacheModule, "precacheAll").mockRejectedValue(
        new Error("Network error"),
      );

      await startDownload([1]);

      const state = getState();
      expect(state.phase).toBe("error");
      if (state.phase === "error") {
        expect(state.message).toBe("Network error");
      }
    });

    it("is a no-op when a download is already in progress", async () => {
      let resolvePrecache!: (v: precacheModule.PrecacheSummary) => void;
      const spy = vi.spyOn(precacheModule, "precacheAll").mockImplementation(
        () =>
          new Promise<precacheModule.PrecacheSummary>((resolve) => {
            resolvePrecache = resolve;
          }),
      );

      // Start but do not await.
      const first = startDownload([1]);
      const second = startDownload([1]);

      // Resolve so tests don't leak.
      resolvePrecache({ totalRequested: 1, downloaded: 1, skipped: 0, failed: 0 });
      await Promise.all([first, second]);

      // precacheAll should only have been called once.
      expect(spy).toHaveBeenCalledOnce();
    });

    it("reports progress to subscribers via onProgress callback", async () => {
      vi.spyOn(precacheModule, "precacheAll").mockImplementation(
        ({ onProgress }) => {
          onProgress?.({ done: 1, total: 10, bytesSoFar: 25_000 });
          onProgress?.({ done: 5, total: 10, bytesSoFar: 125_000 });
          return Promise.resolve({
            totalRequested: 10,
            downloaded: 10,
            skipped: 0,
            failed: 0,
          });
        },
      );

      const progressSnapshots: number[] = [];
      const unsub = subscribe((s) => {
        if (s.phase === "downloading") {
          progressSnapshots.push(s.progress.done);
        }
      });

      await startDownload([1]);
      unsub();

      expect(progressSnapshots).toContain(1);
      expect(progressSnapshots).toContain(5);
    });
  });

  describe("stopDownload", () => {
    it("transitions back to idle after an explicit stop", async () => {
      let resolveOnAbort!: () => void;

      vi.spyOn(precacheModule, "precacheAll").mockImplementation(
        ({ signal }) => {
          return new Promise<precacheModule.PrecacheSummary>((resolve) => {
            resolveOnAbort = () =>
              resolve({ totalRequested: 0, downloaded: 0, skipped: 0, failed: 0 });
            signal?.addEventListener("abort", resolveOnAbort);
          });
        },
      );

      const downloadPromise = startDownload([1]);
      // Give the async chain a tick to enter the downloading state.
      await Promise.resolve();

      stopDownload();
      resolveOnAbort();
      await downloadPromise;

      expect(getState().phase).toBe("idle");
    });

    it("is safe to call when no download is in progress", () => {
      // Must not throw.
      expect(() => stopDownload()).not.toThrow();
    });
  });
});
