"use client";

import { useEffect } from "react";
import { loadSession, STORAGE_KEY as SESSION_STORAGE_KEY } from "@/lib/review/persistence";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import { buildQueueCounters, todayString } from "@/lib/review/session";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";

/**
 * Prefixes `document.title` with `(N)` when N cards are due, clearing the
 * prefix when no cards are due. This gives desktop users a tab-level due-count
 * indicator without needing the app to be installed as a PWA.
 *
 * The prefix composes with whatever the current route's title is — it reads
 * the base title from `document.title`, strips any existing `(N)` prefix, and
 * prepends the new count. A MutationObserver on the `<title>` element detects
 * Next.js route-level title changes so the prefix is re-applied after
 * navigation.
 *
 * The due-card count uses the same logic as the PWA app-icon badge (#916):
 * `buildQueueCounters` over the session from IndexedDB/localStorage, re-run
 * whenever the session storage key changes or settings are saved.
 *
 * Superuser flags are deliberately not plumbed here — the title badge should
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
      const { newCount, learningCount, reviewCount } = buildQueueCounters(session.cards, today);
      const total = newCount + learningCount + reviewCount;

      currentCount = total;
      applyTitle(total);
    }

    void sync();

    function onSettingsSaved() {
      void sync();
    }
    window.addEventListener(SETTINGS_SAVED_EVENT, onSettingsSaved);

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
