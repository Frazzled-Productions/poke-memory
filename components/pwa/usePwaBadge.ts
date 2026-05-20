"use client";

import { useEffect } from "react";
import { loadSession, STORAGE_KEY as SESSION_STORAGE_KEY } from "@/lib/review/persistence";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import { buildSessionQueues, todayString } from "@/lib/review/session";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";

/**
 * Syncs the Web Badging API app-icon badge with the number of cards due today.
 *
 * The badge count is the sum of new + learning + review cards across the
 * current session. It is updated whenever the session or settings change, and
 * cleared when no cards are due (or when the API is unavailable).
 *
 * The Web Badging API (`navigator.setAppBadge` / `navigator.clearAppBadge`) is
 * supported on Chrome/Edge desktop and Android, and Safari 16.4+. Where
 * unsupported this hook is a no-op, feature-detected via `"setAppBadge" in
 * navigator`, never throwing.
 *
 * Superuser flags are deliberately not plumbed here: the badge should reflect
 * the user's real card state, not a QA override. A QA session with
 * `pretendAllMastered` on should not pollute the installed-PWA icon.
 */
export function usePwaBadge(): void {
  const sessionVersion = useLocalStorageKey(SESSION_STORAGE_KEY);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) {
      return;
    }

    let cancelled = false;

    async function sync() {
      const session = await loadSession();
      if (cancelled) return;

      if (session === null || session.cards.length === 0) {
        try {
          await navigator.clearAppBadge();
        } catch {
          // Silently ignore — badge API may not be permitted in this context.
        }
        return;
      }

      const settings = loadSettings();
      const tz = settings.timezone ?? "UTC";
      const today = todayString(new Date(), tz);
      // Use buildSessionQueues (same function the Practice page uses) so the
      // badge reflects today's capped queue — not the entire untouched backlog.
      const { newQueue, learningCardIds, reviewQueue } = buildSessionQueues(
        session.cards,
        session.limits,
        today,
      );
      const total = newQueue.length + learningCardIds.length + reviewQueue.length;

      try {
        if (total > 0) {
          await navigator.setAppBadge(total);
        } else {
          await navigator.clearAppBadge();
        }
      } catch {
        // Silently ignore — badge API may not be permitted in this context.
      }
    }

    void sync();

    // Re-sync when settings change (e.g. timezone or masteryRepetitions updated).
    function onSettingsSaved() {
      void sync();
    }
    window.addEventListener(SETTINGS_SAVED_EVENT, onSettingsSaved);

    return () => {
      cancelled = true;
      window.removeEventListener(SETTINGS_SAVED_EVENT, onSettingsSaved);
    };
    // sessionVersion tracks changes to the session storage key; re-run on every bump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionVersion]);

  // Clear the badge on unmount (e.g. component tree torn down).
  useEffect(() => {
    return () => {
      if (typeof navigator === "undefined" || !("clearAppBadge" in navigator)) {
        return;
      }
      navigator.clearAppBadge().catch(() => {
        // Silently ignore.
      });
    };
  }, []);
}
