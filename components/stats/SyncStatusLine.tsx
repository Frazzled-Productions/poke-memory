"use client";
import { useEffect, useState } from "react";
import { loadSyncStatus } from "@/lib/sync/persistence";

export function SyncStatusLine() {
  const [text, setText] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  useEffect(() => {
    const status = loadSyncStatus();
    const fmt = (iso: string) =>
      new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    if (status.lastPushFailed && status.lastPushAttemptAt) {
      setText(`Sync failed at ${fmt(status.lastPushAttemptAt)}`);
      setErrorDetail("Push returned an error — will retry next session.");
    } else if (status.lastPushAt) {
      setText(`Last synced: ${fmt(status.lastPushAt)}`);
    } else {
      setText("Not synced yet.");
    }
  }, []);

  if (text === null) return null;

  return (
    <div className="text-sm text-zinc-500 dark:text-zinc-400">
      <span>{text}</span>
      {errorDetail && (
        <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">{errorDetail}</span>
      )}
    </div>
  );
}
