"use client";

import styles from "./Biome.module.css";

/**
 * Illustrated backdrop for the Grasslands habitat zone. Layered SVG scene
 * (sky, sun, cell-shaded clouds, three hill layers, chunky trees, pond,
 * grass tufts, flowers, Pokéball detail) sized to fill its parent.
 * Decorative only — aria-hidden and pointer-events disabled.
 *
 * Hill profile coordinates (in 1600×600 viewBox) match the anchor bands
 * defined for "grassland" in lib/pasture/zones.ts so sprites stand on
 * terrain rather than floating mid-air.
 */
export function GrasslandsBiome() {
  return (
    <svg
      className={styles.biome}
      viewBox="0 0 1600 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="grasslands-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"  stopColor="#7cc8ff" />
          <stop offset="55%" stopColor="#c2e6ff" />
          <stop offset="100%" stopColor="#fff6b3" />
        </linearGradient>

        <radialGradient id="grasslands-sun" cx="0.5" cy="0.5">
          <stop offset="0%"  stopColor="#fff8c8" />
          <stop offset="55%" stopColor="#ffd84a" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffd24a" stopOpacity="0" />
        </radialGradient>

        <linearGradient id="grasslands-pond" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#9bdcff" />
          <stop offset="100%" stopColor="#5fb8e6" />
        </linearGradient>
      </defs>

      {/* Sky */}
      <rect width="1600" height="600" fill="url(#grasslands-sky)" />

      {/* Sun: soft halo + bright core */}
      <circle cx="1340" cy="130" r="140" fill="url(#grasslands-sun)" />
      <circle cx="1340" cy="130" r="62"  fill="#fff5a0" />
      <circle cx="1340" cy="130" r="62"  fill="none" stroke="#ffd84a" strokeWidth="3" opacity="0.6" />

      {/* Cell-shaded clouds — multi-lobe with subtle outline */}
      <g stroke="#cfe8ff" strokeWidth="2.5">
        {/* Cloud 1 */}
        <g fill="#ffffff">
          <ellipse cx="180" cy="100" rx="86" ry="24" />
          <ellipse cx="170" cy="78"  rx="54" ry="20" />
          <ellipse cx="220" cy="82"  rx="42" ry="16" />
        </g>
        {/* Cloud 2 */}
        <g fill="#ffffff">
          <ellipse cx="620" cy="120" rx="100" ry="26" />
          <ellipse cx="600" cy="96"  rx="62"  ry="22" />
          <ellipse cx="660" cy="100" rx="50"  ry="18" />
        </g>
        {/* Cloud 3 */}
        <g fill="#ffffff">
          <ellipse cx="980" cy="80"  rx="70" ry="20" />
          <ellipse cx="960" cy="62"  rx="44" ry="16" />
        </g>
        {/* Cloud 4 */}
        <g fill="#ffffff">
          <ellipse cx="1090" cy="160" rx="78" ry="20" />
          <ellipse cx="1110" cy="142" rx="48" ry="16" />
        </g>
      </g>

      {/* Distant rolling hills */}
      <path
        d="M0,330 C200,270 400,310 700,290 C950,270 1200,330 1400,300 C1500,285 1600,310 1600,310 L1600,430 L0,430 Z"
        fill="#b7e0a8"
      />
      <path
        d="M0,330 C200,270 400,310 700,290 C950,270 1200,330 1400,300 C1500,285 1600,310 1600,310"
        stroke="#7fbf6a" strokeWidth="3" fill="none" opacity="0.55"
      />

      {/* Mid hills */}
      <path
        d="M0,420 C150,370 350,395 560,378 C820,355 1080,415 1300,380 C1450,360 1600,395 1600,395 L1600,510 L0,510 Z"
        fill="#7ec56e"
      />
      <path
        d="M0,420 C150,370 350,395 560,378 C820,355 1080,415 1300,380 C1450,360 1600,395 1600,395"
        stroke="#4f9a44" strokeWidth="3" fill="none" opacity="0.6"
      />

      {/* Foreground ground — main playing field */}
      <path
        d="M0,470 C200,450 400,478 700,462 C1000,448 1300,478 1600,458 L1600,600 L0,600 Z"
        fill="#5dba4f"
      />
      <path
        d="M0,470 C200,450 400,478 700,462 C1000,448 1300,478 1600,458"
        stroke="#3a8f30" strokeWidth="3.5" fill="none" opacity="0.7"
      />

      {/* Foreground ground highlight band — adds painterly depth */}
      <path
        d="M0,475 C200,455 400,483 700,467 C1000,453 1300,483 1600,463 L1600,520 L0,520 Z"
        fill="#7bd06b" opacity="0.5"
      />

      {/* Pond on the right-middle foreground */}
      <g>
        <ellipse cx="1180" cy="555" rx="120" ry="22" fill="#3a8f30" opacity="0.5" />
        <ellipse cx="1180" cy="550" rx="115" ry="19" fill="url(#grasslands-pond)" />
        <ellipse cx="1180" cy="550" rx="115" ry="19" fill="none" stroke="#3a8f30" strokeWidth="2" opacity="0.7" />
        {/* shimmer */}
        <ellipse cx="1140" cy="546" rx="22" ry="2.5" fill="#ffffff" opacity="0.6" />
        <ellipse cx="1210" cy="552" rx="16" ry="2"   fill="#ffffff" opacity="0.5" />
      </g>

      {/* Distant tree silhouettes on mid hills */}
      <g>
        {[
          { cx: 250,  cy: 425, r: 22, tx: 247,  ty: 446, th: 16 },
          { cx: 295,  cy: 432, r: 16, tx: 292,  ty: 449, th: 12 },
          { cx: 1180, cy: 418, r: 24, tx: 1177, ty: 437, th: 18 },
          { cx: 1225, cy: 430, r: 17, tx: 1222, ty: 448, th: 14 },
        ].map((t, i) => (
          <g key={i}>
            <rect x={t.tx} y={t.ty} width="6" height={t.th} fill="#7a4a22" />
            <circle cx={t.cx} cy={t.cy} r={t.r}     fill="#5da651" />
            <circle cx={t.cx} cy={t.cy} r={t.r - 1} fill="none" stroke="#3a8f30" strokeWidth="2" opacity="0.55" />
            <circle cx={t.cx - 6} cy={t.cy - 4} r={t.r * 0.45} fill="#80c372" opacity="0.85" />
          </g>
        ))}
      </g>

      {/* Foreground tree — left (chunky, multi-bushel canopy) */}
      <g>
        <rect x="78" y="500" width="20" height="60" fill="#7a4a22" />
        <rect x="78" y="500" width="20" height="60" fill="none" stroke="#5a341a" strokeWidth="2" />
        <g>
          <circle cx="88"  cy="478" r="48" fill="#4ea142" />
          <circle cx="64"  cy="470" r="28" fill="#4ea142" />
          <circle cx="112" cy="472" r="30" fill="#4ea142" />
          <circle cx="88"  cy="468" r="22" fill="#67be58" />
          <circle cx="72"  cy="462" r="14" fill="#83d472" />
          <circle cx="100" cy="460" r="12" fill="#83d472" />
        </g>
        <path
          d="M40,485 Q88,420 136,485"
          fill="none" stroke="#2e7a25" strokeWidth="3" opacity="0.45"
        />
      </g>

      {/* Foreground tree — right */}
      <g>
        <rect x="1488" y="505" width="22" height="62" fill="#7a4a22" />
        <rect x="1488" y="505" width="22" height="62" fill="none" stroke="#5a341a" strokeWidth="2" />
        <g>
          <circle cx="1500" cy="482" r="54" fill="#4ea142" />
          <circle cx="1472" cy="472" r="30" fill="#4ea142" />
          <circle cx="1528" cy="472" r="32" fill="#4ea142" />
          <circle cx="1500" cy="472" r="24" fill="#67be58" />
          <circle cx="1480" cy="464" r="14" fill="#83d472" />
          <circle cx="1518" cy="462" r="14" fill="#83d472" />
        </g>
      </g>

      {/* Pokéball detail — sitting on the grass, left of pond */}
      <g transform="translate(330 575)">
        {/* shadow */}
        <ellipse cx="0" cy="14" rx="20" ry="3.5" fill="#2e7a25" opacity="0.45" />
        {/* ball */}
        <circle cx="0" cy="0" r="14" fill="#ffffff" />
        <path d="M-14,0 A14,14 0 0,1 14,0 Z" fill="#e64a3c" />
        <line x1="-14" y1="0" x2="14" y2="0" stroke="#1a1a1a" strokeWidth="2.2" />
        <circle cx="0" cy="0" r="4.2" fill="#ffffff" stroke="#1a1a1a" strokeWidth="2" />
        <circle cx="0" cy="0" r="1.6" fill="#1a1a1a" />
        {/* highlight */}
        <ellipse cx="-5" cy="-6" rx="3" ry="2" fill="#ffffff" opacity="0.85" />
      </g>

      {/* Grass tufts — denser, more saturated, scattered */}
      <g stroke="#2a6a22" strokeWidth="2.8" strokeLinecap="round" fill="none">
        {[
          [50, 562], [110, 580], [170, 555], [240, 583], [310, 562],
          [380, 588], [450, 560], [520, 585], [590, 565], [670, 582],
          [740, 562], [810, 588], [870, 560], [940, 585], [1010, 565],
          [1080, 588], [1300, 588], [1370, 562], [1430, 585],
        ].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <path d="M-7,8 Q-5,-4 -1,-11" />
            <path d="M0,8 Q0,-6 2,-13" />
            <path d="M7,8 Q5,-4 9,-10" />
          </g>
        ))}
      </g>

      {/* Flowers — red */}
      <g>
        {[
          [200, 568], [400, 575], [620, 568], [860, 572], [1050, 575], [1410, 572],
        ].map(([cx, cy], i) => (
          <g key={i} transform={`translate(${cx} ${cy})`}>
            <line x1="0" y1="0" x2="0" y2="11" stroke="#2a6a22" strokeWidth="1.8" />
            <circle cx="-3.5" cy="-2" r="3"   fill="#e64a3c" />
            <circle cx="3.5"  cy="-2" r="3"   fill="#e64a3c" />
            <circle cx="0"    cy="-6" r="3"   fill="#e64a3c" />
            <circle cx="0"    cy="-1" r="2"   fill="#ffe96b" />
          </g>
        ))}
      </g>

      {/* Flowers — yellow */}
      <g>
        {[
          [280, 580], [540, 565], [800, 578], [1020, 565], [1340, 580],
        ].map(([cx, cy], i) => (
          <g key={i} transform={`translate(${cx} ${cy})`}>
            <line x1="0" y1="0" x2="0" y2="10" stroke="#2a6a22" strokeWidth="1.8" />
            <circle cx="-3" cy="-2" r="2.6" fill="#ffd83a" />
            <circle cx="3"  cy="-2" r="2.6" fill="#ffd83a" />
            <circle cx="0"  cy="-5" r="2.6" fill="#ffd83a" />
            <circle cx="0"  cy="-1" r="1.8" fill="#e98c30" />
          </g>
        ))}
      </g>

      {/* Flowers — pink */}
      <g>
        {[
          [150, 572], [480, 580], [710, 568], [970, 580], [1110, 568],
        ].map(([cx, cy], i) => (
          <g key={i} transform={`translate(${cx} ${cy})`}>
            <line x1="0" y1="0" x2="0" y2="10" stroke="#2a6a22" strokeWidth="1.8" />
            <circle cx="-3" cy="-2" r="2.6" fill="#ff6ea8" />
            <circle cx="3"  cy="-2" r="2.6" fill="#ff6ea8" />
            <circle cx="0"  cy="-5" r="2.6" fill="#ff6ea8" />
            <circle cx="0"  cy="-1" r="1.8" fill="#ffe96b" />
          </g>
        ))}
      </g>
    </svg>
  );
}
