"use client";

import { useEffect, useRef, useState } from "react";
import { filterMastered } from "@/lib/pasture/arrivals";
import { loadSession, STORAGE_KEY as SESSION_STORAGE_KEY } from "@/lib/review/persistence";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import { KEY_HAS_MASTERED } from "@/lib/storage/keys";

/**
 * Derives whether the user has at least one mastered species, which controls
 * the visibility of the Pasture link/tab across all three nav surfaces
 * (NavLinks, NavDrawer, BottomTabBar).
 *
 * Behaviour:
 * - Fast path: reads the lightweight `KEY_HAS_MASTERED` localStorage flag
 *   written by ReviewSession on first mastery. A value of `"true"` short-
 *   circuits the full IDB load.
 * - Full path: loads the session from IDB and calls `filterMastered` when the
 *   flag is absent or `"false"` — needed on first load after upgrading, after a
 *   reset, or whenever the masteryRepetitions threshold changes.
 * - Epoch guard: compares `window.__pokeMemorySessionWriteEpoch` on each effect
 *   run against the epoch seen at last attach. If a write happened before React
 *   hydrated and the listener was registered, a `requestAnimationFrame` catch-
 *   up is scheduled so the component reflects the write without needing a
 *   StorageEvent.
 * - Superuser: when `flags.pretendAllMastered` is on, `showPasture` is forced
 *   `true` regardless of actual mastery data, preserving the QA axis.
 *
 * Re-runs the derivation whenever:
 * - The session storage key changes (cross-tab sync pull, E2E seed).
 * - `KEY_HAS_MASTERED` changes (ReviewSession writes it on mastery transition
 *   or clears it on reset).
 * - A `SETTINGS_SAVED_EVENT` fires (masteryRepetitions threshold change).
 *
 * Returns `{ showPasture }` — `true` when the Pasture nav entry should be
 * visible.
 */
export function usePastureMasteryState(): { showPasture: boolean } {
  const [hasMastered, setHasMastered] = useState(false);
  // Re-runs the mastery check when the session key changes via a cross-tab
  // StorageEvent (e.g. sync pull from another tab, or the E2E seed helper).
  // The per-grade SESSION_CHANGED_EVENT is no longer the trigger — instead,
  // ReviewSession writes KEY_HAS_MASTERED on the first mastery transition so
  // the Pasture link appears without re-parsing the full IDB blob on every
  // grade (#1191 Class A item 3).
  const sessionVersion = useLocalStorageKey(SESSION_STORAGE_KEY);
  // Bumped by the SETTINGS_SAVED_EVENT listener so a masteryRepetitions
  // threshold change re-derives Pasture link visibility without waiting for
  // an unrelated session storage bump.
  const [settingsVersion, setSettingsVersion] = useState(0);
  // Responds to ReviewSession writing KEY_HAS_MASTERED when a card first
  // crosses the mastery threshold, or when the flag is cleared on reset.
  const hasMasteredVersion = useLocalStorageKey(KEY_HAS_MASTERED);
  const { flags } = useSuperuser();

  // Tracks the write epoch seen when the mastery effect last attached its
  // listener, to detect writes that happened before React hydrated.
  const epochAtLastAttach = useRef<number>(0);

  useEffect(() => {
    function onSaved() {
      setSettingsVersion((v) => v + 1);
    }
    window.addEventListener(SETTINGS_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, onSaved);
  }, []);

  useEffect(() => {
    // Fast path: read the lightweight flag written by ReviewSession. Falls back
    // to loading the full session only when the flag is absent (first load after
    // upgrading, or after a session reset). Once the flag is `"true"`, at least
    // one species is mastered and the Pasture link should be shown. We only
    // cache `"true"` — a missing or non-"true" flag means we do the full check
    // so that threshold changes (via SETTINGS_SAVED_EVENT) are always reflected
    // correctly.
    async function load() {
      if (localStorage.getItem(KEY_HAS_MASTERED) === "true") {
        setHasMastered(true);
        return;
      }
      // Flag absent or "false" — do the full check.
      const session = await loadSession();
      const masteryRepetitions = loadSettings().masteryRepetitions;
      const result =
        session !== null &&
        filterMastered(session.cards, false, masteryRepetitions).length > 0;
      setHasMastered(result);
    }
    void load();

    // Catch-up check: if a write happened before this effect registered its
    // listener (e.g. the E2E seed fires tx.oncomplete before React hydrates),
    // the epoch on window will be higher than what we recorded last time.
    const epochNow = window.__pokeMemorySessionWriteEpoch ?? 0;
    if (epochNow !== epochAtLastAttach.current) {
      epochAtLastAttach.current = epochNow;
      requestAnimationFrame(() => { void load(); });
    }
  }, [sessionVersion, settingsVersion, hasMasteredVersion]);

  return { showPasture: hasMastered || flags.pretendAllMastered };
}
