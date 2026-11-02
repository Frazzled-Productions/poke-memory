"use client";

import { useTranslations } from "next-intl";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { setFavouritePokemon } from "@/lib/favourite/favourite";
import { learnFirstSpeciesIds, markLearnFirstAsked, wasLearnFirstAsked } from "@/lib/favourite/learnFirst";
import { loadSession } from "@/lib/review/persistence";
import type { AppLocale } from "@/i18n/locales";

/**
 * Make `speciesId` the favourite (#2187). Returns true when the learn-first
 * question should now be asked: the species is not mastered and the question
 * has not been asked for it before on this device (it is recorded as asked).
 */
export function makeFavourite(speciesId: number, mastered: boolean): boolean {
  saveSettings(setFavouritePokemon(loadSettings(), speciesId));
  if (mastered || wasLearnFirstAsked(speciesId)) return false;
  markLearnFirstAsked(speciesId);
  return true;
}

/**
 * "Learn <name>'s evolution line next?" (#2187): one neutral, opt-in
 * question. Yes puts the line's species not yet introduced in
 * `priorityNewSpeciesIds`; No changes nothing. Either answer calls `onDone`.
 */
export function LearnFirstQuestion({
  speciesId,
  name,
  onDone,
}: {
  speciesId: number;
  name: string;
  onDone: () => void;
}) {
  const t = useTranslations("favourite.learnFirst");

  async function handleYes() {
    onDone();
    const session = await loadSession();
    const current = loadSettings();
    const activeLocale = (current.activePokemonNameLocale ?? "en") as AppLocale;
    saveSettings({
      ...current,
      priorityNewSpeciesIds: learnFirstSpeciesIds(speciesId, session?.cards ?? [], activeLocale),
    });
  }

  return (
    <div
      role="group"
      aria-labelledby={`learn-first-question-${speciesId}`}
      className="flex w-full max-w-xs flex-col items-center gap-2 rounded-lg border border-zinc-200 px-4 py-3 text-center dark:border-zinc-800"
    >
      <p id={`learn-first-question-${speciesId}`} className="text-sm font-semibold text-foreground">
        {t("question", { name })}
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("body")}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleYes()}
          className="min-h-[44px] rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
        >
          {t("yes")}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="min-h-[44px] rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          {t("no")}
        </button>
      </div>
    </div>
  );
}
