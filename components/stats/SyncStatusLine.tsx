"use client";
import { useEffect, useState } from "react";
import { loadSyncStatus, STORAGE_KEY as SYNC_STATUS_KEY } from "@/lib/sync/persistence";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import type { RetryState } from "@/lib/sync/useRetryPush";
import { mutedText } from "@/lib/utils/class-names";

type SyncState = {
  text: string;
  errorDetail: string | null;
  failed: boolean;
  /**
   * Non-null when a structural (non-transient) error was recorded on the
   * card_reviews primary path (#1358). Retrying is pointless until a deploy
   * fixes the schema mismatch — the Retry button is hidden in this state.
   */
  structuralSyncError: string | null;
};

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

    // Structural errors take priority over the generic failed state. The Retry
    // button is hidden entirely — retrying is pointless until a deploy fixes
    // the mismatch.
    if (status.structuralSyncError !== null) {
      setState({
        text: "Sync error: a schema mismatch was detected. Your progress is safe locally.",
        errorDetail: status.structuralSyncError,
        failed: true,
        structuralSyncError: status.structuralSyncError,
      });
    } else if (status.lastPushFailed) {
      const timeStr = status.lastPushAttemptAt ? ` at ${fmt(status.lastPushAttemptAt)}` : "";
      const { failedCardCount } = status;
      if (failedCardCount === 0) {
        // Either the unload push succeeded before .then() cleared lastPushFailed,
        // or a retry succeeded and wrote failedCardCount: 0.
        setState({
          text: `Last synced: ${status.lastPushAt ? fmt(status.lastPushAt) : "recently"}`,
          errorDetail: null,
          failed: false,
          structuralSyncError: null,
        });
      } else if (failedCardCount === 1) {
        setState({
          text: `1 card may be out of sync${timeStr}`,
          errorDetail: null,
          failed: true,
          structuralSyncError: null,
        });
      } else if (typeof failedCardCount === "number" && failedCardCount > 1) {
        setState({
          text: `${failedCardCount} cards may be out of sync${timeStr}`,
          errorDetail: null,
          failed: true,
          structuralSyncError: null,
        });
      } else {
        setState({
          text: `Sync failed${timeStr}`,
          errorDetail: null,
          failed: true,
          structuralSyncError: null,
        });
      }
    } else if (status.lastPushAt) {
      setState({ text: `Last synced: ${fmt(status.lastPushAt)}`, errorDetail: null, failed: false, structuralSyncError: null });
    } else {
      setState({ text: "Not synced yet.", errorDetail: null, failed: false, structuralSyncError: null });
    }
  }, [syncStatusVersion]);

  if (state === null) return null;

  // Structural error — show a non-dismissable, NON-retryable message. The Retry
  // button is intentionally absent: 42P10 (and other structural codes) always
  // indicate a deploy/schema mismatch; retrying will always fail until the
  // server is fixed. Progress is safe locally.
  if (state.structuralSyncError !== null) {
    return (
      <div className={mutedText} aria-live="polite">
        <span>{state.text}</span>
      </div>
    );
  }

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
