"use client";

import { useEffect, useRef, useState } from "react";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import {
  precacheAll,
  OFFLINE_DOWNLOADED_AT_KEY,
  type PrecacheProgress,
  type PrecacheSummary,
} from "@/lib/pwa/precache";
import { cardPanelPadded } from "@/lib/utils/class-names";

/**
 * Species IDs eligible for offline caching — all default-form entries in the
 * seed. Computed once at module load since `SEED_POKEMON` is a static import;
 * this avoids re-running the filter+map on every render.
 */
const ALL_OFFLINE_IDS: number[] = SEED_POKEMON.filter((p) => p.isDefaultForm).map((p) => p.id);

type DownloadState =
  | { phase: "idle" }
  | { phase: "downloading"; progress: PrecacheProgress }
  | { phase: "done"; summary: PrecacheSummary; downloadedAt: string }
  | { phase: "error"; message: string };

/** Format bytes as MB, e.g. 47.3 MB */
function formatMb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Format an ISO timestamp as a short local date, e.g. "21 May 2026". */
function formatDate(isoString: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

/**
 * Read the last-downloaded timestamp from localStorage.
 * Returns null if not yet downloaded on this device.
 */
function readDownloadedAt(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(OFFLINE_DOWNLOADED_AT_KEY);
}

/**
 * Offline section for the Settings page.
 *
 * Lets the user pre-fetch every sprite and cry into the service-worker
 * caches so practice sessions work without a network connection.
 */
export function OfflineSection() {
  const [downloadState, setDownloadState] = useState<DownloadState>(() => {
    // Initialise synchronously from localStorage so the button label is
    // correct on first paint without a flash.
    const at = readDownloadedAt();
    if (at !== null) {
      return { phase: "done", summary: { totalRequested: 0, downloaded: 0, skipped: 0, failed: 0 }, downloadedAt: at };
    }
    return { phase: "idle" };
  });

  const [storageInfo, setStorageInfo] = useState<{ usedMb: string; totalMb: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Read storage estimate on mount.
  useEffect(() => {
    if (!("storage" in navigator) || !("estimate" in navigator.storage)) return;
    void navigator.storage.estimate().then((estimate) => {
      if (estimate.usage !== undefined && estimate.quota !== undefined) {
        setStorageInfo({
          usedMb: formatMb(estimate.usage),
          totalMb: formatMb(estimate.quota),
        });
      }
    });
  }, []);

  // Warn before navigating away during an active download.
  useEffect(() => {
    if (downloadState.phase !== "downloading") return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [downloadState.phase]);

  // Abort any in-flight download when the component unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function startDownload() {
    if (downloadState.phase === "downloading") return;

    const controller = new AbortController();
    abortRef.current = controller;

    setDownloadState({
      phase: "downloading",
      progress: { done: 0, total: 0, bytesSoFar: 0 },
    });

    try {
      const summary = await precacheAll({
        ids: ALL_OFFLINE_IDS,
        signal: controller.signal,
        onProgress: (progress) => {
          setDownloadState({ phase: "downloading", progress });
        },
      });

      if (controller.signal.aborted) {
        // User cancelled — return to idle so they can restart.
        setDownloadState({ phase: "idle" });
        return;
      }

      // Total failure guard: when nothing was downloaded and at least one URL
      // failed, the caches API is likely unavailable (e.g. non-HTTPS, blocked
      // by the browser, or a persistent network failure). Showing "Downloaded
      // on <date>" in this state would be a false success — transition to the
      // error phase instead and do NOT write the timestamp.
      if (summary.downloaded === 0 && summary.failed > 0) {
        setDownloadState({
          phase: "error",
          message: "Download failed. Check your connection and try again.",
        });
        return;
      }

      const downloadedAt = new Date().toISOString();
      try {
        window.localStorage.setItem(OFFLINE_DOWNLOADED_AT_KEY, downloadedAt);
      } catch {
        // localStorage unavailable — continue anyway.
      }

      setDownloadState({ phase: "done", summary, downloadedAt });

      // Refresh storage estimate after download.
      if ("storage" in navigator && "estimate" in navigator.storage) {
        void navigator.storage.estimate().then((estimate) => {
          if (estimate.usage !== undefined && estimate.quota !== undefined) {
            setStorageInfo({
              usedMb: formatMb(estimate.usage),
              totalMb: formatMb(estimate.quota),
            });
          }
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setDownloadState({ phase: "idle" });
        return;
      }
      setDownloadState({
        phase: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  function stopDownload() {
    abortRef.current?.abort();
    // Phase transitions to "idle" in startDownload once the abort propagates.
  }

  return (
    <div className={cardPanelPadded}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            Download for offline use
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Pre-fetches every sprite and cry so you can practise without a connection. Recommended on Wi-Fi. About 166 MB.
          </p>
          {storageInfo !== null && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Using {storageInfo.usedMb} of {storageInfo.totalMb} available.
            </p>
          )}
        </div>

        {/* Idle / done state */}
        {(downloadState.phase === "idle" || downloadState.phase === "done" || downloadState.phase === "error") && (
          <div className="flex flex-col gap-2">
            {downloadState.phase === "done" && (
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                Downloaded on {formatDate(downloadState.downloadedAt)}.
              </p>
            )}
            {downloadState.phase === "error" && (
              <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
                Download failed. Check your connection and try again.
              </p>
            )}
            <button
              type="button"
              onClick={() => void startDownload()}
              className="self-start min-h-[44px] rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
            >
              {downloadState.phase === "done" ? "Update" : "Download"}
            </button>
          </div>
        )}

        {/* Downloading state */}
        {downloadState.phase === "downloading" && (
          <div className="flex flex-col gap-3">
            <div>
              <p
                className="text-xs text-zinc-500 dark:text-zinc-400"
                aria-live="polite"
                aria-atomic="true"
              >
                Downloading {downloadState.progress.done.toLocaleString()} of{" "}
                {downloadState.progress.total.toLocaleString()}
                {downloadState.progress.bytesSoFar > 0 && (
                  <> ({formatMb(downloadState.progress.bytesSoFar)})</>
                )}
                ...
              </p>
              {downloadState.progress.total > 0 && (
                <div
                  role="progressbar"
                  aria-label="Download progress"
                  aria-valuenow={downloadState.progress.done}
                  aria-valuemin={0}
                  aria-valuemax={downloadState.progress.total}
                  className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
                >
                  <div
                    className="h-full rounded-full bg-foreground transition-all duration-150"
                    style={{
                      width: `${Math.round(
                        (downloadState.progress.done / downloadState.progress.total) * 100,
                      )}%`,
                    }}
                  />
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={stopDownload}
              className="self-start min-h-[44px] rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
            >
              Stop
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
