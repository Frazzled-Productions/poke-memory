"use client";

import { useTranslations } from "next-intl";
import { useSeed } from "@/lib/pokemon/SeedContext";
import { getSeedIfLoaded } from "@/lib/pokemon/seed-async";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { themeForSpecies } from "@/lib/theme/themeForSpecies";
import { cardPanelPadded, mutedTextXs } from "@/lib/utils/class-names";
import { usePartner } from "./usePartner";
import { useStoredSettings } from "./useStoredSettings";

/**
 * "Switch to <name>'s colours?" (#2187): offered once per favourite, on the
 * all-done screen and in Settings, when the favourite is mastered and the
 * theme is not already it. Either answer records `favouriteThemeOfferedForId`
 * so it is not asked again for that species; No leaves the theme alone.
 *
 * Deliberately not shown under superuser `pretendAllMastered`: fake mastery
 * must not record the offer, or the real one would never come.
 */
export function FavouriteThemeOffer() {
  const t = useTranslations("favourite.themeOffer");
  const { flags } = useSuperuser();
  const settings = useStoredSettings();
  const partner = usePartner();
  const seed = useSeed().seed ?? getSeedIfLoaded();
  const pokemon = partner ? seed?.seedPokemon.find((p) => p.id === partner.speciesId) : undefined;
  // eslint-disable-next-line no-restricted-syntax -- English-fallback argument to useLocalePokemonName, not a render value.
  const { name } = useLocalePokemonName(pokemon?.speciesId, pokemon?.displayName ?? "");

  if (flags.pretendAllMastered || settings === null || !partner?.mastered || !pokemon) return null;
  if (settings.favouriteTheme?.id === partner.speciesId) return null;
  if (settings.favouriteThemeOfferedForId === partner.speciesId) return null;
  const speciesId = partner.speciesId;
  const species = pokemon;

  async function answer(accept: boolean) {
    const theme = accept ? await themeForSpecies(species) : null;
    const current = loadSettings();
    saveSettings({
      ...current,
      favouriteThemeOfferedForId: speciesId,
      ...(theme !== null ? { favouriteTheme: theme } : {}),
    });
  }

  return (
    <div
      role="group"
      aria-labelledby="favourite-theme-offer"
      className={`${cardPanelPadded} flex w-full max-w-xs flex-col items-center gap-2 text-center`}
    >
      <p id="favourite-theme-offer" className="text-sm font-semibold text-foreground">
        {t("question", { name })}
      </p>
      <p className={mutedTextXs}>{t("body", { name })}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => void answer(true)}
          className="min-h-[44px] rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
        >
          {t("yes")}
        </button>
        <button
          type="button"
          onClick={() => void answer(false)}
          className="min-h-[44px] rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          {t("no")}
        </button>
      </div>
    </div>
  );
}
