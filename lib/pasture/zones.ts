/**
 * Static habitat-zone definitions for the Pasture page (#350).
 *
 * Zones map to PokéAPI `habitat` values. Coordinates are fractional [0, 1]
 * within a responsive block, so `left: ${x * 100}%` and `top: ${y * 100}%`
 * produce correct CSS positions regardless of container size.
 *
 * Slot counts per zone are sized to exceed the realistic maximum mastered
 * count for that habitat, with overflow handled by modular wrapping in
 * assignAnchors (two Pokémon may visually overlap rather than crashing).
 *
 * Habitat distribution in generated.json (1025 species total):
 *   null          → 639 species   → "unknown" fallback zone
 *   grassland     → 80            → 110+ slots
 *   forest        → 71            → 100+ slots
 *   waters-edge   → 47            → 65+ slots
 *   mountain      → 45            → 60+ slots
 *   sea           → 40            → 55+ slots
 *   urban         → 37            → 50+ slots
 *   cave          → 29            → 40+ slots
 *   rough-terrain → 27            → 40+ slots
 *   rare          → 10            → 20+ slots
 */

export type AnchorSlot = { x: number; y: number };

export type SubRegion = {
  id: string;
  name: string;
  anchorSlots: AnchorSlot[];
};

export type HabitatZone = {
  /** Matches PokéAPI pokemon-species.habitat.name exactly, or "unknown" for null. */
  habitat: string;
  label: string;
  subRegions: SubRegion[];
};

// ---------------------------------------------------------------------------
// Helper: generate a grid of anchor slots within a fractional bounding box,
// with a small jitter pattern so they look scattered rather than perfectly
// aligned. The bounding box is [x0, y0, x1, y1] in fractional coords.
// ---------------------------------------------------------------------------
function gridSlots(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cols: number,
  rows: number,
): AnchorSlot[] {
  const slots: AnchorSlot[] = [];
  const xStep = (x1 - x0) / cols;
  const yStep = (y1 - y0) / rows;
  // Jitter offsets alternate between four patterns to break up uniformity
  // without introducing randomness (deterministic, same on every render).
  const jitterX = [0.3, -0.2, 0.1, -0.3, 0.2, -0.1];
  const jitterY = [0.2, 0.3, -0.2, 0.1, -0.3, -0.1];
  let k = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const jx = jitterX[k % jitterX.length] * xStep;
      const jy = jitterY[k % jitterY.length] * yStep;
      const x = Math.min(0.97, Math.max(0.03, x0 + (c + 0.5) * xStep + jx));
      const y = Math.min(0.97, Math.max(0.03, y0 + (r + 0.5) * yStep + jy));
      slots.push({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
      k++;
    }
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Zone definitions
// ---------------------------------------------------------------------------

export const HABITAT_ZONES: readonly HabitatZone[] = [
  // -------------------------------------------------------------------
  // Grassland - 80 species → 90 slots, clustered in the ground band of
  // the illustrated biome scene. Five horizontal sub-bands sit at the
  // depths of the SVG terrain layers (distant hills → mid hills →
  // foreground ground), so sprites stand on terrain instead of floating
  // in the sky. PastureZone scales sprites by anchor.y for depth.
  // -------------------------------------------------------------------
  {
    habitat: "grassland",
    label: "Grasslands",
    subRegions: [
      {
        id: "grassland-distant-hills",
        name: "Distant Hills",
        anchorSlots: gridSlots(0.04, 0.56, 0.96, 0.62, 14, 1),  // 14 slots, smallest
      },
      {
        id: "grassland-rolling-hills",
        name: "Rolling Hills",
        anchorSlots: gridSlots(0.04, 0.66, 0.96, 0.72, 16, 1),  // 16 slots
      },
      {
        id: "grassland-meadow",
        name: "Sunlit Meadow",
        anchorSlots: gridSlots(0.04, 0.76, 0.96, 0.82, 18, 1),  // 18 slots
      },
      {
        id: "grassland-pasture",
        name: "Foreground Pasture",
        anchorSlots: gridSlots(0.04, 0.85, 0.96, 0.90, 20, 1),  // 20 slots
      },
      {
        id: "grassland-flowers",
        name: "Flower Patch",
        anchorSlots: gridSlots(0.05, 0.93, 0.95, 0.97, 22, 1),  // 22 slots → total 90
      },
    ],
  },

  // -------------------------------------------------------------------
  // Forest - 71 species → 80 slots clustered along the forest floor.
  // Bands map to ForestBiome layers: deepest = behind trunks, front =
  // by the fallen log and ferns.
  // -------------------------------------------------------------------
  {
    habitat: "forest",
    label: "Forest",
    subRegions: [
      {
        id: "forest-deep",
        name: "Deep Forest",
        anchorSlots: gridSlots(0.04, 0.56, 0.96, 0.62, 12, 1),
      },
      {
        id: "forest-canopy-edge",
        name: "Canopy Edge",
        anchorSlots: gridSlots(0.04, 0.66, 0.96, 0.72, 14, 1),
      },
      {
        id: "forest-clearing",
        name: "Clearing",
        anchorSlots: gridSlots(0.04, 0.76, 0.96, 0.82, 16, 1),
      },
      {
        id: "forest-floor",
        name: "Forest Floor",
        anchorSlots: gridSlots(0.04, 0.85, 0.96, 0.90, 18, 1),
      },
      {
        id: "forest-undergrowth",
        name: "Undergrowth",
        anchorSlots: gridSlots(0.05, 0.93, 0.95, 0.97, 20, 1),  // 12+14+16+18+20 = 80
      },
    ],
  },

  // -------------------------------------------------------------------
  // Sea - 40 species → 44 slots distributed through the water column
  // (surface → mid → reef → deep). Sea is full-vertical, not ground-band.
  // -------------------------------------------------------------------
  {
    habitat: "sea",
    label: "Open Sea",
    subRegions: [
      {
        id: "sea-surface",
        name: "Surface Waters",
        anchorSlots: gridSlots(0.05, 0.24, 0.95, 0.32, 10, 1),
      },
      {
        id: "sea-mid",
        name: "Open Column",
        anchorSlots: gridSlots(0.05, 0.45, 0.95, 0.55, 12, 1),
      },
      {
        id: "sea-reef",
        name: "Coral Reef",
        anchorSlots: gridSlots(0.05, 0.66, 0.95, 0.74, 12, 1),
      },
      {
        id: "sea-deep",
        name: "Seafloor",
        anchorSlots: gridSlots(0.05, 0.86, 0.95, 0.93, 10, 1),  // 10+12+12+10 = 44
      },
    ],
  },

  // -------------------------------------------------------------------
  // Cave - 29 species → 35 slots clustered on the cavern floor with one
  // band near the crystal hollow further back.
  // -------------------------------------------------------------------
  {
    habitat: "cave",
    label: "Cave",
    subRegions: [
      {
        id: "cave-crystal-hollow",
        name: "Crystal Hollow",
        anchorSlots: gridSlots(0.10, 0.65, 0.90, 0.71, 8, 1),
      },
      {
        id: "cave-deep",
        name: "Deep Cavern",
        anchorSlots: gridSlots(0.05, 0.78, 0.95, 0.84, 10, 1),
      },
      {
        id: "cave-floor",
        name: "Cavern Floor",
        anchorSlots: gridSlots(0.05, 0.88, 0.95, 0.92, 11, 1),
      },
      {
        id: "cave-foreground",
        name: "Entrance",
        anchorSlots: gridSlots(0.05, 0.95, 0.95, 0.97, 12, 1),  // 8+10+11+12 = 41
      },
    ],
  },

  // -------------------------------------------------------------------
  // Mountain - 45 species → 50 slots along the descending slopes and
  // foreground ridge of MountainBiome.
  // -------------------------------------------------------------------
  {
    habitat: "mountain",
    label: "Mountain",
    subRegions: [
      {
        id: "mountain-summit",
        name: "Summit Ridge",
        anchorSlots: gridSlots(0.10, 0.56, 0.90, 0.62, 8, 1),
      },
      {
        id: "mountain-slope",
        name: "Rocky Slope",
        anchorSlots: gridSlots(0.05, 0.68, 0.95, 0.74, 10, 1),
      },
      {
        id: "mountain-ridge",
        name: "Mountain Ridge",
        anchorSlots: gridSlots(0.05, 0.80, 0.95, 0.85, 12, 1),
      },
      {
        id: "mountain-base",
        name: "Mountain Base",
        anchorSlots: gridSlots(0.05, 0.92, 0.95, 0.96, 14, 1),  // 8+10+12+14 = 44
      },
    ],
  },

  // -------------------------------------------------------------------
  // Urban - 37 species → 45 slots along the sidewalk and street strip
  // of UrbanBiome, with one back row near the skyline base.
  // -------------------------------------------------------------------
  {
    habitat: "urban",
    label: "Urban",
    subRegions: [
      {
        id: "urban-skyline-base",
        name: "Skyline Base",
        anchorSlots: gridSlots(0.05, 0.75, 0.95, 0.79, 9, 1),
      },
      {
        id: "urban-sidewalk",
        name: "Sidewalk",
        anchorSlots: gridSlots(0.05, 0.83, 0.95, 0.86, 11, 1),
      },
      {
        id: "urban-street",
        name: "City Street",
        anchorSlots: gridSlots(0.05, 0.91, 0.95, 0.94, 13, 1),
      },
      {
        id: "urban-front",
        name: "Front Lane",
        anchorSlots: gridSlots(0.05, 0.96, 0.95, 0.98, 13, 1),  // 9+11+13+13 = 46
      },
    ],
  },

  // -------------------------------------------------------------------
  // Waters-edge - 47 species → 55 slots distributed along the far bank,
  // shallow marsh water, lily-pad row, and front shore of WatersEdgeBiome.
  // -------------------------------------------------------------------
  {
    habitat: "waters-edge",
    label: "Waters Edge",
    subRegions: [
      {
        id: "waters-edge-far-bank",
        name: "Far Bank",
        anchorSlots: gridSlots(0.05, 0.56, 0.95, 0.61, 9, 1),
      },
      {
        id: "waters-edge-marsh",
        name: "Marsh",
        anchorSlots: gridSlots(0.05, 0.72, 0.95, 0.77, 11, 1),
      },
      {
        id: "waters-edge-lily-pads",
        name: "Lily Pads",
        anchorSlots: gridSlots(0.05, 0.83, 0.95, 0.87, 13, 1),
      },
      {
        id: "waters-edge-shore",
        name: "Shore",
        anchorSlots: gridSlots(0.05, 0.92, 0.95, 0.96, 15, 1),  // 9+11+13+15 = 48
      },
    ],
  },

  // -------------------------------------------------------------------
  // Rough-terrain - 27 species → 35 slots along the lower mesa ledges
  // and cracked-earth foreground of RoughTerrainBiome.
  // -------------------------------------------------------------------
  {
    habitat: "rough-terrain",
    label: "Rough Terrain",
    subRegions: [
      {
        id: "rough-terrain-mesa",
        name: "Mesa Ledge",
        anchorSlots: gridSlots(0.05, 0.62, 0.95, 0.66, 7, 1),
      },
      {
        id: "rough-terrain-badlands",
        name: "Badlands",
        anchorSlots: gridSlots(0.05, 0.76, 0.95, 0.81, 9, 1),
      },
      {
        id: "rough-terrain-gorge",
        name: "Rocky Gorge",
        anchorSlots: gridSlots(0.05, 0.86, 0.95, 0.90, 10, 1),
      },
      {
        id: "rough-terrain-foreground",
        name: "Cracked Earth",
        anchorSlots: gridSlots(0.05, 0.93, 0.95, 0.97, 11, 1),  // 7+9+10+11 = 37
      },
    ],
  },

  // -------------------------------------------------------------------
  // Rare - 10 species → 14 slots clustered on the Sanctuary floor with
  // one row near the shrine.
  // -------------------------------------------------------------------
  {
    habitat: "rare",
    label: "Sanctuary",
    subRegions: [
      {
        id: "rare-shrine",
        name: "Crystal Shrine",
        anchorSlots: gridSlots(0.25, 0.66, 0.75, 0.70, 3, 1),
      },
      {
        id: "rare-arches",
        name: "Ancient Arches",
        anchorSlots: gridSlots(0.05, 0.78, 0.95, 0.83, 4, 1),
      },
      {
        id: "rare-floor",
        name: "Sanctuary Floor",
        anchorSlots: gridSlots(0.05, 0.88, 0.95, 0.92, 4, 1),
      },
      {
        id: "rare-front",
        name: "Front of Shrine",
        anchorSlots: gridSlots(0.10, 0.95, 0.90, 0.97, 4, 1),  // 3+4+4+4 = 15
      },
    ],
  },

  // -------------------------------------------------------------------
  // Unknown / null habitat - 639 species → 240 slots across 7 tightly
  // stacked ground bands matching the layered hills of WildlandsBiome.
  // Overflow wraps modularly; with 240 slots, the first ~37% of mastery
  // covers without visual overlap.
  // -------------------------------------------------------------------
  {
    habitat: "unknown",
    label: "Wildlands",
    subRegions: [
      {
        id: "wildlands-far-ridge",
        name: "Far Ridge",
        anchorSlots: gridSlots(0.04, 0.60, 0.96, 0.64, 24, 1),
      },
      {
        id: "wildlands-distant-hills",
        name: "Distant Hills",
        anchorSlots: gridSlots(0.04, 0.68, 0.96, 0.72, 28, 1),
      },
      {
        id: "wildlands-mid-hills",
        name: "Mid Hills",
        anchorSlots: gridSlots(0.04, 0.76, 0.96, 0.80, 32, 1),
      },
      {
        id: "wildlands-riverbank",
        name: "Riverbank",
        anchorSlots: gridSlots(0.04, 0.84, 0.96, 0.87, 36, 1),
      },
      {
        id: "wildlands-grassland",
        name: "Open Grassland",
        anchorSlots: gridSlots(0.03, 0.90, 0.97, 0.93, 40, 1),
      },
      {
        id: "wildlands-scrub",
        name: "Front Scrub",
        anchorSlots: gridSlots(0.03, 0.95, 0.97, 0.97, 40, 1),
      },
      {
        id: "wildlands-very-front",
        name: "Very Front",
        anchorSlots: gridSlots(0.03, 0.985, 0.97, 0.995, 40, 1),  // 24+28+32+36+40+40+40 = 240
      },
    ],
  },
] as const;
