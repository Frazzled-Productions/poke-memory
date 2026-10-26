"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { isHearted, setFavouritePokemon, toggleHeart } from "@/lib/favourite/favourite";
import { learnFirstSpeciesIds, markLearnFirstAsked, wasLearnFirstAsked } from "@/lib/favourite/learnFirst";
import { loadSession } from "@/lib/review/persistence";
import type { AppLocale } from "@/i18n/locales";
import { useStoredSettings } from "./useStoredSettings";

const TOGGLE_BASE =
  "inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2";
const TOGGLE_OFF =
  "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900";
const TOGGLE_ON = "border-rose-500 bg-rose-500 text-white";

/**
 * "Make favourite" and heart toggles on a Pokédex detail page (#2187),
 * silhouettes included. `name` labels the buttons: the localised name, or
 * the locked number label on a silhouette page. Setting an unmastered
 * favourite asks once, per species, whether to learn its evolution line next.
 */
export function FavouriteControls({
  speciesId,
  name,
  mastered,
}: {
  speciesId: number;
  name: string;
  /** Mastered at species level (or `pretendAllMastered`): no learn-first question. */
  mastered: boolean;
}) {
  const t = useTranslations("favourite");
  const settings = useStoredSettings();
  const [askingLearnFirst, setAskingLearnFirst] = useState(false);
  if (settings === null) return null;

  const isFavourite = settings.favouritePokemonId === speciesId;
  const hearted = isHearted(settings, speciesId);

  function handleFavourite() {
    const current = loadSettings();
    if (current.favouritePokemonId === speciesId) {
      saveSettings(setFavouritePokemon(current, null));
      setAskingLearnFirst(false);
      return;
    }
    saveSettings(setFavouritePokemon(current, speciesId));
    if (!mastered && !wasLearnFirstAsked(speciesId)) {
      markLearnFirstAsked(speciesId);
      setAskingLearnFirst(true);
    }
  }

  async function handleLearnFirstYes() {
    setAskingLearnFirst(false);
    const session = await loadSession();
    const current = loadSettings();
    const activeLocale = (current.activePokemonNameLocale ?? "en") as AppLocale;
    saveSettings({
      ...current,
      priorityNewSpeciesIds: learnFirstSpeciesIds(speciesId, session?.cards ?? [], activeLocale),
    });
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          aria-pressed={isFavourite}
          aria-label={t("makeFavouriteAria", { name })}
          onClick={handleFavourite}
          className={`${TOGGLE_BASE} ${isFavourite ? TOGGLE_ON : TOGGLE_OFF}`}
        >
          <span aria-hidden="true">★</span>
          {isFavourite ? t("isFavourite") : t("makeFavourite")}
        </button>
        <button
          type="button"
          aria-pressed={hearted}
          aria-label={isFavourite ? t("heartFavouriteAria", { name }) : t("heartAria", { name })}
          onClick={() => saveSettings(toggleHeart(loadSettings(), speciesId))}
          className={`${TOGGLE_BASE} ${hearted ? TOGGLE_ON : TOGGLE_OFF}`}
        >
          <span aria-hidden="true">{hearted ? "♥" : "♡"}</span>
        </button>
      </div>
      {askingLearnFirst && (
        <div
          role="group"
          aria-labelledby="learn-first-question"
          className="flex w-full max-w-xs flex-col items-center gap-2 rounded-lg border border-zinc-200 px-4 py-3 text-center dark:border-zinc-800"
        >
          <p id="learn-first-question" className="text-sm font-semibold text-foreground">
            {t("learnFirst.question", { name })}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("learnFirst.body")}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleLearnFirstYes()}
              className="min-h-[44px] rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
            >
              {t("learnFirst.yes")}
            </button>
            <button
              type="button"
              onClick={() => setAskingLearnFirst(false)}
              className="min-h-[44px] rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              {t("learnFirst.no")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
