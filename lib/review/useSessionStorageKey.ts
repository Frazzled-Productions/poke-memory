"use client";

import { useEffect, useState } from "react";
import { SESSION_STORAGE_KEY } from "@/lib/review/persistence";

/**
 * Returns an incrementing counter that bumps whenever the session localStorage
 * key changes. Responds to both native cross-tab StorageEvents and the
 * synthetic same-tab StorageEvent dispatched by pullAndMerge.
 *
 * Use the returned value as a dependency in useEffect calls that read
 * loadSession() so Stats/Pokédex re-render after a background pull.
 */
export function useSessionStorageKey(): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === SESSION_STORAGE_KEY) {
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
