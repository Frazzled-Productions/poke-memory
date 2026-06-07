"use client";

import { useTranslations } from "next-intl";
import type { LegStatus } from "@/lib/stats/legStatus";

// Single source of truth for rendering one mastery leg's status (#1766).
// Both the Pasture popover (PasturePokemon) and the Pokédex detail panel
// (PokemonDetailDisclosure) render per-direction status; this component owns
// the status -> colour + i18n-label mapping so the two surfaces cannot drift.
// WCAG 1.4.1: colour is always paired with a text token, never colour alone.

const LEG_STATUS_CLASS: Record<LegStatus, string> = {
  mastered: "text-emerald-600 dark:text-emerald-400",
  learning: "text-amber-600 dark:text-amber-400",
  locked: "text-zinc-400 dark:text-zinc-500",
};

const LEG_STATUS_KEY: Record<LegStatus, "masteryMastered" | "masteryLearning" | "masteryLocked"> = {
  mastered: "masteryMastered",
  learning: "masteryLearning",
  locked: "masteryLocked",
};

/** Coloured, localised status text for a single mastery leg. */
export function LegStatusText({
  status,
  className = "",
}: {
  status: LegStatus;
  className?: string;
}) {
  const tJourney = useTranslations("journey");
  return (
    <span className={`${LEG_STATUS_CLASS[status]} ${className}`.trim()}>
      {tJourney(LEG_STATUS_KEY[status])}
    </span>
  );
}
