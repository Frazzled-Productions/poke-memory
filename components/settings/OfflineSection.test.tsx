/**
 * Component tests for OfflineSection.
 *
 * The downloadController singleton is tested via its real module - we
 * mock precacheAll at the lib/pwa/precache level to avoid hitting the
 * real Cache API. We also test the remount-during-download scenario that
 * was the root cause of #1180.
 */

import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithIntl } from "@/components/test-utils/renderWithIntl";
import { OfflineSection } from "@/components/settings/OfflineSection";
import * as precacheModule from "@/lib/pwa/precache";
import { _resetForTesting } from "@/lib/pwa/downloadController";
import { computeManifestSignature } from "@/lib/pwa/manifestSignature";
import { KEY_OFFLINE_MANIFEST } from "@/lib/storage/keys";
import { SEED_POKEMON } from "@/lib/pokemon/seed";

// ------------------------------------------------------------------
// localStorage stub - jsdom does not always ship localStorage.
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
  // Reset the singleton before each test so tests don't bleed into each other.
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
    renderWithIntl(<OfflineSection />);
    expect(
      screen.getByRole("button", { name: /download/i }),
    ).toBeInTheDocument();
  });

  it("shows 'Update' button when a download timestamp exists in localStorage", () => {
    window.localStorage.setItem(
      precacheModule.OFFLINE_DOWNLOADED_AT_KEY,
      new Date().toISOString(),
    );
    renderWithIntl(<OfflineSection />);
    expect(screen.getByRole("button", { name: /update/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^download$/i }),
    ).not.toBeInTheDocument();
  });

  it("shows 'Update' synchronously on first render for a returning user (no flash)", () => {
    // Regression guard for Finding 1 on PR #1185: getState() must seed from
    // localStorage so useState(getState) already returns { phase: "done" } on
    // the very first synchronous render. The "Download" button must never be
    // committed to the DOM - not even as a transient state before effects run.
    //
    // In @testing-library/react, render() commits the initial tree
    // synchronously and then flushes effects. If getState() did NOT seed from
    // storage, the initial tree would contain "Download" and only flip to
    // "Update" after the subscribe() effect fired - a visible label flash for
    // real users. This test guards against that regression.
    window.localStorage.setItem(
      precacheModule.OFFLINE_DOWNLOADED_AT_KEY,
      "2026-05-01T10:00:00.000Z",
    );

    // Act without awaiting any async events - we are asserting the
    // synchronously committed initial render, not a state transition.
    const { container } = renderWithIntl(<OfflineSection />);

    // "Update" must be present in the committed tree.
    expect(screen.getByRole("button", { name: /update/i })).toBeInTheDocument();
    // "Download" must never appear - not even transiently.
    expect(container.querySelector("button")).toHaveTextContent(/update/i);
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
    renderWithIntl(<OfflineSection />);

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
    renderWithIntl(<OfflineSection />);

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
    renderWithIntl(<OfflineSection />);

    await user.click(screen.getByRole("button", { name: /download/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /stop/i }));

    // The controller was aborted.
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
    renderWithIntl(<OfflineSection />);

    await user.click(screen.getByRole("button", { name: /download/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
    // The error alert shows the actual error message from the thrown Error.
    expect(screen.getByRole("alert")).toHaveTextContent(/network error/i);
  });

  it("shows an error and does NOT write a timestamp when downloaded=0 and failed>0 (total failure)", async () => {
    // Simulates the caches API being unavailable: every URL counted as failed,
    // none downloaded. The component must transition to the error phase and must
    // NOT write a timestamp to localStorage (which would display "Downloaded on
    // <date>" - a false success).
    vi.spyOn(precacheModule, "precacheAll").mockResolvedValue({
      totalRequested: 100,
      downloaded: 0,
      skipped: 0,
      failed: 100,
    });

    const user = userEvent.setup();
    renderWithIntl(<OfflineSection />);

    await user.click(screen.getByRole("button", { name: /download/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );

    // Must surface the user-facing error message.
    expect(screen.getByRole("alert")).toHaveTextContent(/download failed/i);

    // Must NOT transition to "done" - no "Downloaded on" text, no Update button.
    expect(screen.queryByText(/downloaded on/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /update/i })).not.toBeInTheDocument();

    // Must NOT have written the timestamp to localStorage.
    expect(
      window.localStorage.getItem(precacheModule.OFFLINE_DOWNLOADED_AT_KEY),
    ).toBeNull();
  });

  // ── Manifest signal (#1539) ────────────────────────────────────────────────

  it("shows 'Up to date' when the persisted signature matches the current one", () => {
    // Compute the same signature OfflineSection would compute at module load.
    const ids = SEED_POKEMON.filter((p) => p.isDefaultForm).map((p) => p.id);
    const urls = precacheModule.buildPrecacheUrls(ids);
    const sig = computeManifestSignature(urls);

    window.localStorage.setItem(
      precacheModule.OFFLINE_DOWNLOADED_AT_KEY,
      "2026-06-01T10:00:00.000Z",
    );
    window.localStorage.setItem(
      KEY_OFFLINE_MANIFEST,
      JSON.stringify({ signature: sig, count: ids.length }),
    );

    renderWithIntl(<OfflineSection />);

    expect(screen.getByText(/up to date/i)).toBeInTheDocument();
    // Update button should be disabled when up to date.
    expect(screen.getByRole("button", { name: /update/i })).toBeDisabled();
  });

  it("shows 'Update available' when the persisted signature differs from current", () => {
    window.localStorage.setItem(
      precacheModule.OFFLINE_DOWNLOADED_AT_KEY,
      "2026-05-01T10:00:00.000Z",
    );
    // Store a stale signature (different from any real one).
    window.localStorage.setItem(
      KEY_OFFLINE_MANIFEST,
      JSON.stringify({ signature: "00000000", count: 100 }),
    );

    renderWithIntl(<OfflineSection />);

    // Should show update-available text (either with or without count).
    expect(screen.getByText(/update available/i)).toBeInTheDocument();
    // Update button should be enabled when an update is available.
    expect(screen.getByRole("button", { name: /update/i })).toBeEnabled();
  });

  it("shows 'Update available (N new)' when current count exceeds persisted count", () => {
    window.localStorage.setItem(
      precacheModule.OFFLINE_DOWNLOADED_AT_KEY,
      "2026-05-01T10:00:00.000Z",
    );
    window.localStorage.setItem(
      KEY_OFFLINE_MANIFEST,
      // A very small count (fewer species than the actual seed).
      JSON.stringify({ signature: "00000000", count: 50 }),
    );

    renderWithIntl(<OfflineSection />);

    // N new should be shown since current count > 50.
    // The exact number depends on the seed; just check the format.
    expect(screen.getByText(/update available.*new/i)).toBeInTheDocument();
  });

  it("disables the Update button and shows 'Up to date' - locale: ja", () => {
    const ids = SEED_POKEMON.filter((p) => p.isDefaultForm).map((p) => p.id);
    const urls = precacheModule.buildPrecacheUrls(ids);
    const sig = computeManifestSignature(urls);

    window.localStorage.setItem(
      precacheModule.OFFLINE_DOWNLOADED_AT_KEY,
      "2026-06-01T10:00:00.000Z",
    );
    window.localStorage.setItem(
      KEY_OFFLINE_MANIFEST,
      JSON.stringify({ signature: sig, count: ids.length }),
    );

    renderWithIntl(<OfflineSection />, { locale: "ja" });

    // Japanese locale: button should be disabled (up to date).
    expect(screen.getByRole("button", { name: /更新/i })).toBeDisabled();
  });

  it("enables the Update button when update available - locale: zh-Hans", () => {
    window.localStorage.setItem(
      precacheModule.OFFLINE_DOWNLOADED_AT_KEY,
      "2026-05-01T10:00:00.000Z",
    );
    window.localStorage.setItem(
      KEY_OFFLINE_MANIFEST,
      JSON.stringify({ signature: "00000000", count: 100 }),
    );

    renderWithIntl(<OfflineSection />, { locale: "zh-Hans" });

    // Chinese Simplified locale: button should be enabled (update available).
    expect(screen.getByRole("button", { name: /更新/i })).toBeEnabled();
  });

  it("remounting during an active download shows live progress without aborting", async () => {
    // This is the regression test for #1180: a client-side navigation that
    // unmounts and remounts OfflineSection must not abort the download.
    //
    // We simulate the scenario by:
    //  1. Rendering the component and starting a download.
    //  2. Unmounting (simulates navigation away).
    //  3. Remounting (simulates navigation back).
    //  4. Asserting the download is still running and the progress is live.

    let resolvePrecache!: (value: precacheModule.PrecacheSummary) => void;
    let reportProgress!: (p: precacheModule.PrecacheProgress) => void;

    vi.spyOn(precacheModule, "precacheAll").mockImplementation(
      ({ onProgress }) => {
        reportProgress = (p) => onProgress?.(p);
        return new Promise<precacheModule.PrecacheSummary>((resolve) => {
          resolvePrecache = resolve;
        });
      },
    );

    const user = userEvent.setup();
    const { unmount } = renderWithIntl(<OfflineSection />);

    // Start the download.
    await user.click(screen.getByRole("button", { name: /download/i }));

    // Report initial progress tick.
    act(() => {
      reportProgress({ done: 5, total: 100, bytesSoFar: 125_000 });
    });

    await waitFor(() =>
      expect(screen.getByRole("progressbar")).toBeInTheDocument(),
    );

    // Unmount (navigation away). This must NOT abort the download.
    unmount();

    // Advance progress while unmounted.
    act(() => {
      reportProgress({ done: 50, total: 100, bytesSoFar: 1_250_000 });
    });

    // Remount (navigation back).
    renderWithIntl(<OfflineSection />);

    // The remounted component must immediately show the in-progress state.
    await waitFor(() =>
      expect(screen.getByRole("progressbar")).toBeInTheDocument(),
    );
    // The Stop button must be present - the download is still running.
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();

    // Resolve the download so the test doesn't leak a pending promise.
    resolvePrecache({
      totalRequested: 100,
      downloaded: 100,
      skipped: 0,
      failed: 0,
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /update/i })).toBeInTheDocument(),
    );
  });
});
