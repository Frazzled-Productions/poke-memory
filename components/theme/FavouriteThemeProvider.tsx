"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { loadFavourite } from "@/lib/theme/persistence";
import { applyTheme } from "@/lib/theme/apply";
import type { StoredFavourite } from "@/lib/theme/persistence";

const FavouriteContext = createContext<StoredFavourite | null>(null);

export function useFavourite(): StoredFavourite | null {
  return useContext(FavouriteContext);
}

export function FavouriteThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [favourite, setFavourite] = useState<StoredFavourite | null>(null);

  useEffect(() => {
    const stored = loadFavourite();
    setFavourite(stored);
    applyTheme(stored?.colors ?? null);

    function handleStorage(e: StorageEvent) {
      if (e.key !== "poke-memory:favourite:v1") return;
      const updated = loadFavourite();
      setFavourite(updated);
      applyTheme(updated?.colors ?? null);
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return (
    <FavouriteContext.Provider value={favourite}>
      {children}
    </FavouriteContext.Provider>
  );
}
