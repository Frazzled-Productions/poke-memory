"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  isUnlocked,
  setUnlocked,
  loadFlags,
  saveFlags,
  clearFlags,
  anyFlagTrue,
  UNLOCKED_KEY,
  FLAGS_KEY,
  DEFAULT_FLAGS,
  type SuperuserFlags,
  type SuperuserFlagKey,
} from "./persistence";
import { useAuth } from "@/lib/auth/AuthContext";
import { pullSession, applyCloudAuthoritative } from "@/lib/sync/cloud";
import { loadSession, saveSession, STORAGE_KEY as SESSION_STORAGE_KEY } from "@/lib/review/persistence";
import { DEFAULT_LIMITS } from "@/lib/review/session";
import { idbDelete } from "@/lib/idb/db";
import {
  loadFavourite,
  saveFavourite,
  isFavouriteEarned,
} from "@/lib/theme/persistence";
import { loadSettings } from "@/lib/settings/persistence";
import { SEED_POKEMON, SEED_EVOLUTION_CARDS } from "@/lib/pokemon/seed";
import { seedOptsFromSettings } from "@/lib/review/seedOpts";

// Typing "super" anywhere (when not focused on an input) toggles unlocked state.
const CHORD_SEQUENCE = ["s", "u", "p", "e", "r"];
const CHORD_TIMEOUT_MS = 2000;

// Mobile: tap the nav title (data-superuser-tap="true") 7 times within 2 s.
const TAP_COUNT = 7;
const TAP_TIMEOUT_MS = 2000;

type SuperuserContextValue = {
  // Whether the chord/tap has unlocked the Developer panel.
  unlocked: boolean;
  // Per-behaviour flags. Features should branch on these to decide whether
  // to render "fully mastered" state.
  flags: SuperuserFlags;
  // True when any flag is on — sync paths check this to suppress writes.
  anyFlagOn: boolean;
  // Toggle an individual flag. Resolves once any required exit cleanup
  // (cloud→local overwrite or guest reset prompt) has completed.
  setFlag: (key: SuperuserFlagKey, value: boolean) => Promise<void>;
};

const SuperuserContext = createContext<SuperuserContextValue>({
  unlocked: false,
  flags: DEFAULT_FLAGS,
  anyFlagOn: false,
  setFlag: async () => {},
});

export function useSuperuser(): SuperuserContextValue {
  return useContext(SuperuserContext);
}

export function SuperuserProvider({ children }: { children: React.ReactNode }) {
  const { user, supabase } = useAuth();
  const [unlocked, setUnlockedState] = useState(false);
  const [flags, setFlags] = useState<SuperuserFlags>(DEFAULT_FLAGS);

  // Refs let chord/tap handlers see latest values without rebinding listeners
  // on every auth change or flag flip.
  const userRef = useRef(user);
  const supabaseRef = useRef(supabase);
  userRef.current = user;
  supabaseRef.current = supabase;

  const flagsRef = useRef(flags);
  flagsRef.current = flags;
  const unlockedRef = useRef(unlocked);
  unlockedRef.current = unlocked;

  // Force-pull cloud over local on the "any flag was on → no flags on" transition.
  // Signed-in users get authoritative cloud state restored. Guests get a destructive
  // confirm (there is no cloud to fall back to). After the cards path settles —
  // and only when card state is trusted (pull succeeded, or guest confirmed the
  // wipe) — re-validate the favourite theme so a cheat-selected one cannot
  // survive the flag-off transition (#428). On the un-trusted paths (pull threw,
  // guest pressed Cancel) the local session still reflects cheat-inflated state,
  // so a mastery check would spuriously return earned; `FavouriteThemeProvider`'s
  // mount-time belt-and-braces handles those cases on the next page load.
  const exitCleanup = useCallback(async () => {
    const u = userRef.current;
    const sb = supabaseRef.current;
    let cardsTrusted = false;
    if (u && sb) {
      try {
        const rows = await pullSession(sb, u.id);
        if (rows) {
          const local = await loadSession();
          const settings = loadSettings();
          const opts = seedOptsFromSettings(settings);
          const rebuilt = applyCloudAuthoritative(SEED_POKEMON, SEED_EVOLUTION_CARDS, rows, opts);
          const limits = local?.limits ?? DEFAULT_LIMITS;
          await saveSession({ cards: rebuilt, limits });
          // Synthetic StorageEvent invariant: same-tab subscribers
          // (useSessionStorageKey) only re-render on this event.
          window.dispatchEvent(
            new StorageEvent("storage", { key: SESSION_STORAGE_KEY }),
          );
          cardsTrusted = true;
        }
      } catch (err) {
        console.warn("[superuser] cloud→local overwrite failed:", err);
      }
    } else {
      const confirmed = window.confirm(
        "Reset local progress?\n\nSuperuser mode may have altered your local card state. Press OK to clear it (you'll start fresh), or Cancel to keep what you have now.",
      );
      if (confirmed) {
        // Data now lives in IndexedDB; delete it there. The localStorage key
        // is left alone (it was already removed during the initial migration).
        await idbDelete(SESSION_STORAGE_KEY);
        window.dispatchEvent(
          new StorageEvent("storage", { key: SESSION_STORAGE_KEY }),
        );
        cardsTrusted = true;
      }
    }

    if (!cardsTrusted) return;
    const favourite = loadFavourite();
    if (favourite === null) return;
    const settings = loadSettings();
    const cards = (await loadSession())?.cards ?? [];
    if (!isFavouriteEarned(favourite, cards, settings.masteryRepetitions)) {
      // `saveFavourite` → `saveSettings` already fires `SETTINGS_SAVED_EVENT`,
      // which `FavouriteThemeProvider` listens for — no synthetic StorageEvent
      // is needed for same-tab refresh.
      saveFavourite(null);
    }
  }, []);

  const setFlag = useCallback(
    async (key: SuperuserFlagKey, value: boolean) => {
      const prev = flagsRef.current;
      const next: SuperuserFlags = { ...prev, [key]: value };
      const prevAnyOn = anyFlagTrue(prev);
      const nextAnyOn = anyFlagTrue(next);
      saveFlags(next);
      flagsRef.current = next;
      setFlags(next);
      if (prevAnyOn && !nextAnyOn) {
        await exitCleanup();
      }
    },
    [exitCleanup],
  );

  useEffect(() => {
    const initialUnlocked = isUnlocked();
    setUnlockedState(initialUnlocked);
    unlockedRef.current = initialUnlocked;
    const initialFlags = loadFlags();
    setFlags(initialFlags);
    flagsRef.current = initialFlags;

    function handleStorage(e: StorageEvent) {
      if (e.key === UNLOCKED_KEY) {
        const next = isUnlocked();
        setUnlockedState(next);
        unlockedRef.current = next;
      } else if (e.key === FLAGS_KEY) {
        const next = loadFlags();
        setFlags(next);
        flagsRef.current = next;
      }
    }

    async function toggleUnlocked() {
      const next = !unlockedRef.current;
      setUnlocked(next);
      unlockedRef.current = next;
      setUnlockedState(next);
      if (!next) {
        // Locking always clears all flags. If any were on, run cleanup so
        // the "any-on → none-on" invariant holds even when initiated by lock.
        const prev = flagsRef.current;
        const anyWasOn = anyFlagTrue(prev);
        if (anyWasOn) {
          clearFlags();
          flagsRef.current = DEFAULT_FLAGS;
          setFlags(DEFAULT_FLAGS);
          await exitCleanup();
        }
      }
    }

    let pending: string[] = [];
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === CHORD_SEQUENCE[pending.length]) {
        if (timeoutId !== null) clearTimeout(timeoutId);
        pending.push(e.key);
        if (pending.length === CHORD_SEQUENCE.length) {
          pending = [];
          void toggleUnlocked();
        } else {
          timeoutId = setTimeout(() => {
            pending = [];
          }, CHORD_TIMEOUT_MS);
        }
      } else {
        if (timeoutId !== null) clearTimeout(timeoutId);
        pending = [];
        if (e.key === CHORD_SEQUENCE[0]) {
          pending.push(e.key);
          timeoutId = setTimeout(() => {
            pending = [];
          }, CHORD_TIMEOUT_MS);
        }
      }
    }

    let tapCount = 0;
    let tapTimeoutId: ReturnType<typeof setTimeout> | null = null;

    function handleTouchEnd(e: TouchEvent) {
      const target = e.target as Element | null;
      if (!target?.closest("[data-superuser-tap]")) return;
      if (tapTimeoutId === null) {
        tapTimeoutId = setTimeout(() => {
          tapCount = 0;
          tapTimeoutId = null;
        }, TAP_TIMEOUT_MS);
      }
      tapCount += 1;
      if (tapCount >= TAP_COUNT) {
        if (tapTimeoutId !== null) clearTimeout(tapTimeoutId);
        tapCount = 0;
        tapTimeoutId = null;
        void toggleUnlocked();
      }
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("touchend", handleTouchEnd);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("touchend", handleTouchEnd);
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (tapTimeoutId !== null) clearTimeout(tapTimeoutId);
    };
  }, [exitCleanup]);

  return (
    <SuperuserContext.Provider
      value={{ unlocked, flags, anyFlagOn: anyFlagTrue(flags), setFlag }}
    >
      {children}
    </SuperuserContext.Provider>
  );
}
