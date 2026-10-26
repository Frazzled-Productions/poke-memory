"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSeed } from "@/lib/pokemon/SeedContext";
import { getSeedIfLoaded } from "@/lib/pokemon/seed-async";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { setFavouritePokemon } from "@/lib/favourite/favourite";
import { saveFavourite } from "@/lib/theme/persistence";
import { themeForSpecies } from "@/lib/theme/themeForSpecies";
import { useFavourite } from "@/components/theme/FavouriteThemeProvider";
import { STATS_SPRITE_SIZE } from "@/lib/sprites/sizes";
import { mutedText, mutedTextXs } from "@/lib/utils/class-names";
import { PartnerSprite } from "./PartnerSprite";
import { SpeciesSearch } from "./SpeciesSearch";
import { LearnFirstQuestion, makeFavourite } from "./LearnFirstQuestion";
import { FavouriteThemeOffer } from "./FavouriteThemeOffer";
import { useStoredSettings } from "./useStoredSettings";
import { useMasteredSpecies } from "./useMasteredSpecies";

const SECONDARY_BUTTON =
  "min-h-[36px] rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-400";

function useSeedPokemon(speciesId: number | null) {
  const seed = useSeed().seed ?? getSeedIfLoaded();
  return speciesId === null ? undefined : seed?.seedPokemon.find((p) => p.id === speciesId);
}

/** The localised name of a species, for use in a sentence. */
function useSpeciesName(speciesId: number | null): string {
  const pokemon = useSeedPokemon(speciesId);
  return useLocalePokemonName(pokemon?.speciesId, pokemon?.name ?? "").name;
}

/**
 * Settings: the favourite Pokémon (#2187). Shows the current favourite with
 * Clear, and a search over every species in the active learning locale.
 */
export function FavouritePokemonSection() {
  const t = useTranslations("settings.appearance.favourite");
  const tFavourite = useTranslations("favourite");
  const settings = useStoredSettings();
  const mastered = useMasteredSpecies();
  const seed = useSeed().seed ?? getSeedIfLoaded();
  const [asking, setAsking] = useState<number | null>(null);
  const favouriteId = settings?.favouritePokemonId ?? null;
  const favouriteName = useSpeciesName(favouriteId);
  const askingName = useSpeciesName(asking);
  if (settings === null) return null;

  const allSpecies = new Set((seed?.seedPokemon ?? []).filter((p) => p.isDefaultForm).map((p) => p.id));

  return (
    <div className="flex flex-col gap-3">
      <h3 id="favourite-heading" className="text-sm font-semibold text-foreground">
        {t("heading")}
      </h3>
      <p className={mutedTextXs}>{t("description")}</p>
      {favouriteId === null ? (
        <p className={mutedText}>{t("none")}</p>
      ) : (
        <div className="flex items-center gap-3">
          <PartnerSprite
            speciesId={favouriteId}
            mastered={mastered?.has(favouriteId) ?? false}
            size={STATS_SPRITE_SIZE}
          />
          <p className="flex-1 text-sm text-foreground">{t("current", { name: favouriteName })}</p>
          <button
            type="button"
            onClick={() => saveSettings(setFavouritePokemon(loadSettings(), null))}
            className={SECONDARY_BUTTON}
          >
            {t("clear")}
          </button>
        </div>
      )}
      {asking !== null && (
        <LearnFirstQuestion speciesId={asking} name={askingName} onDone={() => setAsking(null)} />
      )}
      <SpeciesSearch
        speciesIds={allSpecies}
        label={t("searchLabel")}
        placeholder={t("searchPlaceholder")}
        noResults={t("noResults")}
        actionLabel={tFavourite("makeFavourite")}
        actionAria={(name) => tFavourite("makeFavouriteAria", { name })}
        onChoose={(id) => setAsking(makeFavourite(id, mastered?.has(id) ?? false) ? id : null)}
      />
    </div>
  );
}

/**
 * Settings: the app theme (#2187), a mastery reward from any mastered
 * species. The current theme always shows with Remove (even when its mastery
 * has lapsed); "Match my favourite" appears once the favourite is mastered.
 * With nothing mastered, the locked state shows.
 */
export function ThemeSection() {
  const t = useTranslations("settings.appearance.theme");
  const tSearch = useTranslations("settings.appearance.favourite");
  const { updateFavourite } = useFavourite();
  const settings = useStoredSettings();
  const mastered = useMasteredSpecies();
  const seed = useSeed().seed ?? getSeedIfLoaded();
  const themeId = settings?.favouriteTheme?.id ?? null;
  const themeName = useSpeciesName(themeId);
  if (settings === null || mastered === null) return null;

  async function chooseTheme(speciesId: number) {
    const pokemon = seed?.seedPokemon.find((p) => p.id === speciesId);
    if (!pokemon) return;
    const theme = await themeForSpecies(pokemon);
    if (theme === null) return;
    saveFavourite(theme);
    updateFavourite(theme);
  }

  const favouriteId = settings.favouritePokemonId;
  const canMatchFavourite = favouriteId !== null && mastered.has(favouriteId) && themeId !== favouriteId;

  return (
    <div className="flex flex-col gap-3">
      <h3 id="theme-heading" className="text-sm font-semibold text-foreground">
        {mastered.size === 0 ? t("lockedHeading") : t("heading")}
      </h3>
      {themeId !== null && (
        <div className="flex items-center gap-3">
          <PartnerSprite speciesId={themeId} mastered size={STATS_SPRITE_SIZE} />
          <p className="flex-1 text-sm text-foreground">{t("current", { name: themeName })}</p>
          <button
            type="button"
            onClick={() => {
              saveFavourite(null);
              updateFavourite(null);
            }}
            className={SECONDARY_BUTTON}
          >
            {t("remove")}
          </button>
        </div>
      )}
      {mastered.size === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-background px-4 py-5 dark:border-zinc-800">
          <p className={mutedText}>{t("lockedBody")}</p>
          <Link
            href="/"
            className="mt-3 inline-block text-sm font-medium text-foreground underline underline-offset-2 hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
          >
            {t("practiceLink")}
          </Link>
        </div>
      ) : (
        <>
          <p className={mutedTextXs}>{t("description")}</p>
          <FavouriteThemeOffer />
          {canMatchFavourite && (
            <button
              type="button"
              onClick={() => void chooseTheme(favouriteId)}
              className="min-h-[44px] self-start rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
            >
              {t("matchFavourite")}
            </button>
          )}
          <SpeciesSearch
            speciesIds={mastered}
            label={t("searchLabel")}
            placeholder={tSearch("searchPlaceholder")}
            noResults={tSearch("noResults")}
            actionLabel={t("setAsTheme")}
            actionAria={(name) => t("setAsThemeAria", { name })}
            onChoose={(id) => void chooseTheme(id)}
          />
        </>
      )}
    </div>
  );
}
