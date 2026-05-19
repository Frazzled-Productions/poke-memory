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
 * curvePath     — the SVG path data for the wavy edge, WITHOUT the closing
 *                 rectangle. Example:
 *                 "M0,440 C200,420 400,448 700,432 C1000,418 1300,448 1600,428"
 *                 The fill polygon appends "L1600,600 L0,600 Z" automatically.
 * fill          — fill value for the terrain polygon (colour or url(#id)).
 * strokeColor   — colour of the 1-px shadow stroke along the top edge.
 * strokeWidth   — width of the edge stroke (defaults to 3).
 * strokeOpacity — opacity of the edge stroke (defaults to 0.55).
 */

interface BiomeFloorProps {
  curvePath: string;
  fill: string;
  strokeColor: string;
  strokeWidth?: number;
  strokeOpacity?: number;
}

export function BiomeFloor({
  curvePath,
  fill,
  strokeColor,
  strokeWidth = 3,
  strokeOpacity = 0.55,
}: BiomeFloorProps) {
  const fillPath = `${curvePath} L1600,600 L0,600 Z`;
  return (
    <>
      <path d={fillPath} fill={fill} />
      <path
        d={curvePath}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        fill="none"
        opacity={strokeOpacity}
      />
    </>
  );
}
