"use client";

import styles from "./Biome.module.css";

/**
 * Urban habitat backdrop — dusk city skyline with windows lit, foreground
 * sidewalk with a street lamp and a Pokémon Center sign. Anchor bands
 * cluster sprites along the sidewalk and city park strip in front of the
 * buildings.
 */
export function UrbanBiome() {
  return (
    <svg
      className={styles.biome}
      viewBox="0 0 1600 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="urban-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"  stopColor="#3a4a72" />
          <stop offset="60%" stopColor="#8c7298" />
          <stop offset="100%" stopColor="#f0a55c" />
        </linearGradient>
        <linearGradient id="urban-street" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#5a5a66" />
          <stop offset="100%" stopColor="#2e2e3a" />
        </linearGradient>
      </defs>

      {/* Dusk sky */}
      <rect width="1600" height="600" fill="url(#urban-sky)" />

      {/* Distant stars */}
      <g fill="#ffffff">
        <circle cx="240" cy="50" r="1.5" />
        <circle cx="540" cy="40" r="1.2" />
        <circle cx="980" cy="60" r="1.5" />
        <circle cx="1340" cy="50" r="1.2" />
      </g>

      {/* Sun on horizon */}
      <circle cx="800" cy="320" r="46" fill="#ffd06a" opacity="0.55" />
      <circle cx="800" cy="320" r="26" fill="#ffe89c" />

      {/* Distant skyline silhouette */}
      <g fill="#2a2e44">
        <rect x="40"   y="280" width="60"  height="180" />
        <rect x="110"  y="240" width="80"  height="220" />
        <rect x="200"  y="290" width="50"  height="170" />
        <rect x="260"  y="220" width="90"  height="240" />
        <rect x="360"  y="270" width="70"  height="190" />
        <rect x="440"  y="200" width="100" height="260" />
        <rect x="550"  y="250" width="80"  height="210" />
        <rect x="640"  y="220" width="90"  height="240" />
        <rect x="740"  y="270" width="60"  height="190" />
        <rect x="820"  y="210" width="100" height="250" />
        <rect x="930"  y="240" width="80"  height="220" />
        <rect x="1020" y="200" width="110" height="260" />
        <rect x="1140" y="260" width="70"  height="200" />
        <rect x="1220" y="220" width="90"  height="240" />
        <rect x="1320" y="270" width="60"  height="190" />
        <rect x="1390" y="240" width="80"  height="220" />
        <rect x="1480" y="280" width="70"  height="180" />
      </g>

      {/* Lit windows */}
      <g fill="#ffd96a">
        {[
          [60, 320], [70, 360], [80, 400], [60, 380], [70, 420],
          [130, 280], [150, 310], [170, 340], [130, 370], [150, 400], [170, 430],
          [280, 260], [300, 290], [320, 320], [340, 260], [280, 320], [300, 360],
          [460, 240], [480, 280], [500, 320], [520, 360], [460, 400], [480, 420],
          [570, 280], [590, 320], [610, 360], [570, 400],
          [660, 260], [680, 300], [700, 340], [660, 380], [680, 420],
          [840, 250], [860, 290], [880, 330], [900, 250], [860, 380], [880, 420],
          [950, 280], [970, 320], [990, 360], [950, 400],
          [1040, 240], [1060, 280], [1080, 320], [1100, 360], [1040, 400],
          [1240, 260], [1260, 300], [1280, 340], [1260, 380],
          [1340, 300], [1360, 340],
          [1410, 280], [1430, 320], [1450, 360], [1430, 400],
          [1500, 320], [1520, 360],
        ].map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="6" height="8" />
        ))}
      </g>

      {/* Sidewalk + street */}
      <path
        d="M0,475 L1600,475 L1600,520 L0,520 Z"
        fill="#3a3a48"
      />
      <path
        d="M0,520 L1600,520 L1600,600 L0,600 Z"
        fill="url(#urban-street)"
      />
      {/* Street lane stripes */}
      <g fill="#ffd96a" opacity="0.8">
        <rect x="60"   y="555" width="40" height="6" />
        <rect x="160"  y="555" width="40" height="6" />
        <rect x="260"  y="555" width="40" height="6" />
        <rect x="360"  y="555" width="40" height="6" />
        <rect x="460"  y="555" width="40" height="6" />
        <rect x="560"  y="555" width="40" height="6" />
        <rect x="660"  y="555" width="40" height="6" />
        <rect x="760"  y="555" width="40" height="6" />
        <rect x="860"  y="555" width="40" height="6" />
        <rect x="960"  y="555" width="40" height="6" />
        <rect x="1060" y="555" width="40" height="6" />
        <rect x="1160" y="555" width="40" height="6" />
        <rect x="1260" y="555" width="40" height="6" />
        <rect x="1360" y="555" width="40" height="6" />
        <rect x="1460" y="555" width="40" height="6" />
      </g>
      {/* Sidewalk dividers */}
      <line x1="0" y1="475" x2="1600" y2="475" stroke="#1f1f28" strokeWidth="2" />
      <line x1="0" y1="520" x2="1600" y2="520" stroke="#1f1f28" strokeWidth="2" />

      {/* Street lamp — left */}
      <g>
        <rect x="138" y="380" width="6" height="100" fill="#3a3a48" />
        <rect x="120" y="376" width="42" height="8" fill="#3a3a48" />
        <ellipse cx="141" cy="372" rx="14" ry="10" fill="#ffe89c" />
        <ellipse cx="141" cy="372" rx="32" ry="20" fill="#ffe89c" opacity="0.25" />
      </g>

      {/* Street lamp — right */}
      <g>
        <rect x="1438" y="370" width="6" height="110" fill="#3a3a48" />
        <rect x="1420" y="366" width="42" height="8" fill="#3a3a48" />
        <ellipse cx="1441" cy="362" rx="14" ry="10" fill="#ffe89c" />
        <ellipse cx="1441" cy="362" rx="32" ry="20" fill="#ffe89c" opacity="0.25" />
      </g>

      {/* Pokémon Center sign */}
      <g transform="translate(720 380)">
        <rect x="-50" y="0" width="100" height="56" rx="8" fill="#ffffff" stroke="#1a1a1a" strokeWidth="2.5" />
        <rect x="-50" y="0" width="100" height="20" fill="#e64a3c" />
        <circle cx="0" cy="32" r="13" fill="#e64a3c" />
        <rect x="-14" y="29" width="28" height="6" fill="#1a1a1a" />
        <circle cx="0" cy="32" r="5" fill="#ffffff" stroke="#1a1a1a" strokeWidth="1.5" />
        <circle cx="0" cy="32" r="2" fill="#1a1a1a" />
        <rect x="-4" y="56" width="8" height="40" fill="#3a3a48" />
        <ellipse cx="0" cy="98" rx="14" ry="3" fill="#1a1a1a" opacity="0.5" />
      </g>

      {/* Small bushes in city park strip */}
      <g>
        <ellipse cx="320" cy="498" rx="32" ry="14" fill="#3a8c4a" stroke="#2a6a3a" strokeWidth="2" />
        <ellipse cx="310" cy="492" rx="14" ry="8"  fill="#5cb14e" />
        <ellipse cx="930" cy="500" rx="38" ry="16" fill="#3a8c4a" stroke="#2a6a3a" strokeWidth="2" />
        <ellipse cx="918" cy="492" rx="16" ry="9"  fill="#5cb14e" />
        <ellipse cx="1180" cy="498" rx="28" ry="12" fill="#3a8c4a" stroke="#2a6a3a" strokeWidth="2" />
      </g>

      {/* Building windows reflected light puddles on street */}
      <g fill="#ffd96a" opacity="0.15">
        <ellipse cx="141"  cy="540" rx="60" ry="6" />
        <ellipse cx="800"  cy="540" rx="100" ry="8" />
        <ellipse cx="1441" cy="540" rx="60" ry="6" />
      </g>
    </svg>
  );
}
