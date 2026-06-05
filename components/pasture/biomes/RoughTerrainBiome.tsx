import { BiomeSvg } from "./BiomeSvg";
import { BiomeSky } from "./BiomeSky";
import { BiomeFloor } from "./BiomeFloor";

/**
 * Rough Terrain habitat backdrop - sunset over orange mesas with cracked
 * earth, scattered boulders, dry brush, and cacti. Anchor bands cluster
 * sprites along the lower mesa ledges and the foreground badlands.
 */
export function RoughTerrainBiome() {
  return (
    <BiomeSvg>
      <defs>
        <linearGradient id="rt-mesa-back" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#c6764a" />
          <stop offset="100%" stopColor="#a05832" />
        </linearGradient>
        <linearGradient id="rt-ground" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#d68a52" />
          <stop offset="100%" stopColor="#a05832" />
        </linearGradient>
      </defs>

      {/* Sunset sky */}
      <BiomeSky
        gradientId="rt-sky"
        stops={[
          { offset: "0%",   stopColor: "#f4a058" },
          { offset: "50%",  stopColor: "#f6c478" },
          { offset: "100%", stopColor: "#fde3a8" },
        ]}
      />

      {/* Sun */}
      <circle cx="780" cy="300" r="100" fill="#ffd060" opacity="0.45" />
      <circle cx="780" cy="300" r="58"  fill="#ffe89c" />

      {/* Distant mesa silhouettes */}
      <g>
        <path
          d="M0,380 L120,380 L140,330 L260,330 L280,380 L420,380 L440,340 L580,340 L600,380 L760,380 L780,310 L920,310 L940,380 L1100,380 L1120,335 L1280,335 L1300,380 L1460,380 L1480,355 L1600,355 L1600,420 L0,420 Z"
          fill="#a8542e" opacity="0.85"
        />
      </g>

      {/* Mid mesas - chunky stepped silhouettes */}
      <g>
        <path
          d="M0,460 L80,460 L100,400 L320,400 L340,460 L520,460 L540,420 L760,420 L780,380 L1000,380 L1020,420 L1240,420 L1260,460 L1440,460 L1460,410 L1600,410 L1600,500 L0,500 Z"
          fill="url(#rt-mesa-back)"
        />
        {/* mesa top edges */}
        <path
          d="M100,400 L320,400 M540,420 L760,420 M780,380 L1000,380 M1020,420 L1240,420 M1460,410 L1600,410"
          stroke="#7a3e1c" strokeWidth="3" fill="none" opacity="0.7"
        />
      </g>

      {/* Foreground rough ground */}
      <BiomeFloor
        curvePath="M0,500 C200,488 400,510 700,495 C1000,484 1300,512 1600,490"
        fill="url(#rt-ground)"
        strokeColour="#7a3e1c"
        strokeOpacity={0.65}
      />

      {/* Cracked earth lines */}
      <g stroke="#7a3e1c" strokeWidth="2" fill="none" opacity="0.5">
        <path d="M120,540 L160,560 L210,548 L250,580" />
        <path d="M380,548 L420,570 L460,558" />
        <path d="M680,558 L720,580 L760,565 L800,585" />
        <path d="M960,548 L1000,572 L1040,560" />
        <path d="M1240,560 L1280,582 L1320,568" />
      </g>

      {/* Boulders on foreground */}
      <g>
        <g>
          <ellipse cx="220" cy="572" rx="56" ry="8" fill="#5a2e16" opacity="0.55" />
          <ellipse cx="220" cy="556" rx="54" ry="22" fill="#a86040" stroke="#5a2e16" strokeWidth="2.5" />
          <ellipse cx="206" cy="548" rx="18" ry="8" fill="#d18a64" opacity="0.85" />
        </g>
        <g>
          <ellipse cx="1140" cy="570" rx="68" ry="9" fill="#5a2e16" opacity="0.55" />
          <ellipse cx="1140" cy="548" rx="66" ry="28" fill="#a86040" stroke="#5a2e16" strokeWidth="2.5" />
          <ellipse cx="1124" cy="540" rx="22" ry="10" fill="#d18a64" opacity="0.85" />
        </g>
        <g>
          <ellipse cx="900" cy="578" rx="32" ry="6" fill="#5a2e16" opacity="0.55" />
          <ellipse cx="900" cy="566" rx="30" ry="14" fill="#a86040" stroke="#5a2e16" strokeWidth="2.5" />
        </g>
      </g>

      {/* Cactus - left foreground */}
      <g transform="translate(420 540)">
        <ellipse cx="0" cy="40" rx="24" ry="5" fill="#5a2e16" opacity="0.5" />
        <rect x="-9" y="-10" width="18" height="50" rx="8" fill="#4ea142" stroke="#2a6a2a" strokeWidth="2.5" />
        <rect x="-22" y="2" width="13" height="22" rx="6.5" fill="#4ea142" stroke="#2a6a2a" strokeWidth="2.5" />
        <rect x="9" y="-2" width="13" height="22" rx="6.5" fill="#4ea142" stroke="#2a6a2a" strokeWidth="2.5" />
        {/* spines */}
        <g stroke="#1a4a1a" strokeWidth="1.2">
          <line x1="-9"  y1="0"  x2="-12" y2="-2" />
          <line x1="-9"  y1="14" x2="-12" y2="14" />
          <line x1="-9"  y1="28" x2="-12" y2="30" />
          <line x1="9"   y1="0"  x2="12"  y2="-2" />
          <line x1="9"   y1="14" x2="12"  y2="14" />
          <line x1="9"   y1="28" x2="12"  y2="30" />
        </g>
        {/* flower on top */}
        <circle cx="0" cy="-14" r="4" fill="#ff6ea8" stroke="#a02a60" strokeWidth="1.2" />
      </g>

      {/* Cactus - right foreground (smaller) */}
      <g transform="translate(1300 555)">
        <ellipse cx="0" cy="32" rx="18" ry="4" fill="#5a2e16" opacity="0.5" />
        <rect x="-7" y="-6" width="14" height="38" rx="6.5" fill="#4ea142" stroke="#2a6a2a" strokeWidth="2.5" />
        <rect x="-18" y="6" width="11" height="16" rx="5.5" fill="#4ea142" stroke="#2a6a2a" strokeWidth="2.5" />
        <g stroke="#1a4a1a" strokeWidth="1.2">
          <line x1="-7" y1="6"  x2="-10" y2="6" />
          <line x1="-7" y1="20" x2="-10" y2="22" />
          <line x1="7"  y1="6"  x2="10"  y2="6" />
          <line x1="7"  y1="20" x2="10"  y2="22" />
        </g>
      </g>

      {/* Tumbleweeds / dry brush */}
      <g>
        <g transform="translate(620 564)">
          <circle cx="0" cy="0" r="14" fill="none" stroke="#7a3e1c" strokeWidth="2" />
          <path d="M-12,-4 Q-4,-2 4,-8 M-10,4 Q-2,2 8,6 M-4,-10 Q4,-6 12,-2 M-8,8 Q0,4 8,10" stroke="#7a3e1c" strokeWidth="1.5" fill="none" />
        </g>
        <g transform="translate(1000 580)">
          <circle cx="0" cy="0" r="10" fill="none" stroke="#7a3e1c" strokeWidth="2" />
          <path d="M-8,-2 Q-2,-1 4,-6 M-6,2 Q0,1 6,4" stroke="#7a3e1c" strokeWidth="1.5" fill="none" />
        </g>
      </g>

      {/* Bird silhouettes far back */}
      <g fill="none" stroke="#5a2e16" strokeWidth="1.8">
        <path d="M340,180 q6,-8 12,0 q6,-8 12,0" />
        <path d="M400,200 q5,-6 10,0 q5,-6 10,0" />
        <path d="M1240,170 q5,-6 10,0 q5,-6 10,0" />
      </g>
    </BiomeSvg>
  );
}
