"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import {
  getState,
  subscribe,
  startDownload,
  stopDownload,
  CURRENT_MANIFEST,
  type DownloadState,
} from "@/lib/pwa/downloadController";
import { cardPanelPadded, colStack, colStackLg, mutedTextXs } from "@/lib/utils/class-names";

/**
 * Species IDs eligible for offline caching - all default-form entries in the
 * seed. Computed once at module load since `SEED_POKEMON` is a static import;
 * this avoids re-running the filter+map on every render.
 */
const ALL_OFFLINE_IDS: number[] = SEED_POKEMON.filter((p) => p.isDefaultForm).map((p) => p.id);

/** Format bytes as MB, e.g. 47.3 MB */
function formatMb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

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
  // Initialise from the singleton synchronously. The subscribe() effect (below)
  // fires after mount and immediately calls setDownloadState with the current
  // singleton state, which may already be "downloading" if a download survived
  // an in-PWA navigation, or "done" if a previous download was completed.
  const [downloadState, setDownloadState] = useState<DownloadState>(getState);

  const [storageInfo, setStorageInfo] = useState<{ usedMb: string; totalMb: string } | null>(null);

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
    if (persisted.signature === CURRENT_MANIFEST.signature) return { isStale: false };
    // Signatures differ - compute how many new species IDs there are.
    const countDiff = CURRENT_MANIFEST.count - persisted.count;
    const newCount = countDiff > 0 ? countDiff : null;
    return { isStale: true, newCount };
  }, [downloadState]);

  // Subscribe to the singleton on mount and unsubscribe on unmount.
  // The subscription re-emits the current state immediately, so the component
  // is always in sync even when remounting mid-download.
  useEffect(() => {
    return subscribe(setDownloadState);
  }, []);

  // Read storage estimate on mount. Skip when the initial phase is already
  // "done" - the phase-change effect below fires in that case and makes the
  // same call, so the mount call would be a duplicate.
  useEffect(() => {
    if (downloadState.phase === "done") return;
    if (!("storage" in navigator) || !("estimate" in navigator.storage)) return;
    void navigator.storage.estimate().then((estimate) => {
      if (estimate.usage !== undefined && estimate.quota !== undefined) {
        setStorageInfo({
          usedMb: formatMb(estimate.usage),
          totalMb: formatMb(estimate.quota),
        });
      }
    });
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

  // Refresh storage estimate after a completed download.
  useEffect(() => {
    if (downloadState.phase !== "done") return;
    if (!("storage" in navigator) || !("estimate" in navigator.storage)) return;
    void navigator.storage.estimate().then((estimate) => {
      if (estimate.usage !== undefined && estimate.quota !== undefined) {
        setStorageInfo({
          usedMb: formatMb(estimate.usage),
          totalMb: formatMb(estimate.quota),
        });
      }
    });
  }, [downloadState.phase]);

  function handleDownload() {
    void startDownload(ALL_OFFLINE_IDS);
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
              {t("storageUsage", { usedMb: storageInfo.usedMb, totalMb: storageInfo.totalMb })}
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
            <button
              type="button"
              onClick={handleDownload}
              disabled={manifestStatus !== null && !manifestStatus.isStale}
              aria-disabled={manifestStatus !== null && !manifestStatus.isStale}
              className="self-start min-h-[44px] rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700"
            >
              {downloadState.phase === "done" ? t("updateButton") : t("downloadButton")}
            </button>
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
                  <> ({formatMb(downloadState.progress.bytesSoFar)})</>
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
    </div>
  );
}
