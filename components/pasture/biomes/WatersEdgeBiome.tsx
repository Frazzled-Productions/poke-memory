import { BiomeSvg } from "./BiomeSvg";
import { BiomeSky } from "./BiomeSky";
import { BiomeFloor } from "./BiomeFloor";

/**
 * Waters Edge habitat backdrop - calm lake with marsh reeds, lily pads,
 * and a sandy/muddy shore in front. Anchor bands cluster sprites along
 * the shore and shallow-marsh band, with the deepest band on the far
 * bank.
 */
export function WatersEdgeBiome() {
  return (
    <BiomeSvg>
      <defs>
        <linearGradient id="we-water" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#7dc8e6" />
          <stop offset="100%" stopColor="#3a8eb8" />
        </linearGradient>
        <linearGradient id="we-shore" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#e8c878" />
          <stop offset="100%" stopColor="#a87a3e" />
        </linearGradient>
      </defs>

      {/* Sky */}
      <BiomeSky
        gradientId="we-sky"
        stops={[
          { offset: "0%",   stopColor: "#a8e0f3" },
          { offset: "100%", stopColor: "#e8f7ff" },
        ]}
      />

      {/* Distant low hills on far bank */}
      <path
        d="M0,340 C200,310 400,335 700,318 C1000,305 1300,335 1600,315 L1600,400 L0,400 Z"
        fill="#a3c98a"
      />
      <path
        d="M0,340 C200,310 400,335 700,318 C1000,305 1300,335 1600,315"
        stroke="#6b9c52" strokeWidth="3" fill="none" opacity="0.6"
      />

      {/* Far reed cluster on opposite bank */}
      <g stroke="#5e8a3a" strokeWidth="2" strokeLinecap="round" fill="none">
        {[
          [180, 350], [220, 348], [260, 345], [580, 340], [620, 338], [660, 342],
          [1180, 348], [1220, 345], [1260, 342],
        ].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <line x1="0" y1="0" x2="0" y2="-22" />
            <line x1="-3" y1="0" x2="-4" y2="-18" />
            <line x1="3" y1="0" x2="4" y2="-18" />
            <ellipse cx="0" cy="-24" rx="2" ry="6" fill="#5e8a3a" />
          </g>
        ))}
      </g>

      {/* Lake water */}
      <rect y="385" width="1600" height="170" fill="url(#we-water)" />
      {/* Water ripple highlights */}
      <g fill="#ffffff" opacity="0.45">
        <ellipse cx="120"  cy="420" rx="40" ry="2" />
        <ellipse cx="320"  cy="450" rx="50" ry="2" />
        <ellipse cx="560"  cy="430" rx="40" ry="2" />
        <ellipse cx="820"  cy="450" rx="60" ry="2" />
        <ellipse cx="1080" cy="430" rx="45" ry="2" />
        <ellipse cx="1340" cy="450" rx="55" ry="2" />
      </g>
      <g fill="#ffffff" opacity="0.3">
        <ellipse cx="220"  cy="470" rx="45" ry="2" />
        <ellipse cx="640"  cy="475" rx="55" ry="2" />
        <ellipse cx="940"  cy="468" rx="40" ry="2" />
        <ellipse cx="1240" cy="478" rx="60" ry="2" />
      </g>

      {/* Lily pads */}
      <g>
        {[
          [240, 470], [440, 480], [720, 466], [1020, 482], [1320, 470],
        ].map(([cx, cy], i) => (
          <g key={i} transform={`translate(${cx} ${cy})`}>
            <ellipse cx="0" cy="2" rx="34" ry="6" fill="#1a4030" opacity="0.45" />
            <path d="M-30,0 A30,12 0 1,1 30,0 L26,-2 Z" fill="#4ea142" stroke="#2a6a3a" strokeWidth="1.5" />
            <line x1="0" y1="0" x2="6" y2="-3" stroke="#2a6a3a" strokeWidth="1.5" />
            {/* lotus flower on one pad */}
            {i === 2 && (
              <g transform="translate(0 -4)">
                <ellipse cx="-4" cy="-2" rx="3" ry="6" fill="#ff96b3" />
                <ellipse cx="4"  cy="-2" rx="3" ry="6" fill="#ff96b3" />
                <ellipse cx="0"  cy="-6" rx="3" ry="6" fill="#ffaecf" />
                <circle  cx="0"  cy="-3" r="1.6" fill="#ffe96b" />
              </g>
            )}
          </g>
        ))}
      </g>

      {/* Sandy shore in foreground */}
      <BiomeFloor
        curvePath="M0,540 C200,520 400,548 700,530 C1000,516 1300,548 1600,528"
        fill="url(#we-shore)"
        strokeColour="#7a4a22"
        strokeOpacity={0.55}
      />

      {/* shore wave line where sand meets water */}
      <path
        d="M0,548 Q40,544 80,548 T160,548 T240,548 T320,548 T400,548 T480,548 T560,548 T640,548 T720,548 T800,548 T880,548 T960,548 T1040,548 T1120,548 T1200,548 T1280,548 T1360,548 T1440,548 T1520,548 T1600,548"
        fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.7"
      />

      {/* Foreground reed cluster - left */}
      <g stroke="#3a6a22" strokeWidth="3" strokeLinecap="round" fill="none">
        {[
          [60, 555], [78, 555], [96, 555], [114, 555],
        ].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <line x1="0" y1="0" x2="-2" y2="-34" />
            <ellipse cx="-2" cy="-38" rx="2.5" ry="7" fill="#5a8a32" stroke="none" />
          </g>
        ))}
      </g>

      {/* Foreground reed cluster - right */}
      <g stroke="#3a6a22" strokeWidth="3" strokeLinecap="round" fill="none">
        {[
          [1480, 558], [1500, 555], [1520, 558], [1540, 555],
        ].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <line x1="0" y1="0" x2="2" y2="-36" />
            <ellipse cx="2" cy="-40" rx="2.5" ry="7" fill="#5a8a32" stroke="none" />
          </g>
        ))}
      </g>

      {/* Pebbles on shore */}
      <g>
        <circle cx="280" cy="572" r="5" fill="#9c7a3a" stroke="#5a3e1a" strokeWidth="1.2" />
        <circle cx="300" cy="578" r="3" fill="#c8a878" stroke="#5a3e1a" strokeWidth="1.2" />
        <circle cx="540" cy="580" r="4" fill="#9c7a3a" stroke="#5a3e1a" strokeWidth="1.2" />
        <circle cx="880" cy="572" r="5" fill="#c8a878" stroke="#5a3e1a" strokeWidth="1.2" />
        <circle cx="900" cy="580" r="3" fill="#9c7a3a" stroke="#5a3e1a" strokeWidth="1.2" />
        <circle cx="1180" cy="580" r="4" fill="#c8a878" stroke="#5a3e1a" strokeWidth="1.2" />
      </g>

      {/* Cattails on shore */}
      <g>
        {[
          [380, 555], [820, 555], [1080, 555], [1340, 555],
        ].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <line x1="0" y1="0" x2="0" y2="-44" stroke="#3a6a22" strokeWidth="2.5" />
            <rect x="-3" y="-58" width="6" height="14" rx="2.5" fill="#7a4a22" stroke="#3a2410" strokeWidth="1.5" />
            <line x1="0" y1="-58" x2="0" y2="-66" stroke="#3a6a22" strokeWidth="1.5" />
          </g>
        ))}
      </g>
    </BiomeSvg>
  );
}
