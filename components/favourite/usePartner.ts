"use client";

import { useEffect, useState } from "react";
import { loadSession } from "@/lib/review/persistence";
import { KEY_REVIEW_SESSION } from "@/lib/storage/keys";
import type { ReviewableCard } from "@/lib/review/session";
import { masteredSpeciesUnion } from "@/lib/theme/persistence";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { useStoredSettings } from "./useStoredSettings";

export type Partner = {
  speciesId: number;
  /** Mastered at species level in any enrolled locale, or `pretendAllMastered` (#2187). */
  mastered: boolean;
};

/**
 * The player's favourite as a partner (#2187): null when there is no
 * favourite, undefined while settings or the session are still loading (so a
 * mastered partner never flashes as a silhouette). Mastery is the #1865 theme
 * predicate.
 */
export function usePartner(): Partner | null | undefined {
  const settings = useStoredSettings();
  const { flags } = useSuperuser();
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

  if (settings === null) return undefined;
  if (settings.favouritePokemonId === null) return null;
  if (cards === null) return undefined;
  const speciesId = settings.favouritePokemonId;
  const mastered =
    flags.pretendAllMastered ||
    masteredSpeciesUnion(cards, false, settings.learningLocales).has(speciesId);
  return { speciesId, mastered };
}
