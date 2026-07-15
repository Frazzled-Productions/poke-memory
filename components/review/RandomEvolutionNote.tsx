"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";
import { usePokemonLocaleContext } from "@/lib/i18n/PokemonLocaleContext";
import { RANDOM_BRANCH_NOTE_SPECIES } from "@/lib/pokemon/disambiguateTrigger";
import { mutedTextXs } from "@/lib/utils/class-names";

type Props = {
  /** Species ID of the forward evolution card's pre-evolution. */
  preEvoId: number;
  /** English fallback name for the pre-evolution - resolved through the locale hook. */
  preEvoName: string;
};

/**
 * Caption shown on forward evolution cards whose pre-evolution's sibling
 * branches are chosen by hidden in-game randomness (#1932) - currently only
 * Wurmple, which can become Silcoon or Cascoon depending on its personality
 * value. Both answers are correct in-game, so the card cannot (and must not)
 * prefer one - the note tells the learner the ambiguity is real rather than a
 * card bug.
 *
 * Renders `null` when `preEvoId` has no entry in
 * `RANDOM_BRANCH_NOTE_SPECIES` - callers gate on
 * `RANDOM_BRANCH_PRE_EVO_IDS.has(preEvoId)` and `direction === "evolution"`
 * before rendering this component (reverse-evolution cards name a unique
 * target and are unaffected).
 *
 * Every Pokémon name (pre-evo and both siblings) is resolved through
 * `useLocalePokemonName` rather than baked into the message catalogue, so the
 * note renders correctly in every Pokémon-name locale; each name is wrapped in
 * its own `lang`-tagged span when that locale differs from English.
 */
export function RandomEvolutionNote({ preEvoId, preEvoName }: Props) {
  const t = useTranslations("practice");
  const { locale } = usePokemonLocaleContext();
  const entry = RANDOM_BRANCH_NOTE_SPECIES[preEvoId];

  const { name: resolvedPreEvoName } = useLocalePokemonName(preEvoId, preEvoName);
  const { name: firstName } = useLocalePokemonName(
    entry?.firstId,
    entry?.firstName ?? "",
  );
  const { name: secondName } = useLocalePokemonName(
    entry?.secondId,
    entry?.secondName ?? "",
  );

  if (!entry) return null;

  const langAttr = locale !== "en" ? locale : undefined;
  const nameSpan = (chunks: ReactNode) => <span lang={langAttr}>{chunks}</span>;

  return (
    <p className={`mt-1 text-center ${mutedTextXs}`}>
      {t.rich("randomEvolutionNote", {
        preEvoTag: nameSpan,
        firstTag: nameSpan,
        secondTag: nameSpan,
        preEvoName: resolvedPreEvoName,
        firstName,
        secondName,
      })}
    </p>
  );
}
