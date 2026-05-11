"use client";

import { useEffect } from "react";
import { loadFavourite } from "@/lib/theme/persistence";
import { applyTheme } from "@/lib/theme/apply";

export function FavouriteThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    const stored = loadFavourite();
    applyTheme(stored?.colors ?? null);

    function handleStorage(e: StorageEvent) {
      if (e.key !== "poke-memory:favourite:v1") return;
      const updated = loadFavourite();
      applyTheme(updated?.colors ?? null);
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return <>{children}</>;
}
