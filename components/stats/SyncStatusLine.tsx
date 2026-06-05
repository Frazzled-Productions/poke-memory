"use client";
import { useEffect, useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { loadSyncStatus, STORAGE_KEY as SYNC_STATUS_KEY } from "@/lib/sync/persistence";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import type { RetryState } from "@/lib/sync/useRetryPush";
import { mutedText } from "@/lib/utils/class-names";

// ---------------------------------------------------------------------------
// Typed state - stores raw data so the render can format it via t().
// ---------------------------------------------------------------------------

type SyncStatusState =
  | { kind: "lastSynced"; time: Date }
  | { kind: "notSyncedYet" }
  | { kind: "syncFailed"; timeStr: string | null }
  | { kind: "cardsOutOfSync"; count: number; timeStr: string | null }
  | {
      kind: "schemaError";
      /**
       * Non-null when a structural (non-transient) error was recorded on the
       * card_reviews primary path (#1358). Retrying is pointless until a deploy
       * fixes the schema mismatch - the Retry button is hidden in this state.
       */
      detail: string;
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
  const t = useTranslations("sync.status");
  const fmt = useFormatter();
  const syncStatusVersion = useLocalStorageKey(SYNC_STATUS_KEY);
  const [state, setState] = useState<SyncStatusState | null>(null);

  useEffect(() => {
    const status = loadSyncStatus();

    // Structural errors take priority over the generic failed state. The Retry
    // button is hidden entirely - retrying is pointless until a deploy fixes
    // the mismatch.
    if (status.structuralSyncError !== null) {
      setState({ kind: "schemaError", detail: status.structuralSyncError });
    } else if (status.lastPushFailed) {
      const { failedCardCount } = status;
      const rawTimeStr = status.lastPushAttemptAt ?? null;

      if (failedCardCount === 0) {
        // Either the unload push succeeded before .then() cleared lastPushFailed,
        // or a retry succeeded and wrote failedCardCount: 0.
        const pushAt = status.lastPushAt ? new Date(status.lastPushAt) : null;
        setState(
          pushAt
            ? { kind: "lastSynced", time: pushAt }
            : { kind: "notSyncedYet" },
        );
      } else if (typeof failedCardCount === "number" && failedCardCount >= 1) {
        setState({ kind: "cardsOutOfSync", count: failedCardCount, timeStr: rawTimeStr });
      } else {
        setState({ kind: "syncFailed", timeStr: rawTimeStr });
      }
    } else if (status.lastPushAt) {
      setState({ kind: "lastSynced", time: new Date(status.lastPushAt) });
    } else {
      setState({ kind: "notSyncedYet" });
    }
  }, [syncStatusVersion]);

  if (state === null) return null;

  // Structural error - show a non-dismissable, NON-retryable message. The Retry
  // button is intentionally absent: 42P10 (and other structural codes) always
  // indicate a deploy/schema mismatch; retrying will always fail until the
  // server is fixed. Progress is safe locally.
  if (state.kind === "schemaError") {
    return (
      <div className={mutedText} aria-live="polite">
        <span>{t("schemaError")}</span>
      </div>
    );
  }

  // While retrying, always show "Retrying…" regardless of stored status.
  if (retryState === "retrying") {
    return (
      <div className={mutedText} aria-live="polite">
        <span>{t("retrying")}</span>
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
          {t("retryFailed")}
        </button>
      </div>
    );
  }

  const isFailed =
    state.kind === "cardsOutOfSync" || state.kind === "syncFailed";

  if (isFailed) {
    const isDisabled = superuserPaused;
    const disabledTitle = superuserPaused
      ? "Sync is paused while a superuser flag is on."
      : undefined;

    // Build a locale-aware time suffix when available.
    const timeStr =
      state.kind === "cardsOutOfSync" || state.kind === "syncFailed"
        ? state.timeStr
        : null;
    const timeSuffix = timeStr
      ? ` ${t("atTime", { time: fmt.dateTime(new Date(timeStr), { hour: "2-digit", minute: "2-digit", hour12: false }) })}`
      : "";

    const errorText =
      state.kind === "cardsOutOfSync"
        ? t("cardsOutOfSync", { count: state.count }) + timeSuffix
        : t("syncFailed") + timeSuffix;

    return (
      <div className={mutedText} aria-live="polite">
        <button
          type="button"
          onClick={retryNow}
          disabled={isDisabled}
          title={disabledTitle}
          className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
        >
          {errorText} · {t("retry")}
        </button>
      </div>
    );
  }

  // Success / not-synced-yet states.
  const statusText =
    state.kind === "lastSynced"
      ? t("lastSynced", {
          time: fmt.dateTime(state.time, { hour: "2-digit", minute: "2-digit", hour12: false }),
        })
      : t("notSyncedYet");

  return (
    <div className={mutedText}>
      <span>{statusText}</span>
    </div>
  );
}
