/**
 * Component tests for OfflineSection.
 *
 * The precacheAll function is mocked so tests do not hit the real Cache API.
 * localStorage is stubbed manually because jsdom does not always ship it.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OfflineSection } from "@/components/settings/OfflineSection";
import * as precacheModule from "@/lib/pwa/precache";

// ------------------------------------------------------------------
// localStorage stub — jsdom does not always ship localStorage.
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
  Object.defineProperty(window, "localStorage", {
    value: makeLocalStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { localStorage?: unknown }).localStorage;
});

// ------------------------------------------------------------------
// Stub navigator.storage.estimate so the component does not call
// the real API (unavailable in jsdom).
// ------------------------------------------------------------------
const estimateMock = vi.fn().mockResolvedValue({
  usage: 50_000_000,
  quota: 2_000_000_000,
});

Object.defineProperty(navigator, "storage", {
  value: { estimate: estimateMock },
  writable: true,
  configurable: true,
});

describe("OfflineSection", () => {
  it("renders the Download button in the idle state", () => {
    render(<OfflineSection />);
    expect(
      screen.getByRole("button", { name: /download/i }),
    ).toBeInTheDocument();
  });

  it("shows 'Update' button when a download timestamp exists in localStorage", () => {
    window.localStorage.setItem(
      precacheModule.OFFLINE_DOWNLOADED_AT_KEY,
      new Date().toISOString(),
    );
    render(<OfflineSection />);
    expect(screen.getByRole("button", { name: /update/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^download$/i }),
    ).not.toBeInTheDocument();
  });

  it("shows progress and a Stop button while downloading", async () => {
    // Delay precacheAll so we can assert the in-progress state.
    let resolvePrecache!: (value: precacheModule.PrecacheSummary) => void;
    vi.spyOn(precacheModule, "precacheAll").mockImplementation(
      ({ onProgress }) => {
        // Report one tick of progress so the UI transitions.
        onProgress?.({ done: 1, total: 100, bytesSoFar: 25_000 });
        return new Promise<precacheModule.PrecacheSummary>((resolve) => {
          resolvePrecache = resolve;
        });
      },
    );

    const user = userEvent.setup();
    render(<OfflineSection />);

    await user.click(screen.getByRole("button", { name: /download/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    // Resolve so the test does not leak a pending promise.
    resolvePrecache({
      totalRequested: 100,
      downloaded: 99,
      skipped: 0,
      failed: 1,
    });

    // Wait for the async chain to settle.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /stop/i })).not.toBeInTheDocument(),
    );
  });

  it("shows 'Downloaded on' status and an Update button after completion", async () => {
    vi.spyOn(precacheModule, "precacheAll").mockResolvedValue({
      totalRequested: 10,
      downloaded: 10,
      skipped: 0,
      failed: 0,
    });

    const user = userEvent.setup();
    render(<OfflineSection />);

    await user.click(screen.getByRole("button", { name: /download/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /update/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/downloaded on/i)).toBeInTheDocument();
  });

  it("returns to idle when Stop is clicked", async () => {
    let abortCalled = false;
    let completeDownload!: () => void;

    vi.spyOn(precacheModule, "precacheAll").mockImplementation(
      ({ onProgress, signal }) => {
        onProgress?.({ done: 0, total: 100, bytesSoFar: 0 });
        signal?.addEventListener("abort", () => {
          abortCalled = true;
          completeDownload();
        });
        return new Promise<precacheModule.PrecacheSummary>((resolve) => {
          completeDownload = () =>
            resolve({
              totalRequested: 100,
              downloaded: 0,
              skipped: 0,
              failed: 0,
            });
        });
      },
    );

    const user = userEvent.setup();
    render(<OfflineSection />);

    await user.click(screen.getByRole("button", { name: /download/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /stop/i }));

    // The component calls abort on the controller.
    expect(abortCalled).toBe(true);

    // After abort resolves the component returns to idle.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /download/i })).toBeInTheDocument(),
    );
  });

  it("shows an error message when precacheAll throws a non-abort error", async () => {
    vi.spyOn(precacheModule, "precacheAll").mockRejectedValue(
      new Error("Network error"),
    );

    const user = userEvent.setup();
    render(<OfflineSection />);

    await user.click(screen.getByRole("button", { name: /download/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/download failed/i);
  });

  it("shows an error and does NOT write a timestamp when downloaded=0 and failed>0 (total failure)", async () => {
    // Simulates the caches API being unavailable: every URL counted as failed,
    // none downloaded. The component must transition to the error phase and must
    // NOT write a timestamp to localStorage (which would display "Downloaded on
    // <date>" — a false success).
    vi.spyOn(precacheModule, "precacheAll").mockResolvedValue({
      totalRequested: 100,
      downloaded: 0,
      skipped: 0,
      failed: 100,
    });

    const user = userEvent.setup();
    render(<OfflineSection />);

    await user.click(screen.getByRole("button", { name: /download/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );

    // Must surface the user-facing error message.
    expect(screen.getByRole("alert")).toHaveTextContent(/download failed/i);

    // Must NOT transition to "done" — no "Downloaded on" text, no Update button.
    expect(screen.queryByText(/downloaded on/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /update/i })).not.toBeInTheDocument();

    // Must NOT have written the timestamp to localStorage.
    expect(
      window.localStorage.getItem(precacheModule.OFFLINE_DOWNLOADED_AT_KEY),
    ).toBeNull();
  });
});
