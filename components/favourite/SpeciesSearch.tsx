"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useSeed } from "@/lib/pokemon/SeedContext";
import { getSeedIfLoaded } from "@/lib/pokemon/seed-async";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";
import { usePokemonLocaleContext } from "@/lib/i18n/PokemonLocaleContext";
import { getLocaleName, getTransliteration, loadLocaleNames } from "@/lib/pokemon/localeNames";
import type { TransliterationLocale } from "@/lib/pokemon/seed";
import { STATS_SPRITE_SIZE } from "@/lib/sprites/sizes";
import { colStack, mutedTextXs } from "@/lib/utils/class-names";

/** How many matches the search lists at once. */
const MAX_RESULTS = 12;

function SpeciesSearchRow({
  speciesId,
  englishName,
  spriteUrl,
  actionLabel,
  actionAria,
  onChoose,
}: {
  speciesId: number;
  englishName: string;
  spriteUrl: string;
  actionLabel: string;
  actionAria: (name: string) => string;
  onChoose: (speciesId: number) => void;
}) {
  const { name } = useLocalePokemonName(speciesId, englishName);
  return (
    <li className="flex items-center gap-3 py-1">
      <Image
        src={spriteUrl}
        alt=""
        width={STATS_SPRITE_SIZE}
        height={STATS_SPRITE_SIZE}
        className="h-12 w-12 object-contain"
      />
      <span className="flex-1 text-sm font-medium text-foreground">{name}</span>
      <button
        type="button"
        aria-label={actionAria(name)}
        onClick={() => onChoose(speciesId)}
        className="min-h-[36px] rounded-lg bg-foreground px-3 py-1 text-xs font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
      >
        {actionLabel}
      </button>
    </li>
  );
}

/**
 * A name search over a set of species (#2187), matching the English name and
 * the name (and transliteration) in the active learning locale. Lists the
 * first matches, each with one action button.
 */
export function SpeciesSearch({
  speciesIds,
  label,
  placeholder,
  noResults,
  actionLabel,
  actionAria,
  onChoose,
}: {
  speciesIds: ReadonlySet<number>;
  label: string;
  placeholder: string;
  noResults: string;
  actionLabel: string;
  actionAria: (name: string) => string;
  onChoose: (speciesId: number) => void;
}) {
  const seed = useSeed().seed ?? getSeedIfLoaded();
  const { locale } = usePokemonLocaleContext();
  const [query, setQuery] = useState("");
  // Re-render once the locale-names sidecar has loaded so locale matches work.
  const [, setNamesLoaded] = useState(false);
  useEffect(() => {
    if (locale === "en") return;
    let cancelled = false;
    void loadLocaleNames().then(() => {
      if (!cancelled) setNamesLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const q = query.trim().toLowerCase();
  const matches = (seed?.seedPokemon ?? []).filter((p) => {
    if (!p.isDefaultForm || !speciesIds.has(p.id)) return false;
    if (q === "") return true;
    if (p.name.toLowerCase().includes(q)) return true;
    if (locale === "en") return false;
    const localeName = getLocaleName(p.id, locale);
    if (localeName?.toLowerCase().includes(q)) return true;
    const translit = getTransliteration(p.id, locale as TransliterationLocale);
    return translit?.toLowerCase().includes(q) ?? false;
  });

  return (
    <div className={colStack}>
      <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
        {label}
        <input
          type="search"
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          className="rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm font-normal dark:border-zinc-700"
        />
      </label>
      {matches.length === 0 ? (
        <p className={mutedTextXs}>{noResults}</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {matches.slice(0, MAX_RESULTS).map((p) => (
            <SpeciesSearchRow
              key={p.id}
              speciesId={p.id}
              englishName={p.name}
              spriteUrl={p.spriteUrl}
              actionLabel={actionLabel}
              actionAria={actionAria}
              onChoose={onChoose}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
