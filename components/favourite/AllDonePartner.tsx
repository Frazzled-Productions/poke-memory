"use client";

import { useTranslations } from "next-intl";
import { useSeed } from "@/lib/pokemon/SeedContext";
import { getSeedIfLoaded } from "@/lib/pokemon/seed-async";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";
import { playCry } from "@/lib/audio/cry";
import { POKEDEX_GRID_SPRITE_SIZE } from "@/lib/sprites/sizes";
import { cardPanelPadded, sectionLabelSubtle } from "@/lib/utils/class-names";
import { PartnerSprite } from "./PartnerSprite";
import { usePartner } from "./usePartner";

/**
 * The partner on the all-done screen, beside the Pokémon of the day (#2187).
 * Tapping it plays its cry once; arriving plays nothing. A species with no
 * cry is shown without a button. Nothing renders without a favourite.
 */
export function AllDonePartner() {
  const t = useTranslations("favourite.partner");
  const partner = usePartner();
  const seed = useSeed().seed ?? getSeedIfLoaded();
  const pokemon = partner ? seed?.seedPokemon.find((p) => p.id === partner.speciesId) : undefined;
  // eslint-disable-next-line no-restricted-syntax -- English-fallback argument to useLocalePokemonName, not a render value.
  const { name } = useLocalePokemonName(pokemon?.speciesId, pokemon?.displayName ?? "");
  if (!partner) return null;

  const sprite = (
    <PartnerSprite speciesId={partner.speciesId} mastered={partner.mastered} size={POKEDEX_GRID_SPRITE_SIZE} />
  );
  const cryUrl = pokemon?.cryUrl ?? null;

  return (
    <div className={`${cardPanelPadded} flex flex-col items-center gap-2 text-center`}>
      <p className={sectionLabelSubtle}>{t("heading")}</p>
      {cryUrl === null ? (
        sprite
      ) : (
        <button
          type="button"
          aria-label={t("playCry", { name })}
          onClick={() => playCry(cryUrl)}
          className="rounded-lg p-1 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:hover:bg-zinc-800"
        >
          {sprite}
        </button>
      )}
    </div>
  );
}
