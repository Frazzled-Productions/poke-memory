"use client";

/**
 * React hook for reading a single Labs flag (#1258).
 *
 * Reads the current value of a Labs flag from localStorage via `loadSettings`.
 * Responds to external changes (other-tab writes, `saveSettings` dispatches)
 * via the `storage` event so the value stays in sync across components.
 *
 * The hook is safe to call when `LabsFlagKey` is `never` (empty registry) —
 * it simply never renders with a meaningful key in that state and TypeScript
 * rejects the call at compile time.
 *
 * For non-React call sites use `isLabsFlagEnabled` from `lib/labs/flags.ts`.
 */

import { useEffect, useState } from "react";
import { loadSettings } from "@/lib/settings/persistence";
import { isLabsFlagEnabled } from "./flags";
import type { LabsFlagKey } from "./flags";

export function useLabsFlag(key: LabsFlagKey): boolean {
  const [value, setValue] = useState<boolean>(() => {
    // SSR / node: fall back to disabled.
    if (typeof window === "undefined") return false;
    const settings = loadSettings();
    return isLabsFlagEnabled(settings.labsFlags, key);
  });

  useEffect(() => {
    function read(): boolean {
      const settings = loadSettings();
      return isLabsFlagEnabled(settings.labsFlags, key);
    }

    // Keep in sync with changes from the same tab (saveSettings) and other
    // tabs (storage event).
    function handleStorage() {
      setValue(read());
    }

    setValue(read());
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [key]);

  return value;
}
