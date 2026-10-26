"use client";

import { useStoredSettings } from "./useStoredSettings";
import { useMasteredSpecies } from "./useMasteredSpecies";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";

export type Partner = {
  speciesId: number;
  /** Mastered at species level in any enrolled locale, or `pretendAllMastered` (#2187). */
  mastered: boolean;
};

/**
 * The player's favourite as a partner (#2187): null when there is no
 * favourite, undefined while settings or the session are still loading (so a
 * mastered partner never flashes as a silhouette).
 */
export function usePartner(): Partner | null | undefined {
  const settings = useStoredSettings();
  const mastered = useMasteredSpecies();
  const { flags } = useSuperuser();
  if (settings === null) return undefined;
  if (settings.favouritePokemonId === null) return null;
  if (mastered === null) return undefined;
  const speciesId = settings.favouritePokemonId;
  return { speciesId, mastered: flags.pretendAllMastered || mastered.has(speciesId) };
}
