"use client";

import { useEffect, useState } from "react";
import { STORAGE_KEY } from "@/lib/sync/persistence";

/**
 * Returns an incrementing counter that bumps whenever the sync-status
 * localStorage key changes. Responds to both native cross-tab StorageEvents
 * and the synthetic same-tab StorageEvent dispatched by saveSyncStatus.
 *
 * Use the returned value as a dependency in useEffect calls that read
 * loadSyncStatus() so SyncStatusLine re-renders after any sync path writes
 * status (unload beacon, per-grade push, retry push, background pull).
 *
 * Mirrors useSessionStorageKey in lib/review/useSessionStorageKey.ts.
 */
export function useSyncStatusKey(): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === STORAGE_KEY) {
        setVersion((v) => v + 1);
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return version;
}
