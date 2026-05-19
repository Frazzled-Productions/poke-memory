import { BiomeSvg } from "./BiomeSvg";
import { BiomeSky } from "./BiomeSky";
import { BiomeFloor } from "./BiomeFloor";

/**
 * Wildlands (null-habitat) backdrop — a wide sunset panorama with many
 * layered hill silhouettes, a winding river, and mixed scrubland in
 * front. Sized to host the ~639-species fallback bucket, so the slot
 * grid in lib/pasture/zones.ts packs 7 tightly-stacked ground bands.
 */
export function WildlandsBiome() {
  return (
    <BiomeSvg>
      <defs>
        <linearGradient id="wl-foreground" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#4a6a3a" />
          <stop offset="100%" stopColor="#2a4a22" />
        </linearGradient>
        <radialGradient id="wl-sundisk" cx="0.5" cy="0.5">
          <stop offset="0%"  stopColor="#fff5a0" />
          <stop offset="60%" stopColor="#ffd060" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffd060" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Sky */}
      <BiomeSky
        gradientId="wl-sky"
        stops={[
          { offset: "0%",   stopColor: "#3a4a78" },
          { offset: "35%",  stopColor: "#a86fa0" },
          { offset: "70%",  stopColor: "#f0a55c" },
          { offset: "100%", stopColor: "#fde3a8" },
        ]}
      />

      {/* Sun on horizon */}
      <circle cx="800" cy="290" r="120" fill="url(#wl-sundisk)" />
      <circle cx="800" cy="290" r="56"  fill="#fff5a0" />

      {/* Sun reflection on horizon */}
      <g fill="#ffd060" opacity="0.55">
        <ellipse cx="800" cy="335" rx="80" ry="3" />
        <ellipse cx="800" cy="345" rx="60" ry="2" />
      </g>

      {/* Distant hill layer 1 — palest, far back */}
      <path
        d="M0,330 C150,300 320,318 500,308 C700,295 900,318 1100,300 C1300,285 1450,310 1600,300 L1600,360 L0,360 Z"
        fill="#9c80a0" opacity="0.85"
      />

      {/* Distant hill layer 2 */}
      <path
        d="M0,360 C200,320 400,348 700,335 C950,318 1200,348 1400,330 C1500,322 1600,340 1600,340 L1600,400 L0,400 Z"
        fill="#8a5e7a"
      />

      {/* Mid hill layer 3 */}
      <path
        d="M0,400 C200,365 400,388 600,375 C850,360 1100,395 1300,375 C1450,365 1600,388 1600,388 L1600,440 L0,440 Z"
        fill="#6a4a5a"
      />

      {/* Mid hill layer 4 */}
      <path
        d="M0,440 C200,408 400,432 600,420 C850,405 1100,438 1300,418 C1450,408 1600,430 1600,430 L1600,480 L0,480 Z"
        fill="#4a4a4a"
      />

      {/* Tree silhouettes on mid hills */}
      <g fill="#2a2a3a" opacity="0.8">
        {[
          { x: 140, y: 430, r: 8  },
          { x: 320, y: 425, r: 10 },
          { x: 540, y: 430, r: 9  },
          { x: 760, y: 425, r: 11 },
          { x: 1020, y: 430, r: 9 },
          { x: 1240, y: 425, r: 10 },
          { x: 1440, y: 430, r: 8 },
        ].map((t, i) => (
          <g key={i}>
            <circle cx={t.x} cy={t.y} r={t.r} />
            <rect x={t.x - 1.2} y={t.y + t.r - 1} width="2.4" height="6" />
          </g>
        ))}
      </g>

      {/* River winding across mid-ground */}
      <path
        d="M0,480 Q200,475 400,490 Q600,505 800,490 Q1000,478 1200,500 Q1400,518 1600,500 L1600,520 Q1400,538 1200,520 Q1000,498 800,510 Q600,525 400,510 Q200,495 0,500 Z"
        fill="#5fa8d0" stroke="#2a6a90" strokeWidth="2"
      />
      <g fill="#ffd060" opacity="0.65">
        <ellipse cx="780"  cy="500" rx="40" ry="2" />
        <ellipse cx="820"  cy="510" rx="30" ry="2" />
        <ellipse cx="860"  cy="498" rx="36" ry="2" />
      </g>

      {/* Foreground grassland */}
      <BiomeFloor
        curvePath="M0,520 C200,500 400,524 700,508 C1000,496 1300,524 1600,504"
        fill="url(#wl-foreground)"
        strokeColor="#1a2a14"
        strokeOpacity={0.65}
      />

      {/* Bushes / scrub in foreground */}
      <g>
        {[
          { x: 220,  y: 575, w: 36, h: 12 },
          { x: 460,  y: 580, w: 28, h: 10 },
          { x: 780,  y: 572, w: 42, h: 14 },
          { x: 1080, y: 580, w: 32, h: 12 },
          { x: 1380, y: 572, w: 38, h: 14 },
        ].map((b, i) => (
          <g key={i}>
            <ellipse cx={b.x} cy={b.y + b.h - 2} rx={b.w} ry={b.h * 0.4} fill="#1a2a14" opacity="0.45" />
            <ellipse cx={b.x} cy={b.y} rx={b.w} ry={b.h} fill="#3a6a3a" stroke="#1a4a22" strokeWidth="2" />
            <ellipse cx={b.x - b.w * 0.3} cy={b.y - b.h * 0.3} rx={b.w * 0.35} ry={b.h * 0.55} fill="#5cb14e" opacity="0.85" />
          </g>
        ))}
      </g>

      {/* Tall grass tufts scattered very densely */}
      <g stroke="#1a3a14" strokeWidth="2.2" strokeLinecap="round" fill="none">
        {[
          [80, 590],  [140, 582], [320, 588], [380, 580], [560, 590], [620, 582],
          [900, 588], [960, 580], [1180, 590], [1240, 582], [1480, 588], [1540, 580],
          [180, 575], [420, 575], [720, 575], [1020, 575], [1320, 575],
        ].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <path d="M-5,8 Q-3,-4 0,-10" />
            <path d="M0,8 Q0,-6 2,-12" />
            <path d="M5,8 Q3,-4 7,-9" />
          </g>
        ))}
      </g>

      {/* Wildflowers — small dots, multi-color */}
      <g>
        {[
          { x: 260,  c: "#e64a3c" }, { x: 500,  c: "#ffd060" }, { x: 700,  c: "#ff6ea8" },
          { x: 880,  c: "#e64a3c" }, { x: 1120, c: "#ffd060" }, { x: 1300, c: "#ff6ea8" },
          { x: 1500, c: "#e64a3c" },
        ].map((f, i) => (
          <circle key={i} cx={f.x} cy={585} r="2.5" fill={f.c} />
        ))}
      </g>
    </BiomeSvg>
  );
}
