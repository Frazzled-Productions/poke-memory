"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  loadFavourite,
  saveFavourite,
  isFavouriteEarned,
} from "@/lib/theme/persistence";
import { applyTheme } from "@/lib/theme/apply";
import { applyIntensity } from "@/lib/theme/intensity";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import { loadSession } from "@/lib/review/persistence";
import { loadFlags } from "@/lib/superuser/persistence";
import type { StoredFavourite } from "@/lib/theme/persistence";

// Belt-and-braces invariant for #428: a stored favourite is only applied if
// its underlying card is actually mastered, OR the `pretendAllMastered`
// superuser flag is currently on. A non-earned favourite that somehow
// survives the exit-cleanup (e.g. cleanup pull failed, then a later
// SignInPull restored real cards) is self-healed on the next load and
// cleared from localStorage. `loadFlags` is read directly so we do not
// depend on `SuperuserProvider`'s async mount.
//
// Conservative on `session === null`: a new sign-in pull may restore
// settings before cards, so abstain rather than wipe a legitimate
// favourite. The next mount re-checks once cards are present.
async function resolveFavourite(): Promise<StoredFavourite | null> {
  const stored = loadFavourite();
  if (stored === null) return null;
  if (loadFlags().pretendAllMastered) return stored;
  const session = await loadSession();
  if (session === null) return stored;
  const settings = loadSettings();
  if (isFavouriteEarned(stored, session.cards, settings.masteryRepetitions)) {
    return stored;
  }
  saveFavourite(null);
  return null;
}

type FavouriteContextValue = {
  favourite: StoredFavourite | null;
  updateFavourite: (f: StoredFavourite | null) => void;
};

const FavouriteContext = createContext<FavouriteContextValue>({
  favourite: null,
  updateFavourite: () => {},
});

export function useFavourite(): FavouriteContextValue {
  return useContext(FavouriteContext);
}

export function FavouriteThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [favourite, setFavourite] = useState<StoredFavourite | null>(null);

  const updateFavourite = (f: StoredFavourite | null) => {
    setFavourite(f);
    applyTheme(f?.colors ?? null);
  };

  useEffect(() => {
    // React's singleton-element commit strips all <html> attributes — restore intensity immediately.
    const { themeIntensity } = loadSettings();
    applyIntensity(themeIntensity);

    void resolveFavourite().then((stored) => {
      setFavourite(stored);
      applyTheme(stored?.colors ?? null);
      applyIntensity(themeIntensity);
    });

    function handleStorage(e: StorageEvent) {
      // The favourite theme lives inside the settings blob (#307). Watch
      // both keys so a legacy write (during the one-time migration window)
      // still triggers a refresh.
      if (e.key !== "poke-memory:settings:v1" && e.key !== "poke-memory:favourite:v1") {
        return;
      }
      void resolveFavourite().then((updated) => {
        setFavourite(updated);
        applyTheme(updated?.colors ?? null);
        applyIntensity(loadSettings().themeIntensity);
      });
    }

    function handleSettingsSaved() {
      // Same-tab updates dispatched by saveSettings — cross-tab updates come
      // via the native StorageEvent above.
      applyIntensity(loadSettings().themeIntensity);
      void resolveFavourite().then((updated) => {
        setFavourite(updated);
        applyTheme(updated?.colors ?? null);
      });
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(SETTINGS_SAVED_EVENT, handleSettingsSaved);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(SETTINGS_SAVED_EVENT, handleSettingsSaved);
    };
  }, []);

  return (
    <FavouriteContext.Provider value={{ favourite, updateFavourite }}>
      {children}
    </FavouriteContext.Provider>
  );
}
