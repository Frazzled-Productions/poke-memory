"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { useSeed } from "@/lib/pokemon/SeedContext";
import {
  getState,
  subscribe,
  startDownload,
  stopDownload,
  resetToIdle,
  getCurrentManifest,
  type DownloadState,
} from "@/lib/pwa/downloadController";
import { CACHE_NAMES, versionedCacheName } from "@/lib/pwa/cacheStrategy";
import { OFFLINE_DOWNLOADED_AT_KEY } from "@/lib/pwa/precache";
import { KEY_OFFLINE_MANIFEST } from "@/lib/storage/keys";
import { cardPanelPadded, colStack, colStackLg, dialogPanel, mutedText, mutedTextXs } from "@/lib/utils/class-names";
import { formatGb, formatDownloadBytes } from "@/lib/utils/format-bytes";

/**
 * Offline section for the Settings page.
 *
 * Lets the user pre-fetch every sprite and cry into the service-worker
 * caches so practice sessions work without a network connection.
 *
 * The download controller lives in a module-level singleton
 * (`lib/pwa/downloadController.ts`) so in-PWA navigations that unmount this
 * component do NOT abort the download. On remount the component re-subscribes
 * and shows live progress from the surviving run.
 */
export function OfflineSection() {
  const t = useTranslations("settings.offline");
  const format = useFormatter();
  const { seed } = useSeed();
  // Initialise from the singleton synchronously. The subscribe() effect (below)
  // fires after mount and immediately calls setDownloadState with the current
  // singleton state, which may already be "downloading" if a download survived
  // an in-PWA navigation, or "done" if a previous download was completed.
  const [downloadState, setDownloadState] = useState<DownloadState>(getState);

  const [storageInfo, setStorageInfo] = useState<{ usedGb: string; totalGb: string } | null>(null);

  /** Ref to the native confirm-delete dialog element. */
  const deleteDialogRef = useRef<HTMLDialogElement>(null);

  /** Error message from a failed delete attempt, or null. */
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /**
   * Derive the update-available state from the persisted manifest vs. the
   * current one (#1539). Only meaningful in the "done" phase.
   *
   * - `null` - not applicable (not in done state)
   * - `{ isStale: false }` - downloaded signature matches current; up to date
   * - `{ isStale: true, newCount: number | null }` - signatures differ;
   *   `newCount` is the number of new species IDs when countable (may be null
   *   when the count is unchanged but the signature still differs, e.g. a
   *   sprite-width or cache-version bump - avoids a misleading "0 new").
   */
  const manifestStatus = useMemo<
    null | { isStale: false } | { isStale: true; newCount: number | null }
  >(() => {
    if (downloadState.phase !== "done") return null;
    const persisted = downloadState.manifest;
    const currentManifest = getCurrentManifest();
    if (persisted.signature === currentManifest.signature) return { isStale: false };
    // Signatures differ - compute how many new species IDs there are.
    const countDiff = currentManifest.count - persisted.count;
    const newCount = countDiff > 0 ? countDiff : null;
    return { isStale: true, newCount };
  }, [downloadState]);

  // Subscribe to the singleton on mount and unsubscribe on unmount.
  // The subscription re-emits the current state immediately, so the component
  // is always in sync even when remounting mid-download.
  useEffect(() => {
    return subscribe(setDownloadState);
  }, []);

  /** Read navigator.storage.estimate() and update storageInfo state. */
  function refreshStorageEstimate() {
    if (!("storage" in navigator) || !("estimate" in navigator.storage)) return;
    void navigator.storage.estimate().then((estimate) => {
      if (estimate.usage !== undefined && estimate.quota !== undefined) {
        setStorageInfo({
          usedGb: formatGb(estimate.usage),
          totalGb: formatGb(estimate.quota),
        });
      }
    });
  }

  // Read storage estimate on mount. Skip when the initial phase is already
  // "done" - the phase-change effect below fires in that case and makes the
  // same call, so the mount call would be a duplicate.
  useEffect(() => {
    if (downloadState.phase === "done") return;
    refreshStorageEstimate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentional mount-only

  // Warn before a full page unload during an active download.
  // Note: in-PWA navigations (client-side route changes) do NOT trigger
  // beforeunload, so this only guards against tab closes / hard refreshes.
  // The download itself survives in-PWA navigation via the singleton.
  useEffect(() => {
    if (downloadState.phase !== "downloading") return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [downloadState.phase]);

  // Poll storage estimate every 5 seconds while a download is in progress so
  // the "Using X of Y" readout stays current rather than freezing on the
  // mount-time snapshot. The interval is cleared on phase change or unmount.
  useEffect(() => {
    if (downloadState.phase !== "downloading") return;
    const id = setInterval(refreshStorageEstimate, 5_000);
    return () => clearInterval(id);
  }, [downloadState.phase]); // eslint-disable-line react-hooks/exhaustive-deps -- refreshStorageEstimate is stable

  // Refresh storage estimate after a completed download.
  useEffect(() => {
    if (downloadState.phase !== "done") return;
    refreshStorageEstimate();
  }, [downloadState.phase]); // eslint-disable-line react-hooks/exhaustive-deps -- refreshStorageEstimate is stable

  // Wire the native dialog's "cancel" event (fired on Escape) to close cleanly.
  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!dialog) return;
    function handleCancel(e: Event) {
      e.preventDefault();
      dialog!.close();
    }
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, []);

  function openDeleteDialog() {
    deleteDialogRef.current?.showModal();
  }

  function closeDeleteDialog() {
    deleteDialogRef.current?.close();
  }

  function handleDownload() {
    // Derive species IDs from the context-provided seed rather than a static import.
    const ids = seed ? seed.seedPokemon.filter((p) => p.isDefaultForm).map((p) => p.id) : [];
    void startDownload(ids);
  }

  /**
   * Delete all offline cache entries written by the precache orchestrator.
   *
   * Clears the versioned sprites and cries cache buckets (the same buckets
   * that `lib/pwa/precache.ts::fetchAndCache` writes to, derived from the
   * same `versionedCacheName` helper and `CACHE_NAMES` constants). This
   * avoids hardcoding a second copy of the cache-name strings.
   *
   * After deletion:
   *   - The download timestamp and manifest are cleared from localStorage so
   *     the controller returns to idle on next seed.
   *   - The download state singleton is reset to idle.
   *   - The storage estimate is refreshed so "Using X of Y" updates.
   */
  async function handleDeleteCache(): Promise<void> {
    closeDeleteDialog();
    setDeleteError(null);

    try {
      if ("caches" in window) {
        const spritesCacheName = versionedCacheName(CACHE_NAMES.sprites);
        const criesCacheName = versionedCacheName(CACHE_NAMES.cries);
        await Promise.all([
          caches.delete(spritesCacheName),
          caches.delete(criesCacheName),
        ]);
      }

      // Clear the persisted download metadata so the controller seeds "idle"
      // on next page load.
      try {
        localStorage.removeItem(OFFLINE_DOWNLOADED_AT_KEY);
        localStorage.removeItem(KEY_OFFLINE_MANIFEST);
      } catch {
        // localStorage unavailable - non-fatal.
      }

      // Reset the singleton to idle via the public API so all subscribers
      // (any other mounted OfflineSection instances, future listeners) see
      // the cleared state immediately without waiting for a page reload.
      // resetToIdle() also clears the storageSeedDone guard so a subsequent
      // subscribe/getState call re-checks localStorage (which is now empty)
      // and stays idle rather than re-seeding "done" from stale memory.
      resetToIdle();
      refreshStorageEstimate();
    } catch {
      setDeleteError(t("deleteErrorMessage"));
    }
  }

  return (
    <div className={cardPanelPadded}>
      <div className={colStackLg}>
        <div>
          <p className="text-sm font-medium text-foreground">
            {t("downloadTitle")}
          </p>
          <p className={`mt-1 ${mutedTextXs}`}>
            {t("downloadDescription")}
          </p>
          {storageInfo !== null && (
            <p className={`mt-1 ${mutedTextXs}`}>
              {t("storageUsage", { usedGb: storageInfo.usedGb, totalGb: storageInfo.totalGb })}
            </p>
          )}
        </div>

        {/* Idle / done state */}
        {(downloadState.phase === "idle" || downloadState.phase === "done" || downloadState.phase === "error") && (
          <div className={colStack}>
            {downloadState.phase === "done" && (
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {t("downloadedOn", {
                  date: format.dateTime(new Date(downloadState.downloadedAt), {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  }),
                })}
                {manifestStatus !== null && (
                  <>
                    {" · "}
                    {manifestStatus.isStale ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        {manifestStatus.newCount !== null
                          ? t("updateAvailableCount", { count: manifestStatus.newCount })
                          : t("updateAvailable")}
                      </span>
                    ) : (
                      t("upToDate")
                    )}
                  </>
                )}
              </p>
            )}
            {downloadState.phase === "error" && (
              <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
                {downloadState.message}
              </p>
            )}
            {deleteError !== null && (
              <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
                {deleteError}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleDownload}
                disabled={manifestStatus !== null && !manifestStatus.isStale}
                aria-disabled={manifestStatus !== null && !manifestStatus.isStale}
                className="self-start min-h-[44px] rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700"
              >
                {downloadState.phase === "done" ? t("updateButton") : t("downloadButton")}
              </button>
              {downloadState.phase === "done" && (
                <button
                  type="button"
                  onClick={openDeleteDialog}
                  className="self-start min-h-[44px] rounded-lg border border-red-300 bg-background px-5 py-2 text-sm font-semibold text-red-600 transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:border-red-800 dark:text-red-400"
                >
                  {t("deleteButton")}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Downloading state */}
        {downloadState.phase === "downloading" && (
          <div className="flex flex-col gap-3">
            <div>
              <p
                className={mutedTextXs}
                aria-live="polite"
                aria-atomic="true"
              >
                {t("downloadingProgress", {
                  done: format.number(downloadState.progress.done),
                  total: format.number(downloadState.progress.total),
                })}
                {downloadState.progress.bytesSoFar > 0 && (
                  // bytesSoFar is the download's own bytes (sum of Content-Length
                  // header values, or blob-size fallback) - NOT navigator.storage.estimate().usage.
                  // The storage estimate above reflects all origin data; these two figures
                  // measure different things. formatDownloadBytes shows MB-scale progress.
                  <> ({formatDownloadBytes(downloadState.progress.bytesSoFar)} {t("downloadBytesLabel")})</>
                )}
                ...
              </p>
              {downloadState.progress.total > 0 && (
                <div
                  role="progressbar"
                  aria-label={t("downloadProgressAriaLabel")}
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
              {t("stopButton")}
            </button>
          </div>
        )}
      </div>

      {/* Delete confirm dialog - native <dialog> gives focus-trap, Escape, and backdrop for free. */}
      <dialog
        ref={deleteDialogRef}
        aria-labelledby="delete-cache-dialog-title"
        className={dialogPanel}
      >
        <h2
          id="delete-cache-dialog-title"
          className="text-base font-semibold text-foreground"
        >
          {t("deleteConfirmTitle")}
        </h2>
        <p className={`mt-2 ${mutedText}`}>
          {storageInfo !== null
            ? t("deleteConfirmBody", { size: storageInfo.usedGb })
            : t("deleteConfirmBodyNoSize")}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={closeDeleteDialog}
            className="min-h-[44px] rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
          >
            {t("deleteConfirmCancel")}
          </button>
          <button
            type="button"
            onClick={() => { void handleDeleteCache(); }}
            className="min-h-[44px] rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            {t("deleteConfirmConfirm")}
          </button>
        </div>
      </dialog>
    </div>
  );
}
