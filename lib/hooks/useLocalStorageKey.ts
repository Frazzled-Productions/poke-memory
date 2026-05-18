"use client";

import { useEffect, useState } from "react";

/**
 * Returns an incrementing counter that bumps whenever the given localStorage
 * key changes. Responds to both native cross-tab StorageEvents and synthetic
 * same-tab StorageEvents dispatched by mutation helpers (e.g. saveSession,
 * saveSyncStatus, pullAndMerge).
 *
 * Use the returned value as a dependency in useEffect calls that read from
 * localStorage so components re-render after any write path fires.
 */
export function useLocalStorageKey(key: string): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === key) {
        setVersion((v) => v + 1);
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [key]);

  return version;
}
