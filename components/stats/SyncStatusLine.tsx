"use client";
import { useEffect, useState } from "react";
import { loadSyncStatus, STORAGE_KEY as SYNC_STATUS_KEY } from "@/lib/sync/persistence";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import type { RetryState } from "@/lib/sync/useRetryPush";
import { mutedText } from "@/lib/utils/class-names";

type SyncState = { text: string; errorDetail: string | null; failed: boolean };

type Props = {
  retryState: RetryState;
  retryNow: () => void;
  superuserPaused?: boolean;
};

export function SyncStatusLine({
  retryState,
  retryNow,
  superuserPaused = false,
}: Props) {
  const syncStatusVersion = useLocalStorageKey(SYNC_STATUS_KEY);
  const [state, setState] = useState<SyncState | null>(null);

  useEffect(() => {
    const status = loadSyncStatus();
    const fmt = (iso: string) =>
      new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    if (status.lastPushFailed) {
      const timeStr = status.lastPushAttemptAt ? ` at ${fmt(status.lastPushAttemptAt)}` : "";
      const { failedCardCount } = status;
      if (failedCardCount === 0) {
        // Either the unload push succeeded before .then() cleared lastPushFailed,
        // or a retry succeeded and wrote failedCardCount: 0.
        setState({
          text: `Last synced: ${status.lastPushAt ? fmt(status.lastPushAt) : "recently"}`,
          errorDetail: null,
          failed: false,
        });
      } else if (failedCardCount === 1) {
        setState({
          text: `1 card may be out of sync${timeStr}`,
          errorDetail: null,
          failed: true,
        });
      } else if (typeof failedCardCount === "number" && failedCardCount > 1) {
        setState({
          text: `${failedCardCount} cards may be out of sync${timeStr}`,
          errorDetail: null,
          failed: true,
        });
      } else {
        setState({
          text: `Sync failed${timeStr}`,
          errorDetail: null,
          failed: true,
        });
      }
    } else if (status.lastPushAt) {
      setState({ text: `Last synced: ${fmt(status.lastPushAt)}`, errorDetail: null, failed: false });
    } else {
      setState({ text: "Not synced yet.", errorDetail: null, failed: false });
    }
  }, [syncStatusVersion]);

  if (state === null) return null;

  // While retrying, always show "Retrying…" regardless of stored status.
  if (retryState === "retrying") {
    return (
      <div className={mutedText} aria-live="polite">
        <span>Retrying…</span>
      </div>
    );
  }

  // The retry attempt itself just failed. Show a dedicated message so the
  // user knows the click did something, then let the auto-reset window pass
  // them back to the regular failed-state button.
  if (retryState === "error") {
    const isDisabled = superuserPaused;
    return (
      <div className={mutedText} aria-live="polite">
        <button
          type="button"
          onClick={retryNow}
          disabled={isDisabled}
          title={
            superuserPaused
              ? "Sync is paused while a superuser flag is on."
              : undefined
          }
          className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
        >
          Retry failed · Try again
        </button>
      </div>
    );
  }

  if (state.failed) {
    const isDisabled = superuserPaused;
    const disabledTitle = superuserPaused
      ? "Sync is paused while a superuser flag is on."
      : undefined;

    return (
      <div className={mutedText} aria-live="polite">
        <button
          type="button"
          onClick={retryNow}
          disabled={isDisabled}
          title={disabledTitle}
          className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
        >
          {state.text} · Retry
        </button>
      </div>
    );
  }

  return (
    <div className={mutedText}>
      <span>{state.text}</span>
    </div>
  );
}
