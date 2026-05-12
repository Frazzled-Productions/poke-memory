"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { loadFavourite } from "@/lib/theme/persistence";
import { applyTheme } from "@/lib/theme/apply";
import type { StoredFavourite } from "@/lib/theme/persistence";

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
    const stored = loadFavourite();
    setFavourite(stored);
    applyTheme(stored?.colors ?? null);

    function handleStorage(e: StorageEvent) {
      // The favourite theme lives inside the settings blob (#307). Watch
      // both keys so a legacy write (during the one-time migration window)
      // still triggers a refresh.
      if (e.key !== "poke-memory:settings:v1" && e.key !== "poke-memory:favourite:v1") {
        return;
      }
      const updated = loadFavourite();
      setFavourite(updated);
      applyTheme(updated?.colors ?? null);
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return (
    <FavouriteContext.Provider value={{ favourite, updateFavourite }}>
      {children}
    </FavouriteContext.Provider>
  );
}
