"use client";

import Image from "next/image";
import { useSeed } from "@/lib/pokemon/SeedContext";
import { getSeedIfLoaded } from "@/lib/pokemon/seed-async";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";

/**
 * The favourite shown as the player's partner (#2187): its full sprite once
 * mastered at species level (or under superuser `pretendAllMastered`),
 * otherwise the Pokédex silhouette treatment, always with its localised name.
 * `size` is a constant from `lib/sprites/sizes.ts`.
 */
export function PartnerSprite({
  speciesId,
  mastered,
  size,
}: {
  speciesId: number;
  mastered: boolean;
  size: number;
}) {
  const { flags } = useSuperuser();
  const seed = useSeed().seed ?? getSeedIfLoaded();
  const pokemon = seed?.seedPokemon.find((p) => p.id === speciesId);
  // eslint-disable-next-line no-restricted-syntax -- English-fallback argument to useLocalePokemonName, not a render value.
  const { name } = useLocalePokemonName(speciesId, pokemon?.displayName ?? "");
  const full = mastered || flags.pretendAllMastered;

  return (
    <span className="flex flex-col items-center gap-1">
      <Image
        src={pokemon?.spriteUrl ?? `/sprites/pokemon/${speciesId}.png`}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={full ? "object-contain" : "object-contain brightness-0"}
      />
      <span className="text-sm font-semibold text-foreground">{name}</span>
    </span>
  );
}
