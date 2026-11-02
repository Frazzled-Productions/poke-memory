"use client";

import { useEffect, useState } from "react";
import { loadSettings, SETTINGS_SAVED_EVENT, type UserSettings } from "@/lib/settings/persistence";
import { KEY_SETTINGS } from "@/lib/storage/keys";

/**
 * The stored settings, re-read on every save in this tab and on writes from
 * other tabs (#2187). Null until mounted, so server and first client render
 * agree. The favourite and hearts surfaces read them through this hook.
 */
export function useStoredSettings(): UserSettings | null {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  useEffect(() => {
    const refresh = () => setSettings(loadSettings());
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_SETTINGS) refresh();
    };
    refresh();
    window.addEventListener(SETTINGS_SAVED_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SETTINGS_SAVED_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return settings;
}
