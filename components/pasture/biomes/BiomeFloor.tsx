/**
 * Shared wavy terrain/floor layer used by 8 of the 10 biome backdrops
 * (Forest, Cave, Rough Terrain, Sanctuary, Wildlands, Waters Edge, Sea,
 * Grasslands). Cave, Sea, and Urban each have bespoke structural internals
 * but their floor polygons still share this same shape — only the path
 * co-ordinates and colours differ.
 *
 * Mountain and Urban do not use this component: Mountain's foreground is an
 * irregular rocky polygon with explicit vertex coordinates, and Urban's floor
 * is a pair of flat rectangular bands. Correctness takes priority over LOC
 * reduction for those two biomes.
 *
 * Pure static markup — no state, effects, or browser APIs.
 *
 * Props
 * ─────
 * curvePath     — the SVG path data for the wavy fill edge, WITHOUT the
 *                 closing rectangle. Example:
 *                 "M0,440 C200,420 400,448 700,432 C1000,418 1300,448 1600,428"
 *                 The fill polygon appends "L1600,600 L0,600 Z" automatically.
 * strokePath    — optional SVG path for the shadow-edge stroke. When omitted,
 *                 defaults to curvePath. Supply a different path when the
 *                 shadow edge must be offset from the fill edge (e.g. the
 *                 Forest biome strokes 5 px below its fill curve).
 * fill          — fill value for the terrain polygon (colour or url(#id)).
 * strokeColour  — colour of the shadow stroke along the top edge.
 * strokeWidth   — width of the edge stroke (defaults to 3).
 * strokeOpacity — opacity of the edge stroke (defaults to 0.55).
 */

interface BiomeFloorProps {
  curvePath: string;
  strokePath?: string;
  fill: string;
  strokeColour: string;
  strokeWidth?: number;
  strokeOpacity?: number;
}

export function BiomeFloor({
  curvePath,
  strokePath,
  fill,
  strokeColour,
  strokeWidth = 3,
  strokeOpacity = 0.55,
}: BiomeFloorProps) {
  const fillPath = `${curvePath} L1600,600 L0,600 Z`;
  const edgePath = strokePath ?? curvePath;
  return (
    <>
      <path d={fillPath} fill={fill} />
      <path
        d={edgePath}
        stroke={strokeColour}
        strokeWidth={strokeWidth}
        fill="none"
        opacity={strokeOpacity}
      />
    </>
  );
}
