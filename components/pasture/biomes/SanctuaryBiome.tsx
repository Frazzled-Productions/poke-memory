import { BiomeSvg } from "./BiomeSvg";
import { BiomeSky } from "./BiomeSky";
import { BiomeFloor } from "./BiomeFloor";

/**
 * Sanctuary (rare-habitat) backdrop - a starlit twilight sky with aurora
 * ribbons, a moon, ancient stone arches, and a glowing crystal shrine.
 * Reserved for legendary / mythical Pokémon.
 */
export function SanctuaryBiome() {
  return (
    <BiomeSvg>
      <defs>
        <radialGradient id="sanc-moon" cx="0.5" cy="0.5">
          <stop offset="0%"  stopColor="#ffffff" />
          <stop offset="70%" stopColor="#dcd1ff" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#dcd1ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sanc-aurora-a" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%"   stopColor="#5fe6c0" stopOpacity="0" />
          <stop offset="50%"  stopColor="#5fe6c0" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#5fe6c0" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="sanc-aurora-b" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%"   stopColor="#a06aff" stopOpacity="0" />
          <stop offset="50%"  stopColor="#a06aff" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#a06aff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="sanc-floor" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#3a2470" />
          <stop offset="100%" stopColor="#1f1240" />
        </linearGradient>
      </defs>

      {/* Sky */}
      <BiomeSky
        gradientId="sanc-sky"
        stops={[
          { offset: "0%",   stopColor: "#1a1442" },
          { offset: "50%",  stopColor: "#3a2470" },
          { offset: "100%", stopColor: "#6a3aa0" },
        ]}
      />

      {/* Aurora ribbons */}
      <path d="M0,180 Q400,140 800,200 T1600,180 L1600,250 Q1200,210 800,270 T0,250 Z" fill="url(#sanc-aurora-a)" />
      <path d="M0,240 Q400,200 800,260 T1600,240 L1600,300 Q1200,260 800,320 T0,300 Z" fill="url(#sanc-aurora-b)" />

      {/* Stars */}
      <g fill="#ffffff">
        {[
          [80, 60], [180, 100], [260, 70], [340, 120], [420, 80], [560, 110],
          [620, 60], [700, 90], [780, 60], [860, 110], [940, 80], [1080, 100],
          [1140, 60], [1240, 90], [1320, 60], [1420, 100], [1520, 80],
        ].map(([x, y], i) => (
          <circle key={`s-${i}`} cx={x} cy={y} r={1 + (i % 3) * 0.4} opacity={0.7 + (i % 3) * 0.1} />
        ))}
      </g>

      {/* Twinkle stars (4-point) */}
      <g fill="#ffffff" opacity="0.85">
        {[
          [220, 50], [480, 50], [880, 50], [1180, 50], [1400, 50],
        ].map(([x, y], i) => (
          <g key={`t-${i}`} transform={`translate(${x} ${y})`}>
            <path d="M0,-6 L1.5,-1.5 L6,0 L1.5,1.5 L0,6 L-1.5,1.5 L-6,0 L-1.5,-1.5 Z" />
          </g>
        ))}
      </g>

      {/* Moon */}
      <circle cx="240" cy="180" r="84" fill="url(#sanc-moon)" />
      <circle cx="240" cy="180" r="44" fill="#f4ecff" />
      <circle cx="222" cy="172" r="7"  fill="#dcd1ff" opacity="0.6" />
      <circle cx="252" cy="190" r="5"  fill="#dcd1ff" opacity="0.5" />

      {/* Floating motes */}
      <g fill="#ffe89c">
        <circle cx="600" cy="220" r="3" opacity="0.85" />
        <circle cx="720" cy="180" r="2" opacity="0.7" />
        <circle cx="940" cy="240" r="3" opacity="0.85" />
        <circle cx="1100" cy="200" r="2" opacity="0.7" />
        <circle cx="1280" cy="260" r="3" opacity="0.85" />
      </g>

      {/* Stone arch ruins - left */}
      <g>
        <g fill="#5a4870" stroke="#2e1f4a" strokeWidth="2.5">
          <rect x="380" y="350" width="22" height="160" />
          <rect x="500" y="360" width="22" height="150" />
          <path d="M380,350 Q450,300 522,360 L520,378 Q450,328 382,378 Z" />
        </g>
        {/* moss on arch */}
        <ellipse cx="450" cy="312" rx="40" ry="6" fill="#3ad29f" opacity="0.55" />
      </g>

      {/* Stone arch ruins - right */}
      <g>
        <g fill="#5a4870" stroke="#2e1f4a" strokeWidth="2.5">
          <rect x="1080" y="360" width="22" height="150" />
          <rect x="1200" y="370" width="22" height="140" />
          <path d="M1080,360 Q1150,310 1222,370 L1220,388 Q1150,338 1082,388 Z" />
        </g>
        <ellipse cx="1150" cy="322" rx="42" ry="6" fill="#3ad29f" opacity="0.55" />
      </g>

      {/* Glowing crystal shrine in center back */}
      <g>
        <ellipse cx="800" cy="440" rx="80" ry="10" fill="#ffe89c" opacity="0.35" />
        <rect x="770" y="400" width="60" height="40" fill="#3a2470" stroke="#1a0e3a" strokeWidth="2" />
        <polygon points="780,400 800,340 820,400" fill="#9b6cff" stroke="#5a3eff" strokeWidth="2" />
        <polygon points="795,400 800,346 805,400" fill="#cfa8ff" />
        <ellipse cx="800" cy="338" rx="22" ry="14" fill="#ffe89c" opacity="0.65" />
      </g>

      {/* Sanctuary floor */}
      <BiomeFloor
        curvePath="M0,460 C200,440 400,468 700,452 C1000,438 1300,468 1600,448"
        fill="url(#sanc-floor)"
        strokeColour="#1a0e3a"
        strokeOpacity={0.7}
      />

      {/* Glowing runes on the floor */}
      <g stroke="#7ddfff" strokeWidth="2.5" fill="none" opacity="0.8">
        <circle cx="160"  cy="540" r="14" />
        <path d="M150,540 L170,540 M160,530 L160,550" />
        <circle cx="500"  cy="555" r="12" />
        <path d="M490,555 L510,555 M500,545 L500,565" />
        <circle cx="1080" cy="555" r="12" />
        <path d="M1070,555 L1090,555 M1080,545 L1080,565" />
        <circle cx="1440" cy="540" r="14" />
        <path d="M1430,540 L1450,540 M1440,530 L1440,550" />
      </g>

      {/* Small floating crystals */}
      <g>
        <polygon points="320,540 326,524 332,540" fill="#9b6cff" stroke="#5a3eff" strokeWidth="1.5" />
        <polygon points="660,550 666,532 672,550" fill="#7ddfff" stroke="#3aa8d0" strokeWidth="1.5" />
        <polygon points="980,548 986,530 992,548" fill="#ff8edc" stroke="#a23e8e" strokeWidth="1.5" />
        <polygon points="1280,548 1286,530 1292,548" fill="#ffd060" stroke="#a07020" strokeWidth="1.5" />
      </g>
    </BiomeSvg>
  );
}
