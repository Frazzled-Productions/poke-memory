"use client";

import { useEffect } from "react";
import { loadSession, STORAGE_KEY as SESSION_STORAGE_KEY, SESSION_CHANGED_EVENT } from "@/lib/review/persistence";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import { todayString } from "@/lib/review/session";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import { computeQueueCount } from "@/lib/stats/dashboard-snapshot";
import type { AppLocale } from "@/i18n/locales";

/**
 * Prefixes `document.title` with `(N)` when N cards are due, clearing the
 * prefix when no cards are due. This gives desktop users a tab-level due-count
 * indicator without needing the app to be installed as a PWA.
 *
 * The prefix composes with whatever the current route's title is - it reads
 * the base title from `document.title`, strips any existing `(N)` prefix, and
 * prepends the new count. A MutationObserver on the `<title>` element detects
 * Next.js route-level title changes so the prefix is re-applied after
 * navigation.
 *
 * Queue computation is delegated to `computeQueueCount` (shared with the Stats
 * dashboard and `usePwaBadge`), so the tab count is always consistent with
 * the session the user is about to open (#1137).
 *
 * The hook also subscribes to `SESSION_CHANGED_EVENT` (`poke-memory:session-changed`)
 * so it updates reactively after every IDB write - including on WebKit (mobile Safari),
 * where synthetic StorageEvents are not reliably propagated to same-tab listeners
 * (#1134). The existing `useLocalStorageKey` dependency handles the desktop/non-WebKit
 * path; the CustomEvent subscription covers WebKit.
 *
 * Superuser flags are deliberately not plumbed here - the title badge should
 * reflect the user's real card state, consistent with `usePwaBadge`.
 */
export function useDocumentTitleBadge(): void {
  const sessionVersion = useLocalStorageKey(SESSION_STORAGE_KEY);

  useEffect(() => {
    if (typeof document === "undefined") return;

    let cancelled = false;
    let currentCount = 0;

    /** Strip any existing `(N)` prefix and return the bare title. */
    function baseTitle(raw: string): string {
      return raw.replace(/^\(\d+\)\s*/, "");
    }

    /** Apply or remove the count prefix on `document.title`. */
    function applyTitle(count: number): void {
      const bare = baseTitle(document.title);
      document.title = count > 0 ? `(${count}) ${bare}` : bare;
    }

    async function sync() {
      const session = await loadSession();
      if (cancelled) return;

      if (session === null || session.cards.length === 0) {
        currentCount = 0;
        applyTitle(0);
        return;
      }

      const settings = loadSettings();
      const tz = settings.timezone ?? "UTC";
      const today = todayString(new Date(), tz);
      // Delegate to the shared helper so the title badge always agrees with
      // the Stats dashboard's queue axis for identical inputs (#1137).
      // Note: the incomplete-chains context is omitted here because the
      // badge hook does not have access to mastery/repetition state. The
      // preset will simply match nothing when active, which is acceptable
      // - the badge count may be slightly conservative in that edge case.
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
        (settings.activePokemonNameLocale ?? "en") as AppLocale,
      );

      currentCount = totalCount;
      applyTitle(totalCount);
    }

    void sync();

    function onSettingsSaved() {
      void sync();
    }
    window.addEventListener(SETTINGS_SAVED_EVENT, onSettingsSaved);

    // Re-sync on every IDB write, including on WebKit (mobile Safari) where
    // synthetic StorageEvents are not reliably propagated to same-tab listeners.
    // This matches the canonical pattern from BottomTabBar (#1131).
    window.addEventListener(SESSION_CHANGED_EVENT, sync);

    // Re-apply the prefix when Next.js updates document.title on navigation.
    // The observer fires when the text content of <title> changes; we strip any
    // stale prefix and prepend the current count.
    const titleEl = document.querySelector("title");
    let observer: MutationObserver | null = null;
    if (titleEl) {
      observer = new MutationObserver(() => {
        if (cancelled) return;
        // Only act if the change came from outside this hook (i.e. the current
        // title doesn't already carry our prefix).
        if (currentCount > 0 && !document.title.startsWith(`(${currentCount})`)) {
          applyTitle(currentCount);
        }
      });
      observer.observe(titleEl, { childList: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener(SETTINGS_SAVED_EVENT, onSettingsSaved);
      window.removeEventListener(SESSION_CHANGED_EVENT, sync);
      observer?.disconnect();
    };
    // sessionVersion tracks changes to the session storage key; re-run on every bump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionVersion]);

  // Clear the prefix on unmount (e.g. component tree torn down).
  useEffect(() => {
    return () => {
      if (typeof document === "undefined") return;
      document.title = document.title.replace(/^\(\d+\)\s*/, "");
    };
  }, []);
}
