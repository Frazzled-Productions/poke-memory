"use client";

import { useEffect, useState } from "react";
import { loadSession } from "@/lib/review/persistence";
import type { ReviewableCard } from "@/lib/review/session";
import { masteredSpeciesUnion } from "@/lib/theme/persistence";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { useSeed } from "@/lib/pokemon/SeedContext";
import { getSeedIfLoaded } from "@/lib/pokemon/seed-async";
import { KEY_REVIEW_SESSION } from "@/lib/storage/keys";
import { useStoredSettings } from "./useStoredSettings";

/**
 * Species mastered at species level in any enrolled locale (the #1865 theme
 * predicate), or every species under superuser `pretendAllMastered` (#2187).
 * Null while settings or the session are still loading.
 */
export function useMasteredSpecies(): ReadonlySet<number> | null {
  const settings = useStoredSettings();
  const { flags } = useSuperuser();
  const seed = useSeed().seed ?? getSeedIfLoaded();
  const sessionVersion = useLocalStorageKey(KEY_REVIEW_SESSION);
  const [cards, setCards] = useState<readonly ReviewableCard[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSession().then((session) => {
      if (!cancelled) setCards(session?.cards ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionVersion]);

  if (settings === null || cards === null) return null;
  if (flags.pretendAllMastered) {
    return new Set((seed?.seedPokemon ?? []).filter((p) => p.isDefaultForm).map((p) => p.id));
  }
  return masteredSpeciesUnion(cards, false, settings.learningLocales);
}
