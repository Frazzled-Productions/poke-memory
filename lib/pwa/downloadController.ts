/**
 * Module-level singleton for the offline download controller.
 *
 * Lifting the AbortController and progress state out of the OfflineSection
 * component into this module means an in-PWA client-side navigation
 * (which unmounts and remounts the Settings subtree) does NOT abort the
 * download. OfflineSection subscribes on mount and unsubscribes on unmount;
 * the download itself keeps running.
 *
 * Cross-layer note: this file lives in lib/pwa/ (data-coder territory) but
 * is added here by ui-coder as part of the #1180 fix per the AGENTS.md
 * "Cross-layer fixes" carve-out. The root cause is a state-lifecycle bug
 * whose cleanest fix is a shared module outside the component tree.
 *
 * Public API:
 *   startDownload(ids)  — begins a precacheAll run; no-op if one is already
 *                         in progress.
 *   stopDownload()      — explicitly aborts the active run.
 *   subscribe(listener) — registers a DownloadState listener; returns an
 *                         unsubscribe function. Immediately calls the listener
 *                         with the current state.
 *   getState()          — returns the current DownloadState synchronously,
 *                         seeding from localStorage on first call so that
 *                         useState(getState) reflects a prior download on the
 *                         very first render.
 */

import { precacheAll, OFFLINE_DOWNLOADED_AT_KEY, buildPrecacheUrls, type PrecacheProgress, type PrecacheSummary } from "./precache";
import { computeManifestSignature, parseOfflineManifest, type OfflineManifest } from "./manifestSignature";
import { readLocalStorage } from "@/lib/storage/readLocalStorage";
import { writeLocalStorageRaw } from "@/lib/storage/writeLocalStorage";
import { KEY_OFFLINE_MANIFEST } from "@/lib/storage/keys";
import { SEED_POKEMON } from "@/lib/pokemon/seed";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export type DownloadState =
  | { phase: "idle" }
  | { phase: "downloading"; progress: PrecacheProgress }
  | { phase: "done"; summary: PrecacheSummary; downloadedAt: string; manifest: OfflineManifest }
  | { phase: "error"; message: string };

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

let currentState: DownloadState = { phase: "idle" };
let abortController: AbortController | null = null;
const listeners = new Set<(state: DownloadState) => void>();
/** Set to true once seedFromStorage() has run (triggered by getState() or subscribe()). */
let storageSeedDone = false;

function setState(next: DownloadState): void {
  currentState = next;
  for (const listener of listeners) {
    listener(next);
  }
}

/**
 * Lazily seed the singleton from localStorage on first access.
 *
 * Called by both getState() and subscribe() so the first caller — whether
 * the useState initialiser or the subscribe effect — gets correct state.
 *
 * The module may be imported in a server context (during SSR) where
 * `window` / `localStorage` are unavailable; the typeof guard ensures it
 * no-ops safely. Runs at most once per page load.
 *
 * Only mutates currentState when the phase is still "idle" — an active or
 * completed download from this session takes precedence.
 */
function seedFromStorage(): void {
  if (storageSeedDone) return;
  storageSeedDone = true;

  if (currentState.phase !== "idle") return;

  // The stored value is a raw ISO timestamp string (not JSON-encoded), so we
  // pass it through without JSON.parse. SSR returns null (window undefined).
  const at = readLocalStorage(OFFLINE_DOWNLOADED_AT_KEY, (raw) => raw, null);
  if (at !== null) {
    // Read the persisted manifest (may be absent for downloads predating #1539).
    const rawManifest = readLocalStorage(KEY_OFFLINE_MANIFEST, (raw) => raw, null);
    const manifest = parseOfflineManifest(rawManifest) ?? CURRENT_MANIFEST;
    currentState = {
      phase: "done",
      summary: { totalRequested: 0, downloaded: 0, skipped: 0, failed: 0 },
      downloadedAt: at,
      manifest,
    };
  }
}

/**
 * The manifest for the current asset set — computed once at module load.
 * Used as a fallback when a download timestamp exists but no persisted manifest
 * (e.g. a download predating #1539), and written to storage after each new
 * download. Exported so `OfflineSection` can compare without recomputing.
 */
const _currentOfflineIds = SEED_POKEMON.filter((p) => p.isDefaultForm).map((p) => p.id);
export const CURRENT_MANIFEST: OfflineManifest = {
  signature: computeManifestSignature(buildPrecacheUrls(_currentOfflineIds)),
  count: _currentOfflineIds.length,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the current download state synchronously, seeding from localStorage
 * on the first call so that a returning user's prior-download timestamp is
 * reflected on the very first render — no "Download" → "Update" flash.
 *
 * Safe to use as a React `useState` initialiser:
 *   const [state, setState] = useState(getState);
 *
 * SSR note: `seedFromStorage` short-circuits when `window` is unavailable, so
 * the server always returns `{ phase: "idle" }`. The client's `useState`
 * initialiser runs after React has committed the server HTML and will return
 * the localStorage-seeded value. This is the same pattern used by the pre-PR
 * version of OfflineSection.tsx and is safe for a `"use client"` component.
 */
export function getState(): DownloadState {
  seedFromStorage();
  return currentState;
}

/**
 * Subscribe to state changes. The listener is called immediately with
 * the current state, and again on every subsequent transition.
 *
 * Also calls seedFromStorage() (idempotent) so that a completed download
 * from a previous page load is reflected even if the subscribe effect
 * fires before getState() has been called.
 *
 * Returns an unsubscribe function that removes the listener.
 */
export function subscribe(listener: (state: DownloadState) => void): () => void {
  seedFromStorage();
  listeners.add(listener);
  listener(currentState); // immediate snapshot
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Start the download if one is not already in progress.
 *
 * @param ids         - Species IDs to pre-cache.
 */
export async function startDownload(ids: number[]): Promise<void> {
  if (currentState.phase === "downloading") return;

  const controller = new AbortController();
  abortController = controller;

  setState({
    phase: "downloading",
    progress: { done: 0, total: 0, bytesSoFar: 0 },
  });

  try {
    const summary = await precacheAll({
      ids,
      signal: controller.signal,
      onProgress: (progress: PrecacheProgress) => {
        // Guard: a stopDownload() call may have raced with this callback.
        if (controller.signal.aborted) return;
        setState({ phase: "downloading", progress });
      },
    });

    if (controller.signal.aborted) {
      // Explicit user abort — return to idle so they can restart.
      setState({ phase: "idle" });
      abortController = null;
      return;
    }

    // Total-failure guard: nothing downloaded and at least one failure means
    // the Cache API is likely unavailable. Do NOT write the timestamp.
    if (summary.downloaded === 0 && summary.failed > 0) {
      setState({
        phase: "error",
        message: "Download failed. Check your connection and try again.",
      });
      abortController = null;
      return;
    }

    const downloadedAt = new Date().toISOString();
    // writeLocalStorageRaw swallows errors — download result is recorded
    // best-effort; the UI still transitions to "done" even if storage fails.
    writeLocalStorageRaw(OFFLINE_DOWNLOADED_AT_KEY, downloadedAt);

    // Persist the manifest signature alongside the timestamp (#1539).
    try {
      writeLocalStorageRaw(KEY_OFFLINE_MANIFEST, JSON.stringify(CURRENT_MANIFEST));
    } catch {
      // Best-effort; non-fatal if localStorage is full.
    }

    setState({ phase: "done", summary, downloadedAt, manifest: CURRENT_MANIFEST });
    abortController = null;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      setState({ phase: "idle" });
      abortController = null;
      return;
    }
    setState({
      phase: "error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
    abortController = null;
  }
}

/**
 * Explicitly abort an in-progress download.
 * The state will transition to "idle" once the abort propagates through
 * the precacheAll loop.
 */
export function stopDownload(): void {
  abortController?.abort();
}

/**
 * Reset the controller state back to idle.
 * Used in tests to clear singleton state between test cases.
 * Do NOT call from production code.
 *
 * @internal
 */
export function _resetForTesting(): void {
  abortController?.abort();
  abortController = null;
  listeners.clear();
  currentState = { phase: "idle" };
  storageSeedDone = false;
}
