"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useSeed } from "@/lib/pokemon/SeedContext";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";
import { pickDailySpecies, pickDailyFact } from "@/lib/pokemon/dailySpotlight";
import { loadFlavorTexts, getPokemonFacts, isFlavorTextsReady, type PokemonFact } from "@/lib/pokemon/facts";
import { todayInTimezone } from "@/lib/utils/format-date";
import { POKEDEX_DETAIL_SPRITE_SIZE } from "@/lib/sprites/sizes";
import { cardPanelPadded, mutedText, sectionLabelSubtle } from "@/lib/utils/class-names";
import { NameTtsButton } from "@/components/pokedex/NameTtsButton";

type Props = {
  /** The user's timezone (`user_settings.timezone`); used to derive the local day boundary. */
  timezone: string;
};

/**
 * Daily-rotating "Pokémon of the day" spotlight shown on the all-done /
 * zero-card end-of-session screen (#1949). Self-contained: reads the seed
 * from `SeedContext` directly rather than threading it through
 * `EndOfSessionScreen`'s prop list.
 *
 * The species and fact are picked deterministically from the local day
 * string (`todayInTimezone(timezone)`), so every session on the same day
 * shows the same spotlight, rotating the next day.
 */
export function DailySpotlight({ timezone }: Props) {
  const t = useTranslations("practice");
  const { seed } = useSeed();
  const [revealed, setRevealed] = useState(false);
  // Seed from the already-resolved cache when available, so the common case
  // (the user reaches the all-done screen after reviewing cards, which
  // pre-warms the flavour-text cache) doesn't pop in a tick late.
  const [factsReady, setFactsReady] = useState(isFlavorTextsReady());

  // Flavour text is lazy-loaded (generated-flavor.json). Wait for it before
  // computing the fact pool so the deterministic fact index is stable - the
  // facts list length changes once flavour text arrives, which would shift
  // the fnv1a-derived index mid-render. Only needed for the cold-cache case;
  // the initial state above already covers the warm-cache case.
  useEffect(() => {
    if (isFlavorTextsReady()) return;
    let cancelled = false;
    loadFlavorTexts().then(() => {
      if (!cancelled) setFactsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dateStr = todayInTimezone(timezone);
  const species = seed !== null ? pickDailySpecies(dateStr, seed.seedPokemon) : null;

  // eslint-disable-next-line no-restricted-syntax -- English-fallback argument to useLocalePokemonName, not a render value.
  const localeName = useLocalePokemonName(species?.speciesId, species?.displayName ?? "");

  if (species === null) return null;

  // Render the heading, sprite and reveal immediately - they need no flavour
  // data. Only the fact line waits for the lazy flavour-text load, so the
  // spotlight never blocks its whole render on a slow fetch (which made the
  // heading flaky on CI webkit prod builds, and delayed the whole card for
  // real users on a cold cache). The fact fills in once ready.
  const facts: PokemonFact[] = factsReady ? getPokemonFacts(species) : [];
  const fact = factsReady ? pickDailyFact(dateStr, facts) : null;

  return (
    <div className={`${cardPanelPadded} flex w-full max-w-xs flex-col items-center gap-2 text-center`}>
      <p className={sectionLabelSubtle}>{t("spotlightHeading")}</p>
      <Image
        src={species.spriteUrl}
        alt={revealed ? localeName.name : t("spotlightHiddenAlt")}
        width={POKEDEX_DETAIL_SPRITE_SIZE}
        height={POKEDEX_DETAIL_SPRITE_SIZE}
        className="h-48 w-48 object-contain"
      />
      {fact && (
        <div className="text-center">
          <span className={sectionLabelSubtle}>{fact.label}</span>
          <p className={`mt-0.5 max-w-xs ${mutedText}`}>{fact.value}</p>
        </div>
      )}
      {revealed ? (
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-center">
            <p className="text-lg font-semibold tracking-wide capitalize text-foreground">
              {localeName.name}
            </p>
            {localeName.transliteration && (
              <p className={mutedText}>{localeName.transliteration}</p>
            )}
          </div>
          <NameTtsButton name={localeName.name} id={species.speciesId} size="inline" />
        </div>
      ) : (
        <button
          type="button"
          className="min-h-[44px] rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          onClick={() => setRevealed(true)}
        >
          {t("spotlightRevealButton")}
        </button>
      )}
      {!revealed && <p className={mutedText}>{t("spotlightRevealPrompt")}</p>}
    </div>
  );
}
