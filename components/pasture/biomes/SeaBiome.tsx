"use client";

import styles from "./Biome.module.css";

/**
 * Open Sea habitat backdrop — sky horizon at top, sunlit water column,
 * sandy seafloor with coral and kelp at the bottom. Anchor bands span
 * surface → reef → deep so water Pokémon distribute through the column.
 */
export function SeaBiome() {
  return (
    <svg
      className={styles.biome}
      viewBox="0 0 1600 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="sea-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#9ddcff" />
          <stop offset="100%" stopColor="#fff3b5" />
        </linearGradient>
        <linearGradient id="sea-water" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"  stopColor="#5ab8e0" />
          <stop offset="50%" stopColor="#2e7fb5" />
          <stop offset="100%" stopColor="#103f6a" />
        </linearGradient>
        <linearGradient id="sea-sand" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#f0d486" />
          <stop offset="100%" stopColor="#caa056" />
        </linearGradient>
        <radialGradient id="sea-sundisk" cx="0.5" cy="0.5">
          <stop offset="0%" stopColor="#fff8c8" />
          <stop offset="80%" stopColor="#ffd24a" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Sky band */}
      <rect width="1600" height="100" fill="url(#sea-sky)" />
      {/* Sun on horizon */}
      <circle cx="1320" cy="70" r="80" fill="url(#sea-sundisk)" />
      <circle cx="1320" cy="70" r="32" fill="#fff5a0" />

      {/* Water column */}
      <rect y="100" width="1600" height="500" fill="url(#sea-water)" />

      {/* Sun glitter on surface */}
      <g fill="#ffffff" opacity="0.85">
        <ellipse cx="1280" cy="108" rx="40" ry="3" />
        <ellipse cx="1340" cy="112" rx="20" ry="2" />
        <ellipse cx="1380" cy="108" rx="30" ry="2.5" />
      </g>

      {/* Surface ripple line */}
      <path
        d="M0,100 Q40,96 80,100 T160,100 T240,100 T320,100 T400,100 T480,100 T560,100 T640,100 T720,100 T800,100 T880,100 T960,100 T1040,100 T1120,100 T1200,100 T1280,100 T1360,100 T1440,100 T1520,100 T1600,100"
        fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.7"
      />

      {/* God-rays through water */}
      <g fill="#bfe9ff" opacity="0.18">
        <path d="M280,100 L150,600 L240,600 L420,100 Z" />
        <path d="M700,100 L600,600 L700,600 L820,100 Z" />
        <path d="M1100,100 L1020,600 L1100,600 L1220,100 Z" />
      </g>

      {/* Bubbles drifting up */}
      <g fill="#ffffff" stroke="#bfe9ff" strokeWidth="1.5">
        <circle cx="200"  cy="280" r="6"  opacity="0.85" />
        <circle cx="215"  cy="240" r="4"  opacity="0.7" />
        <circle cx="195"  cy="200" r="3"  opacity="0.6" />
        <circle cx="850"  cy="320" r="7"  opacity="0.85" />
        <circle cx="870"  cy="270" r="5"  opacity="0.75" />
        <circle cx="855"  cy="220" r="3"  opacity="0.6" />
        <circle cx="1380" cy="360" r="6"  opacity="0.85" />
        <circle cx="1395" cy="310" r="4"  opacity="0.7" />
      </g>

      {/* Sandy seafloor */}
      <path
        d="M0,510 C200,490 400,520 700,500 C1000,484 1300,520 1600,498 L1600,600 L0,600 Z"
        fill="url(#sea-sand)"
      />
      <path
        d="M0,510 C200,490 400,520 700,500 C1000,484 1300,520 1600,498"
        stroke="#a07832" strokeWidth="3" fill="none" opacity="0.55"
      />

      {/* Kelp forest — back row */}
      <g stroke="#2e7a3a" strokeWidth="6" strokeLinecap="round" fill="none" opacity="0.85">
        <path d="M120,500 Q110,440 130,380 Q150,320 130,260 Q110,200 130,150" />
        <path d="M170,510 Q190,450 170,390 Q150,330 170,270 Q190,210 170,170" />
        <path d="M1450,500 Q1430,440 1450,380 Q1470,320 1450,260 Q1430,200 1450,180" />
        <path d="M1500,510 Q1480,450 1500,390 Q1520,330 1500,270 Q1480,210 1500,200" />
      </g>

      {/* Coral cluster — left */}
      <g>
        <ellipse cx="350" cy="540" rx="60" ry="6" fill="#1f140a" opacity="0.35" />
        <g fill="#ff6b8e">
          <ellipse cx="320" cy="520" rx="14" ry="22" />
          <ellipse cx="345" cy="514" rx="12" ry="26" />
          <ellipse cx="370" cy="518" rx="14" ry="24" />
        </g>
        <g fill="#ff96b3">
          <ellipse cx="320" cy="512" rx="6" ry="10" />
          <ellipse cx="345" cy="500" rx="5" ry="12" />
          <ellipse cx="370" cy="508" rx="6" ry="11" />
        </g>
        {/* fan coral */}
        <g fill="#f7b06a" stroke="#a86d2a" strokeWidth="1.5">
          <path d="M400,540 Q380,500 360,540 Z" />
          <path d="M400,540 Q390,495 410,540 Z" />
          <path d="M400,540 Q410,495 430,540 Z" />
        </g>
      </g>

      {/* Coral cluster — right */}
      <g>
        <ellipse cx="1180" cy="544" rx="70" ry="6" fill="#1f140a" opacity="0.35" />
        <g fill="#9b6cff">
          <ellipse cx="1150" cy="524" rx="14" ry="22" />
          <ellipse cx="1180" cy="518" rx="14" ry="28" />
          <ellipse cx="1212" cy="522" rx="14" ry="24" />
        </g>
        <g fill="#b89bff">
          <ellipse cx="1150" cy="516" rx="6" ry="10" />
          <ellipse cx="1180" cy="504" rx="6" ry="14" />
          <ellipse cx="1212" cy="514" rx="6" ry="11" />
        </g>
      </g>

      {/* Sea anemones — small front */}
      <g>
        {[
          [520, 538], [780, 542], [1000, 538], [1330, 542],
        ].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <ellipse cx="0" cy="2" rx="14" ry="4" fill="#1f140a" opacity="0.35" />
            <g stroke="#3ad29f" strokeWidth="2" strokeLinecap="round">
              <line x1="-8" y1="0" x2="-10" y2="-14" />
              <line x1="-4" y1="0" x2="-5" y2="-17" />
              <line x1="0"  y1="0" x2="0"  y2="-19" />
              <line x1="4"  y1="0" x2="5"  y2="-17" />
              <line x1="8"  y1="0" x2="10" y2="-14" />
            </g>
            <ellipse cx="0" cy="0" rx="10" ry="4" fill="#3ad29f" />
          </g>
        ))}
      </g>

      {/* Scattered shells / pebbles on sand */}
      <g>
        <circle cx="640" cy="554" r="6" fill="#e8d2a0" stroke="#9c7a3a" strokeWidth="1.2" />
        <circle cx="660" cy="558" r="4" fill="#c8a878" stroke="#9c7a3a" strokeWidth="1.2" />
        <circle cx="900" cy="556" r="5" fill="#e8d2a0" stroke="#9c7a3a" strokeWidth="1.2" />
        <circle cx="1080" cy="558" r="4" fill="#c8a878" stroke="#9c7a3a" strokeWidth="1.2" />
      </g>
    </svg>
  );
}
