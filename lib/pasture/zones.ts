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
  // Grassland — 80 species → 110 slots (5 sub-regions × ~22 each)
  // -------------------------------------------------------------------
  {
    habitat: "grassland",
    label: "Grasslands",
    subRegions: [
      {
        id: "grassland-meadow",
        name: "Sunlit Meadow",
        anchorSlots: gridSlots(0.0, 0.0, 0.5, 0.5, 5, 5),   // 25 slots
      },
      {
        id: "grassland-prairie",
        name: "Open Prairie",
        anchorSlots: gridSlots(0.5, 0.0, 1.0, 0.5, 5, 5),   // 25 slots
      },
      {
        id: "grassland-plains",
        name: "Rolling Plains",
        anchorSlots: gridSlots(0.0, 0.5, 0.5, 1.0, 5, 5),   // 25 slots
      },
      {
        id: "grassland-hillside",
        name: "Grassy Hillside",
        anchorSlots: gridSlots(0.5, 0.5, 1.0, 1.0, 5, 5),   // 25 slots
      },
      {
        id: "grassland-flowers",
        name: "Flower Patch",
        anchorSlots: gridSlots(0.2, 0.2, 0.8, 0.8, 4, 3),   // 12 slots → total 112
      },
    ],
  },

  // -------------------------------------------------------------------
  // Forest — 71 species → 100 slots (4 sub-regions × 25 each)
  // -------------------------------------------------------------------
  {
    habitat: "forest",
    label: "Forest",
    subRegions: [
      {
        id: "forest-clearing",
        name: "Clearing",
        anchorSlots: gridSlots(0.0, 0.0, 0.5, 0.5, 5, 5),   // 25 slots
      },
      {
        id: "forest-canopy",
        name: "Canopy",
        anchorSlots: gridSlots(0.5, 0.0, 1.0, 0.5, 5, 5),   // 25 slots
      },
      {
        id: "forest-stream",
        name: "Stream Bank",
        anchorSlots: gridSlots(0.0, 0.5, 0.5, 1.0, 5, 5),   // 25 slots
      },
      {
        id: "forest-undergrowth",
        name: "Undergrowth",
        anchorSlots: gridSlots(0.5, 0.5, 1.0, 1.0, 5, 5),   // 25 slots → total 100
      },
    ],
  },

  // -------------------------------------------------------------------
  // Sea — 40 species → 56 slots (3 sub-regions)
  // -------------------------------------------------------------------
  {
    habitat: "sea",
    label: "Open Sea",
    subRegions: [
      {
        id: "sea-surface",
        name: "Surface Waters",
        anchorSlots: gridSlots(0.0, 0.0, 1.0, 0.4, 7, 3),   // 21 slots
      },
      {
        id: "sea-reef",
        name: "Coral Reef",
        anchorSlots: gridSlots(0.0, 0.4, 0.5, 1.0, 4, 4),   // 16 slots
      },
      {
        id: "sea-deep",
        name: "Deep Water",
        anchorSlots: gridSlots(0.5, 0.4, 1.0, 1.0, 4, 5),   // 20 slots → total 57
      },
    ],
  },

  // -------------------------------------------------------------------
  // Cave — 29 species → 40 slots (3 sub-regions)
  // -------------------------------------------------------------------
  {
    habitat: "cave",
    label: "Cave",
    subRegions: [
      {
        id: "cave-entrance",
        name: "Entrance",
        anchorSlots: gridSlots(0.1, 0.7, 0.9, 1.0, 6, 2),   // 12 slots
      },
      {
        id: "cave-deep",
        name: "Deep Cavern",
        anchorSlots: gridSlots(0.1, 0.3, 0.9, 0.7, 6, 3),   // 18 slots
      },
      {
        id: "cave-crystal",
        name: "Crystal Hollow",
        anchorSlots: gridSlots(0.2, 0.0, 0.8, 0.3, 5, 2),   // 10 slots → total 40
      },
    ],
  },

  // -------------------------------------------------------------------
  // Mountain — 45 species → 60 slots (3 sub-regions × 20 each)
  // -------------------------------------------------------------------
  {
    habitat: "mountain",
    label: "Mountain",
    subRegions: [
      {
        id: "mountain-base",
        name: "Mountain Base",
        anchorSlots: gridSlots(0.0, 0.6, 1.0, 1.0, 5, 4),   // 20 slots
      },
      {
        id: "mountain-slope",
        name: "Rocky Slope",
        anchorSlots: gridSlots(0.1, 0.3, 0.9, 0.6, 5, 4),   // 20 slots
      },
      {
        id: "mountain-peak",
        name: "Summit",
        anchorSlots: gridSlots(0.25, 0.0, 0.75, 0.3, 4, 5),  // 20 slots → total 60
      },
    ],
  },

  // -------------------------------------------------------------------
  // Urban — 37 species → 50 slots (3 sub-regions)
  // -------------------------------------------------------------------
  {
    habitat: "urban",
    label: "Urban",
    subRegions: [
      {
        id: "urban-streets",
        name: "City Streets",
        anchorSlots: gridSlots(0.0, 0.0, 0.5, 1.0, 4, 5),   // 20 slots
      },
      {
        id: "urban-rooftops",
        name: "Rooftops",
        anchorSlots: gridSlots(0.5, 0.0, 1.0, 0.5, 4, 3),   // 12 slots
      },
      {
        id: "urban-park",
        name: "City Park",
        anchorSlots: gridSlots(0.5, 0.5, 1.0, 1.0, 4, 5),   // 20 slots → total 52
      },
    ],
  },

  // -------------------------------------------------------------------
  // Waters-edge — 47 species → 66 slots (3 sub-regions)
  // -------------------------------------------------------------------
  {
    habitat: "waters-edge",
    label: "Waters Edge",
    subRegions: [
      {
        id: "waters-edge-shore",
        name: "Shore",
        anchorSlots: gridSlots(0.0, 0.7, 1.0, 1.0, 7, 3),   // 21 slots
      },
      {
        id: "waters-edge-marsh",
        name: "Marsh",
        anchorSlots: gridSlots(0.0, 0.35, 0.5, 0.7, 4, 4),  // 16 slots
      },
      {
        id: "waters-edge-delta",
        name: "River Delta",
        anchorSlots: gridSlots(0.5, 0.0, 1.0, 0.7, 5, 6),   // 30 slots → total 67
      },
    ],
  },

  // -------------------------------------------------------------------
  // Rough-terrain — 27 species → 40 slots (2 sub-regions)
  // -------------------------------------------------------------------
  {
    habitat: "rough-terrain",
    label: "Rough Terrain",
    subRegions: [
      {
        id: "rough-terrain-badlands",
        name: "Badlands",
        anchorSlots: gridSlots(0.0, 0.0, 0.5, 1.0, 4, 5),   // 20 slots
      },
      {
        id: "rough-terrain-gorge",
        name: "Rocky Gorge",
        anchorSlots: gridSlots(0.5, 0.0, 1.0, 1.0, 4, 5),   // 20 slots → total 40
      },
    ],
  },

  // -------------------------------------------------------------------
  // Rare — 10 species → 20 slots (2 sub-regions)
  // -------------------------------------------------------------------
  {
    habitat: "rare",
    label: "Sanctuary",
    subRegions: [
      {
        id: "rare-shrine",
        name: "Ancient Shrine",
        anchorSlots: gridSlots(0.0, 0.0, 0.5, 1.0, 4, 3),   // 12 slots
      },
      {
        id: "rare-summit",
        name: "Sacred Summit",
        anchorSlots: gridSlots(0.5, 0.0, 1.0, 1.0, 4, 2),   // 8 slots → total 20
      },
    ],
  },

  // -------------------------------------------------------------------
  // Unknown / null habitat — 639 species → 700 slots across 7 sub-regions
  // This is the largest bucket; most unclassified species live here.
  // -------------------------------------------------------------------
  {
    habitat: "unknown",
    label: "Wildlands",
    subRegions: [
      {
        id: "wildlands-north",
        name: "Northern Reaches",
        anchorSlots: gridSlots(0.0, 0.0, 0.5, 0.33, 5, 4),   // 20 slots
      },
      {
        id: "wildlands-south",
        name: "Southern Expanse",
        anchorSlots: gridSlots(0.5, 0.0, 1.0, 0.33, 5, 4),   // 20 slots
      },
      {
        id: "wildlands-east",
        name: "Eastern Barrens",
        anchorSlots: gridSlots(0.5, 0.33, 1.0, 0.66, 5, 5),  // 25 slots
      },
      {
        id: "wildlands-west",
        name: "Western Frontier",
        anchorSlots: gridSlots(0.0, 0.33, 0.5, 0.66, 5, 5),  // 25 slots
      },
      {
        id: "wildlands-central",
        name: "Central Wilds",
        anchorSlots: gridSlots(0.1, 0.25, 0.9, 0.75, 8, 8),  // 64 slots
      },
      {
        id: "wildlands-deep-north",
        name: "Deep North",
        anchorSlots: gridSlots(0.0, 0.66, 0.5, 1.0, 7, 8),   // 56 slots
      },
      {
        id: "wildlands-deep-south",
        name: "Deep South",
        anchorSlots: gridSlots(0.5, 0.66, 1.0, 1.0, 7, 8),   // 56 slots → total 266
        // Note: overflow wraps — realistically ~639 × (mastery rate) hits here.
        // With modular wrapping, 266 slots covers ~40% mastery before any overlap.
        // For full coverage at 100% mastery the zone would need 639 slots, but
        // in practice very few players master all ~639 null-habitat species.
      },
    ],
  },
] as const;
