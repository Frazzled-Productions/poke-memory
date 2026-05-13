"use client";

import type { HabitatZone, AnchorSlot } from "@/lib/pasture/zones";
import type { NameReviewCard } from "@/lib/review/session";
import { PasturePokemon } from "./PasturePokemon";
import styles from "./Pasture.module.css";

type Placement = {
  card: NameReviewCard;
  subRegion: { id: string; name: string };
  anchor: AnchorSlot;
};

type Props = {
  zone: HabitatZone;
  placements: Placement[];
  onMarkSeen: (cardId: number) => void;
};

/**
 * Colour tints keyed by PokéAPI habitat value. Each zone gets a distinct
 * background so users can visually tell habitats apart at a glance.
 */
const HABITAT_TINTS: Record<string, string> = {
  grassland:      "bg-green-100 dark:bg-green-950/50",
  forest:         "bg-emerald-200 dark:bg-emerald-950/60",
  sea:            "bg-blue-200 dark:bg-blue-950/60",
  cave:           "bg-zinc-300 dark:bg-zinc-800/80",
  mountain:       "bg-stone-300 dark:bg-stone-800/70",
  urban:          "bg-slate-200 dark:bg-slate-800/60",
  "waters-edge":  "bg-cyan-100 dark:bg-cyan-950/50",
  "rough-terrain":"bg-amber-200 dark:bg-amber-950/60",
  rare:           "bg-purple-100 dark:bg-purple-950/50",
  unknown:        "bg-zinc-100 dark:bg-zinc-900/60",
};

const LABEL_COLOURS: Record<string, string> = {
  grassland:      "text-green-800 dark:text-green-300",
  forest:         "text-emerald-900 dark:text-emerald-300",
  sea:            "text-blue-900 dark:text-blue-300",
  cave:           "text-zinc-700 dark:text-zinc-300",
  mountain:       "text-stone-700 dark:text-stone-300",
  urban:          "text-slate-700 dark:text-slate-300",
  "waters-edge":  "text-cyan-800 dark:text-cyan-300",
  "rough-terrain":"text-amber-800 dark:text-amber-300",
  rare:           "text-purple-800 dark:text-purple-300",
  unknown:        "text-zinc-700 dark:text-zinc-400",
};

export function PastureZone({ zone, placements, onMarkSeen }: Props) {
  const tint = HABITAT_TINTS[zone.habitat] ?? HABITAT_TINTS.unknown;
  const labelColour = LABEL_COLOURS[zone.habitat] ?? LABEL_COLOURS.unknown;

  return (
    <section aria-label={`${zone.label} zone`}>
      <h2 className={`mb-1.5 text-sm font-semibold ${labelColour}`}>
        {zone.label}
        <span className="ml-1.5 font-normal opacity-60">
          ({placements.length})
        </span>
      </h2>
      <div className={[styles.zoneContainer, tint].join(" ")}>
        {placements.map(({ card, anchor }) => (
          <div
            key={card.id}
            className={styles.spriteAnchor}
            style={{
              left: `${anchor.x * 100}%`,
              top:  `${anchor.y * 100}%`,
            }}
          >
            <PasturePokemon card={card} onMarkSeen={onMarkSeen} />
          </div>
        ))}
      </div>
    </section>
  );
}
