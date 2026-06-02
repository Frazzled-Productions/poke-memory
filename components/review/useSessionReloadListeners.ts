"use client";

/**
 * useSessionReloadListeners
 *
 * Attaches the three `window` event listeners that trigger a full page reload
 * to rebuild the review session when settings, locale, or synced progress
 * change outside the current render. Extracted from ReviewSession (#1520).
 *
 * Listeners:
 * - `storage` (cross-tab KEY_SETTINGS change) → reload
 * - `SETTINGS_SAVED_EVENT` (same-tab locale switch) → reload only when the
 *   active locale changed
 * - `SYNC_PULL_APPLIED_EVENT` (cloud pull applied progress) → reload
 */

import { useEffect } from "react";
import { KEY_SETTINGS } from "@/lib/storage/keys";
import { SETTINGS_SAVED_EVENT, loadSettings } from "@/lib/settings/persistence";
import { SYNC_PULL_APPLIED_EVENT } from "@/lib/sync/pullAndMerge";
import type { AppLocale } from "@/i18n/locales";

export function useSessionReloadListeners(activeLocale: AppLocale): void {
  // Cross-tab settings change → reload so reverseEnabled and limits stay current.
  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === KEY_SETTINGS) {
        window.location.reload();
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // Same-tab locale switch (#1562). `storage` is not fired for same-tab writes,
  // so we listen to SETTINGS_SAVED_EVENT and reload only when the active locale
  // actually changed (other settings saves must not interrupt practice).
  useEffect(() => {
    function handleSettingsSaved() {
      const next = (loadSettings().activePokemonNameLocale ?? "en") as AppLocale;
      if (next !== activeLocale) {
        window.location.reload();
      }
    }
    window.addEventListener(SETTINGS_SAVED_EVENT, handleSettingsSaved);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, handleSettingsSaved);
  }, [activeLocale]);

  // Cloud pull applied progress not present on this device (#608). Reload so
  // the session rebuilds against the merged local state.
  useEffect(() => {
    function handlePullApplied() {
      window.location.reload();
    }
    window.addEventListener(SYNC_PULL_APPLIED_EVENT, handlePullApplied);
    return () => window.removeEventListener(SYNC_PULL_APPLIED_EVENT, handlePullApplied);
  }, []);
}
