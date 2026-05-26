"use client";

import { useEffect } from "react";
import { loadSession, STORAGE_KEY as SESSION_STORAGE_KEY, SESSION_CHANGED_EVENT } from "@/lib/review/persistence";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import { todayString } from "@/lib/review/session";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import { computeQueueCount } from "@/lib/stats/dashboard-snapshot";

/**
 * Syncs the Web Badging API app-icon badge with the number of cards due today.
 *
 * The badge count is the sum of new + learning + review cards across the
 * current session. It is updated whenever the session or settings change, and
 * cleared when no cards are due (or when the API is unavailable).
 *
 * Queue computation is delegated to `computeQueueCount` (shared with the Stats
 * dashboard), so the badge count always agrees with the Stats page (#1137).
 *
 * The hook also subscribes to `SESSION_CHANGED_EVENT` (`poke-memory:session-changed`)
 * so it updates reactively after every IDB write — including on WebKit (mobile Safari),
 * where synthetic StorageEvents are not reliably propagated to same-tab listeners
 * (#1134). The existing `useLocalStorageKey` dependency handles the desktop/non-WebKit
 * path; the CustomEvent subscription covers WebKit.
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
      // Delegate to the shared helper so the badge count always agrees with
      // the Stats dashboard's queue axis for identical inputs (#1137).
      // Note: the incomplete-chains context is omitted here because the
      // badge hook does not have access to mastery/repetition state. The
      // preset will simply match nothing when active, which is acceptable
      // — the badge count may be slightly conservative in that edge case.
      const { totalCount } = computeQueueCount(
        session.cards,
        {
          evolutionCardsEnabled: settings.evolutionCardsEnabled,
          reverseEvolutionCardsEnabled: settings.reverseEvolutionCardsEnabled,
          cryCardsEnabled: settings.cryCardsEnabled,
          alternateFormsEnabled: settings.alternateFormsEnabled,
          practiceScope: settings.practiceScope,
        },
        session.limits,
        today,
      );

      try {
        if (totalCount > 0) {
          await navigator.setAppBadge(totalCount);
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

    // Re-sync on every IDB write, including on WebKit (mobile Safari) where
    // synthetic StorageEvents are not reliably propagated to same-tab listeners.
    // This matches the canonical pattern from BottomTabBar (#1131).
    window.addEventListener(SESSION_CHANGED_EVENT, sync);

    return () => {
      cancelled = true;
      window.removeEventListener(SETTINGS_SAVED_EVENT, onSettingsSaved);
      window.removeEventListener(SESSION_CHANGED_EVENT, sync);
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
