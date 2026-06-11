"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  loadFavourite,
} from "@/lib/theme/persistence";
import { applyTheme } from "@/lib/theme/apply";
import { applyIntensity } from "@/lib/theme/intensity";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import type { StoredFavourite } from "@/lib/theme/persistence";
import { KEY_SETTINGS, KEY_LEGACY_FAVOURITE_THEME } from "@/lib/storage/keys";

// Grandfathering decision (#1865): an already-applied favourite is kept as-is
// on load. The picker gate (FavouritePicker in app/settings/page.tsx) tightens
// to species-level mastery (BOTH name + reverse legs) for NEW picks only.
// The superuser exit-cleanup path (SuperuserContext) still validates mastery
// strictly via isFavouriteEarned and wipes a cheat-selected favourite on
// flag-off. That path is intentionally separate.
//
// Conservative on `session === null`: a new sign-in pull may restore
// settings before cards, so abstain rather than wipe a legitimate favourite.
async function resolveFavourite(): Promise<StoredFavourite | null> {
  const stored = loadFavourite();
  if (stored === null) return null;
  // Return the stored favourite as-is (grandfather: no auto-wipe on load).
  return stored;
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
    // Apply intensity synchronously from localStorage so the DOM attribute is
    // restored immediately after React's singleton-element acquisition removes
    // all <html> attributes during the commit phase. The async chain below
    // re-applies it once the IDB favourite lookup resolves.
    applyIntensity(loadSettings().themeIntensity);

    void resolveFavourite().then((stored) => {
      setFavourite(stored);
      applyTheme(stored?.colors ?? null);
      applyIntensity(loadSettings().themeIntensity);
    });

    function handleStorage(e: StorageEvent) {
      // The favourite theme lives inside the settings blob (#307). Watch
      // both keys so a legacy write (during the one-time migration window)
      // still triggers a refresh.
      if (e.key !== KEY_SETTINGS && e.key !== KEY_LEGACY_FAVOURITE_THEME) {
        return;
      }
      void resolveFavourite().then((updated) => {
        setFavourite(updated);
        applyTheme(updated?.colors ?? null);
        applyIntensity(loadSettings().themeIntensity);
      });
    }

    function handleSettingsSaved() {
      // Same-tab updates dispatched by saveSettings - cross-tab updates come
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
