"use client";

import { useSeed } from "@/lib/pokemon/SeedContext";
import { getSeedIfLoaded } from "@/lib/pokemon/seed-async";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";
import { spriteVariantUrl } from "@/lib/sprites/url";
import { POKEDEX_DETAIL_SPRITE_SIZE } from "@/lib/sprites/sizes";
import type { SharePartner } from "@/lib/share/generateShareImage";
import { usePartner } from "./usePartner";

/**
 * The favourite for the "Share today" and milestone images (#2187): its
 * localised name, a silhouette until mastered. Undefined with no favourite.
 * The sprite is the pre-generated WebP the offline precache already holds.
 */
export function useSharePartner(): SharePartner | undefined {
  const partner = usePartner();
  const seed = useSeed().seed ?? getSeedIfLoaded();
  const pokemon = partner ? seed?.seedPokemon.find((p) => p.id === partner.speciesId) : undefined;
  // eslint-disable-next-line no-restricted-syntax -- English-fallback argument to useLocalePokemonName, not a render value.
  const { name } = useLocalePokemonName(pokemon?.speciesId, pokemon?.displayName ?? "");
  if (!partner || !pokemon) return undefined;
  return {
    spriteUrl: spriteVariantUrl(partner.speciesId, POKEDEX_DETAIL_SPRITE_SIZE),
    name,
    silhouette: !partner.mastered,
  };
}
