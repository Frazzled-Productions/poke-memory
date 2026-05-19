import { BiomeSvg } from "./BiomeSvg";
import { BiomeSky } from "./BiomeSky";
import { BiomeFloor } from "./BiomeFloor";

/**
 * Cave habitat backdrop — dark rock interior with stalactites overhead,
 * stalagmites underfoot, glowing crystal clusters, and a small dim pool.
 * Anchor bands cluster sprites on the cavern floor with one row further
 * back near the crystal hollow.
 *
 * The stalactites, crystal clusters, pool, and stalagmites are bespoke to
 * this biome and are not shared with the other floor/sky helpers.
 */
export function CaveBiome() {
  return (
    <BiomeSvg>
      <defs>
        <linearGradient id="cave-floor" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#3a3445" />
          <stop offset="100%" stopColor="#1c1827" />
        </linearGradient>
        <radialGradient id="cave-crystal-glow" cx="0.5" cy="0.5">
          <stop offset="0%" stopColor="#b08aff" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#b08aff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="cave-pool" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#5a8fb5" />
          <stop offset="100%" stopColor="#2a4a6a" />
        </linearGradient>
      </defs>

      {/* Cavern interior */}
      <BiomeSky
        gradientId="cave-air"
        stops={[
          { offset: "0%",   stopColor: "#15121e" },
          { offset: "100%", stopColor: "#2a2438" },
        ]}
      />

      {/* Distant rock wall texture (irregular shading) */}
      <g fill="#1e1a28">
        <ellipse cx="200"  cy="200" rx="160" ry="80" />
        <ellipse cx="500"  cy="240" rx="190" ry="90" />
        <ellipse cx="900"  cy="200" rx="200" ry="90" />
        <ellipse cx="1300" cy="240" rx="180" ry="90" />
      </g>

      {/* Crystal hollow glow */}
      <ellipse cx="800" cy="220" rx="380" ry="160" fill="url(#cave-crystal-glow)" />

      {/* Stalactites — hanging from ceiling */}
      <g fill="#3a3445" stroke="#15121e" strokeWidth="1.5">
        <polygon points="80,0 100,80 120,0" />
        <polygon points="170,0 188,60 206,0" />
        <polygon points="260,0 280,100 300,0" />
        <polygon points="400,0 420,70 440,0" />
        <polygon points="530,0 552,110 574,0" />
        <polygon points="680,0 700,80 720,0" />
        <polygon points="830,0 852,90 874,0" />
        <polygon points="980,0 1000,70 1020,0" />
        <polygon points="1110,0 1132,100 1154,0" />
        <polygon points="1260,0 1280,80 1300,0" />
        <polygon points="1400,0 1420,60 1440,0" />
        <polygon points="1510,0 1530,90 1550,0" />
      </g>
      {/* Stalactite tip highlights */}
      <g fill="#5a5260" opacity="0.7">
        <polygon points="86,0 100,40 114,0" />
        <polygon points="266,0 280,50 294,0" />
        <polygon points="536,0 552,60 568,0" />
        <polygon points="836,0 852,45 868,0" />
        <polygon points="1116,0 1132,55 1148,0" />
        <polygon points="1266,0 1280,40 1294,0" />
      </g>

      {/* Crystal clusters — back-left */}
      <g>
        <polygon points="260,440 250,490 290,490 280,440" fill="#9b6cff" stroke="#5a3eff" strokeWidth="2" />
        <polygon points="280,440 270,500 310,500 300,440" fill="#b89bff" stroke="#5a3eff" strokeWidth="2" />
        <polygon points="300,450 295,500 320,500 315,450" fill="#7a4af0" stroke="#3a1eb0" strokeWidth="2" />
        {/* glow */}
        <ellipse cx="285" cy="490" rx="60" ry="10" fill="#b08aff" opacity="0.35" />
      </g>

      {/* Crystal clusters — center-back (around hollow) */}
      <g>
        <polygon points="760,400 750,460 790,460 780,400" fill="#7ddfff" stroke="#3aa8d0" strokeWidth="2" />
        <polygon points="780,400 770,470 815,470 805,400" fill="#a6e8ff" stroke="#3aa8d0" strokeWidth="2" />
        <polygon points="805,410 800,470 825,470 820,410" fill="#5fc8f0" stroke="#2a8ab0" strokeWidth="2" />
        <ellipse cx="788" cy="470" rx="70" ry="10" fill="#7dd5ff" opacity="0.35" />
      </g>

      {/* Crystal clusters — right */}
      <g>
        <polygon points="1300,420 1290,490 1330,490 1320,420" fill="#ff8edc" stroke="#a23e8e" strokeWidth="2" />
        <polygon points="1320,420 1310,500 1355,500 1345,420" fill="#ffaae0" stroke="#a23e8e" strokeWidth="2" />
        <polygon points="1345,430 1340,500 1365,500 1360,430" fill="#e74ab8" stroke="#7a2068" strokeWidth="2" />
        <ellipse cx="1325" cy="500" rx="60" ry="10" fill="#ff8edc" opacity="0.35" />
      </g>

      {/* Cavern floor */}
      <BiomeFloor
        curvePath="M0,470 C200,450 400,478 700,460 C1000,448 1300,478 1600,458"
        fill="url(#cave-floor)"
        strokeColor="#0a0814"
        strokeOpacity={0.7}
      />

      {/* Dim pool — front-left */}
      <g>
        <ellipse cx="220" cy="568" rx="140" ry="14" fill="#0a0814" opacity="0.5" />
        <ellipse cx="220" cy="564" rx="135" ry="11" fill="url(#cave-pool)" />
        <ellipse cx="220" cy="564" rx="135" ry="11" fill="none" stroke="#1a4060" strokeWidth="1.5" />
        <ellipse cx="180" cy="561" rx="20" ry="2" fill="#7dd5ff" opacity="0.5" />
      </g>

      {/* Stalagmites — rising from floor */}
      <g fill="#3a3445" stroke="#0a0814" strokeWidth="1.5">
        <polygon points="420,560 432,490 444,560" />
        <polygon points="480,565 490,520 500,565" />
        <polygon points="640,575 654,500 668,575" />
        <polygon points="970,580 985,495 1000,580" />
        <polygon points="1080,565 1090,525 1100,565" />
        <polygon points="1180,575 1196,498 1212,575" />
        <polygon points="1440,572 1455,505 1470,572" />
      </g>
      {/* Stalagmite tip highlights */}
      <g fill="#5a5260" opacity="0.7">
        <polygon points="426,565 432,520 438,565" />
        <polygon points="648,580 654,530 660,580" />
        <polygon points="979,585 985,525 991,585" />
        <polygon points="1190,580 1196,528 1202,580" />
      </g>

      {/* Small loose rocks on floor */}
      <g fill="#2a2438" stroke="#0a0814" strokeWidth="1.5">
        <circle cx="540" cy="580" r="9" />
        <circle cx="560" cy="586" r="6" />
        <circle cx="820" cy="586" r="7" />
        <circle cx="1340" cy="586" r="8" />
      </g>

      {/* Tiny crystals scattered */}
      <g>
        <polygon points="700,580 706,565 712,580" fill="#7ddfff" />
        <polygon points="880,585 886,570 892,585" fill="#9b6cff" />
        <polygon points="1240,580 1246,565 1252,580" fill="#ff8edc" />
      </g>
    </BiomeSvg>
  );
}
