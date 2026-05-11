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
      setState({
        text: `Sync failed${timeStr}`,
        errorDetail: "Push returned an error — will retry next session.",
      });
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
