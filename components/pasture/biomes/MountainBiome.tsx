"use client";

import styles from "./Biome.module.css";

/**
 * Mountain habitat backdrop — snow-capped peaks against a crisp sky,
 * rocky slopes descending to a foreground ridge with pines and boulders.
 * Anchor bands cluster sprites on the mid and lower slopes; the back
 * band sits just below the summit ridge.
 */
export function MountainBiome() {
  return (
    <svg
      className={styles.biome}
      viewBox="0 0 1600 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="mountain-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#7fc1e8" />
          <stop offset="100%" stopColor="#dcefff" />
        </linearGradient>
        <linearGradient id="mountain-rock" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#7a7e8c" />
          <stop offset="100%" stopColor="#4c5060" />
        </linearGradient>
        <linearGradient id="mountain-foreground" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#8a909e" />
          <stop offset="100%" stopColor="#52576a" />
        </linearGradient>
      </defs>

      {/* Sky */}
      <rect width="1600" height="600" fill="url(#mountain-sky)" />

      {/* Distant peaks (palest) */}
      <g>
        <polygon
          points="-50,360 200,180 400,300 700,170 900,290 1200,160 1400,290 1700,200 1700,400 -50,400"
          fill="#a7b7c8"
        />
        {/* Snow caps on distant peaks */}
        <polygon points="170,210 200,180 230,210 215,225 200,215 185,225" fill="#ffffff" />
        <polygon points="670,200 700,170 730,200 715,215 700,205 685,215" fill="#ffffff" />
        <polygon points="1170,190 1200,160 1230,190 1215,205 1200,195 1185,205" fill="#ffffff" />
      </g>

      {/* Mid peaks (darker, taller) */}
      <g>
        <polygon
          points="-50,430 100,300 320,380 500,260 720,360 920,250 1140,360 1360,280 1580,360 1700,330 1700,460 -50,460"
          fill="#6a7689"
        />
        {/* Snow */}
        <polygon points="78,330 100,300 122,330 110,344 100,335 90,344" fill="#ffffff" />
        <polygon points="480,290 500,260 520,290 510,302 500,294 490,302" fill="#ffffff" />
        <polygon points="900,280 920,250 940,280 928,294 920,286 910,294" fill="#ffffff" />
        <polygon points="1338,308 1360,280 1382,308 1370,322 1360,314 1350,322" fill="#ffffff" />
      </g>

      {/* Foreground rocky ridge */}
      <path
        d="M-50,490 L0,470 L80,500 L180,460 L300,495 L420,470 L560,495 L700,465 L850,495 L1000,470 L1140,500 L1280,460 L1420,495 L1550,475 L1700,485 L1700,600 L-50,600 Z"
        fill="url(#mountain-foreground)"
      />
      <path
        d="M-50,490 L0,470 L80,500 L180,460 L300,495 L420,470 L560,495 L700,465 L850,495 L1000,470 L1140,500 L1280,460 L1420,495 L1550,475 L1700,485"
        stroke="#2e3340" strokeWidth="3" fill="none" opacity="0.6"
      />

      {/* Patches of snow on foreground ridge */}
      <g fill="#ffffff" opacity="0.85">
        <ellipse cx="120"  cy="496" rx="28" ry="5" />
        <ellipse cx="380"  cy="490" rx="36" ry="5" />
        <ellipse cx="640"  cy="492" rx="32" ry="5" />
        <ellipse cx="940"  cy="492" rx="40" ry="5" />
        <ellipse cx="1240" cy="488" rx="34" ry="5" />
      </g>

      {/* Pine trees — distant on mid ridge */}
      <g>
        {[
          { x: 140, h: 36 }, { x: 220, h: 30 }, { x: 800, h: 38 }, { x: 1100, h: 32 },
        ].map((p, i) => (
          <g key={i} transform={`translate(${p.x} ${440 - p.h})`}>
            <rect x="-2" y={p.h - 4} width="4" height="10" fill="#3a2410" />
            <polygon
              points={`-${p.h * 0.4},${p.h} ${p.h * 0.4},${p.h} 0,0`}
              fill="#1f4a2a"
            />
            <polygon
              points={`-${p.h * 0.35},${p.h * 0.6} ${p.h * 0.35},${p.h * 0.6} 0,${-p.h * 0.1}`}
              fill="#2e6a3a"
            />
          </g>
        ))}
      </g>

      {/* Pine trees — foreground left + right (chunky) */}
      <g>
        {[
          { x: 80,   h: 110 },
          { x: 1530, h: 120 },
        ].map((p, i) => (
          <g key={i} transform={`translate(${p.x} ${510 - p.h})`}>
            <rect x="-7" y={p.h - 6} width="14" height="22" fill="#5a341a" stroke="#3a2410" strokeWidth="2" />
            <polygon
              points={`-${p.h * 0.4},${p.h} ${p.h * 0.4},${p.h} 0,0`}
              fill="#2e6a3a" stroke="#1a4a22" strokeWidth="2"
            />
            <polygon
              points={`-${p.h * 0.34},${p.h * 0.7} ${p.h * 0.34},${p.h * 0.7} 0,${p.h * 0.05}`}
              fill="#3d8e4f" stroke="#1a4a22" strokeWidth="2"
            />
            <polygon
              points={`-${p.h * 0.28},${p.h * 0.42} ${p.h * 0.28},${p.h * 0.42} 0,${-p.h * 0.05}`}
              fill="#4ea65f"
            />
          </g>
        ))}
      </g>

      {/* Boulders on foreground ridge */}
      <g>
        <g>
          <ellipse cx="460" cy="552" rx="56" ry="8" fill="#2e3340" opacity="0.45" />
          <ellipse cx="460" cy="535" rx="54" ry="22" fill="url(#mountain-rock)" stroke="#2e3340" strokeWidth="2" />
          <ellipse cx="446" cy="528" rx="18" ry="8" fill="#9aa0b0" opacity="0.8" />
        </g>
        <g>
          <ellipse cx="980" cy="558" rx="46" ry="7" fill="#2e3340" opacity="0.45" />
          <ellipse cx="980" cy="544" rx="44" ry="18" fill="url(#mountain-rock)" stroke="#2e3340" strokeWidth="2" />
          <ellipse cx="968" cy="538" rx="14" ry="6" fill="#9aa0b0" opacity="0.8" />
        </g>
        <g>
          <ellipse cx="1320" cy="556" rx="34" ry="6" fill="#2e3340" opacity="0.45" />
          <ellipse cx="1320" cy="544" rx="32" ry="14" fill="url(#mountain-rock)" stroke="#2e3340" strokeWidth="2" />
        </g>
      </g>

      {/* Tussocks of mountain grass */}
      <g stroke="#5a8e4a" strokeWidth="2.5" strokeLinecap="round" fill="none">
        {[
          [240, 580], [340, 570], [560, 580], [720, 570], [880, 580],
          [1080, 570], [1200, 580], [1420, 568],
        ].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <path d="M-6,8 Q-4,-4 0,-10" />
            <path d="M0,8 Q0,-6 2,-12" />
            <path d="M6,8 Q4,-4 8,-9" />
          </g>
        ))}
      </g>
    </svg>
  );
}
