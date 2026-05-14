"use client";

import { useEffect } from "react";
import { migrateFromLocalStorage } from "@/lib/idb/db";

/**
 * Mounts in the root layout and runs the one-time migration from localStorage
 * to IndexedDB on the first page load after upgrade. Subsequent loads are a
 * cheap no-op (flag already set in IndexedDB).
 */
export function IdbMigration() {
  useEffect(() => {
    void migrateFromLocalStorage();
  }, []);

  return null;
}
