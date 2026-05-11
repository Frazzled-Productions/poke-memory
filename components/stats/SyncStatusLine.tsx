"use client";
import { useEffect, useState } from "react";
import { loadSyncStatus } from "@/lib/sync/persistence";

type SyncState = { text: string; errorDetail: string | null };

type Props = {
  refreshKey?: number;
};

export function SyncStatusLine({ refreshKey }: Props) {
  const [state, setState] = useState<SyncState | null>(null);

  useEffect(() => {
    const status = loadSyncStatus();
    const fmt = (iso: string) =>
      new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    if (status.lastPushFailed) {
      const timeStr = status.lastPushAttemptAt ? ` at ${fmt(status.lastPushAttemptAt)}` : "";
      const { failedCardCount } = status;
      if (failedCardCount === 0) {
        // Unload push succeeded before the .then() could clear lastPushFailed.
        setState({ text: `Last synced: ${status.lastPushAt ? fmt(status.lastPushAt) : "recently"}`, errorDetail: null });
      } else if (failedCardCount === 1) {
        setState({
          text: `1 card may be out of sync${timeStr}`,
          errorDetail: "Will retry next time you sync.",
        });
      } else if (failedCardCount !== null && failedCardCount > 1) {
        setState({
          text: `${failedCardCount} cards may be out of sync${timeStr}`,
          errorDetail: "Will retry next time you sync.",
        });
      } else {
        setState({
          text: `Sync failed${timeStr}`,
          errorDetail: "Will retry next time you sync.",
        });
      }
    } else if (status.lastPushAt) {
      setState({ text: `Last synced: ${fmt(status.lastPushAt)}`, errorDetail: null });
    } else {
      setState({ text: "Not synced yet.", errorDetail: null });
    }
  }, [refreshKey]);

  if (state === null) return null;

  return (
    <div className="text-sm text-zinc-500 dark:text-zinc-400">
      <span>{state.text}</span>
      {state.errorDetail && (
        <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">{state.errorDetail}</span>
      )}
    </div>
  );
}
