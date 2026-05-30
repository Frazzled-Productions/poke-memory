/**
 * Compact per-biome stats strip for the main Pasture page (#623).
 *
 * Renders inline next to the biome heading: species count, % captured,
 * and the most recently added Pokémon.
 */

"use client";

import { useTranslations } from "next-intl";
import type { BiomeStats } from "@/lib/pasture/stats";

type Props = {
  stats: BiomeStats;
  /** Tailwind colour token for secondary text in this biome's colour scheme. */
  className?: string;
};

/**
 * One-line stats strip: "12 / 71 · 17% · Latest: Metapod"
 *
 * Rendered as a `<dl>` with visually hidden `<dt>` labels so screen readers
 * can announce each value with its label, while sighted users see the compact
 * inline format.
 */
export function PastureBiomeStats({ stats, className = "" }: Props) {
  const t = useTranslations("pasture");
  const { masteredCount, totalCount, capturedPercent, latestAddition } = stats;

  return (
    <dl
      className={`flex flex-wrap items-center gap-x-2 gap-y-0 text-xs font-normal opacity-70 ${className}`}
      aria-label={t("biomeStats.ariaLabel")}
    >
      <div className="flex items-center gap-1">
        <dt className="sr-only">{t("biomeStats.mastered")}</dt>
        <dd>
          {masteredCount}
          <span className="opacity-60">/{totalCount}</span>
        </dd>
      </div>

      <div aria-hidden="true" className="opacity-40">·</div>

      <div className="flex items-center gap-1">
        <dt className="sr-only">{t("biomeStats.captured")}</dt>
        <dd>{capturedPercent}%</dd>
      </div>

      {latestAddition !== null && (
        <>
          <div aria-hidden="true" className="opacity-40">·</div>
          <div className="flex items-center gap-1">
            <dt className="sr-only">{t("biomeStats.latestAddition")}</dt>
            <dd className="truncate max-w-[12ch]">{latestAddition}</dd>
          </div>
        </>
      )}
    </dl>
  );
}
