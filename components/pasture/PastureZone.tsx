"use client";

import { useRef } from "react";
import type { HabitatZone } from "@/lib/pasture/zones";
import { PasturePokemon } from "./PasturePokemon";
import { GrasslandsBiome } from "./biomes/GrasslandsBiome";
import { ForestBiome } from "./biomes/ForestBiome";
import { SeaBiome } from "./biomes/SeaBiome";
import { CaveBiome } from "./biomes/CaveBiome";
import { MountainBiome } from "./biomes/MountainBiome";
import { UrbanBiome } from "./biomes/UrbanBiome";
import { WatersEdgeBiome } from "./biomes/WatersEdgeBiome";
import { RoughTerrainBiome } from "./biomes/RoughTerrainBiome";
import { SanctuaryBiome } from "./biomes/SanctuaryBiome";
import { WildlandsBiome } from "./biomes/WildlandsBiome";
import { useIdleBehaviour, type Placement } from "./useIdleBehaviour";
import styles from "./Pasture.module.css";

// Habitats with an illustrated backdrop. These suppress the flat HABITAT_TINTS
// fallback below so the SVG scene is the entire visual.
const BIOME_RENDERERS: Partial<Record<string, () => React.ReactElement>> = {
  grassland:       () => <GrasslandsBiome />,
  forest:          () => <ForestBiome />,
  sea:             () => <SeaBiome />,
  cave:            () => <CaveBiome />,
  mountain:        () => <MountainBiome />,
  urban:           () => <UrbanBiome />,
  "waters-edge":   () => <WatersEdgeBiome />,
  "rough-terrain": () => <RoughTerrainBiome />,
  rare:            () => <SanctuaryBiome />,
  unknown:         () => <WildlandsBiome />,
};

// Re-export the Placement type so consumers (e.g. the Pasture page) can import
// it from this module instead of from useIdleBehaviour directly.
export type { Placement };

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
  const biomeRenderer = BIOME_RENDERERS[zone.habitat];
  const tint = HABITAT_TINTS[zone.habitat] ?? HABITAT_TINTS.unknown;
  const labelColour = LABEL_COLOURS[zone.habitat] ?? LABEL_COLOURS.unknown;

  const zoneRef = useRef<HTMLDivElement>(null);
  useIdleBehaviour(zoneRef, placements);

  return (
    <section aria-label={`${zone.label} zone`}>
      <h2 className={`mb-1.5 text-sm font-semibold ${labelColour}`}>
        {zone.label}
        <span className="ml-1.5 font-normal opacity-60">
          ({placements.length})
        </span>
      </h2>
      <div
        ref={zoneRef}
        className={[styles.zoneContainer, biomeRenderer ? "" : tint].join(" ")}
      >
        {biomeRenderer ? biomeRenderer() : null}
        {(biomeRenderer
          // Sort back-to-front so foreground sprites paint on top of distant ones.
          ? [...placements].sort((a, b) => a.anchor.y - b.anchor.y)
          : placements
        ).map(({ card, anchor }) => {
          // Depth scale: lerp from 0.65 (back) to 1.15 (front), keyed off
          // the "ground-band" y range [0.55, 0.97]. Anchors above 0.55 (e.g.
          // sea-surface fish at y≈0.28) clamp to the minimum scale instead
          // of disappearing. Without a biome the zone is a flat colour box,
          // so no scaling.
          const t = Math.max(0, Math.min(1, (anchor.y - 0.55) / 0.42));
          const scale = biomeRenderer ? 0.65 + t * 0.50 : 1;
          return (
            <div
              key={card.id}
              className={styles.spriteAnchor}
              style={{
                left: `${anchor.x * 100}%`,
                top:  `${anchor.y * 100}%`,
                transform: `translate(-50%, -50%) scale(${scale})`,
              }}
            >
              {/*
               * spriteWander: the wander wrapper that useIdleBehaviour writes
               * CSS transforms on. Sits INSIDE .spriteAnchor so it does NOT
               * conflict with the existing left/top/scale positioning on the
               * anchor, nor with the bob/hop animation on the img inside
               * PasturePokemon.
               */}
              <div
                className={styles.spriteWander}
                data-sprite-id={card.id}
              >
                <PasturePokemon card={card} onMarkSeen={onMarkSeen} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
