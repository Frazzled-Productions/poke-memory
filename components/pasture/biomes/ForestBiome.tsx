import { BiomeSvg } from "./BiomeSvg";
import { BiomeSky } from "./BiomeSky";
import { BiomeFloor } from "./BiomeFloor";

/**
 * Forest habitat backdrop - dappled canopy overhead, receding tree trunks,
 * undergrowth with ferns, mushrooms, and a fallen log in front. Anchor bands
 * in lib/pasture/zones.ts cluster sprites along the forest floor; the
 * deepest band falls in the shadow under the canopy.
 */
export function ForestBiome() {
  return (
    <BiomeSvg>
      <defs>
        <linearGradient id="forest-floor" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#6b4a2a" />
          <stop offset="100%" stopColor="#3f2c18" />
        </linearGradient>
        <radialGradient id="forest-godray" cx="0.5" cy="0">
          <stop offset="0%" stopColor="#fff3a8" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#fff3a8" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Air / dappled background */}
      <BiomeSky
        gradientId="forest-air"
        stops={[
          { offset: "0%",   stopColor: "#1f5a3a" },
          { offset: "40%",  stopColor: "#3a8c5b" },
          { offset: "100%", stopColor: "#5fa874" },
        ]}
      />

      {/* God-rays through canopy */}
      <ellipse cx="400" cy="0"  rx="200" ry="400" fill="url(#forest-godray)" />
      <ellipse cx="1100" cy="0" rx="240" ry="450" fill="url(#forest-godray)" />

      {/* Canopy mass - dark interlocking leaves */}
      <g fill="#1d4a30">
        <circle cx="80"   cy="80"  r="120" />
        <circle cx="240"  cy="50"  r="110" />
        <circle cx="420"  cy="90"  r="130" />
        <circle cx="600"  cy="55"  r="115" />
        <circle cx="780"  cy="85"  r="125" />
        <circle cx="950"  cy="50"  r="115" />
        <circle cx="1120" cy="90"  r="130" />
        <circle cx="1300" cy="55"  r="115" />
        <circle cx="1480" cy="85"  r="130" />
      </g>
      {/* Canopy mid-tone */}
      <g fill="#2e7a44">
        <circle cx="160"  cy="120" r="80" />
        <circle cx="340"  cy="135" r="85" />
        <circle cx="520"  cy="115" r="80" />
        <circle cx="700"  cy="135" r="85" />
        <circle cx="880"  cy="115" r="80" />
        <circle cx="1060" cy="135" r="85" />
        <circle cx="1240" cy="115" r="80" />
        <circle cx="1420" cy="135" r="85" />
      </g>
      {/* Canopy highlight */}
      <g fill="#5fb073" opacity="0.7">
        <circle cx="220" cy="140" r="34" />
        <circle cx="600" cy="160" r="40" />
        <circle cx="1000" cy="140" r="36" />
        <circle cx="1380" cy="155" r="38" />
      </g>

      {/* Distant tree trunks (small, far back) */}
      <g fill="#4a2e16">
        <rect x="170" y="200" width="10" height="230" />
        <rect x="380" y="190" width="12" height="240" />
        <rect x="640" y="200" width="10" height="230" />
        <rect x="870" y="195" width="12" height="235" />
        <rect x="1130" y="200" width="10" height="230" />
        <rect x="1380" y="195" width="12" height="235" />
      </g>

      {/* Mid tree trunks */}
      <g>
        <rect x="60"    y="180" width="22" height="320" fill="#5c3a1d" />
        <rect x="60"    y="180" width="22" height="320" fill="none" stroke="#3a2410" strokeWidth="2" />
        <rect x="1520"  y="180" width="22" height="320" fill="#5c3a1d" />
        <rect x="1520"  y="180" width="22" height="320" fill="none" stroke="#3a2410" strokeWidth="2" />
      </g>

      {/* Forest floor */}
      <BiomeFloor
        curvePath="M0,440 C200,420 400,448 700,432 C1000,418 1300,448 1600,428"
        strokePath="M0,445 C200,425 400,453 700,437 C1000,423 1300,453 1600,433"
        fill="url(#forest-floor)"
        strokeColour="#2a1a08"
        strokeOpacity={0.55}
      />

      {/* Mossy patches on forest floor */}
      <g fill="#3a8c4a" opacity="0.8">
        <ellipse cx="220"  cy="520" rx="80" ry="14" />
        <ellipse cx="540"  cy="535" rx="90" ry="14" />
        <ellipse cx="870"  cy="525" rx="85" ry="14" />
        <ellipse cx="1240" cy="540" rx="100" ry="14" />
      </g>

      {/* Fallen log - diagonal across mid-front */}
      <g>
        <ellipse cx="780" cy="538" rx="160" ry="14" fill="#1f140a" opacity="0.45" />
        <rect x="620" y="510" width="320" height="32" rx="14" fill="#7a4a22" />
        <rect x="620" y="510" width="320" height="32" rx="14" fill="none" stroke="#4a2e16" strokeWidth="2.5" />
        {/* end-ring */}
        <ellipse cx="620" cy="526" rx="8" ry="16" fill="#a06a3a" />
        <ellipse cx="620" cy="526" rx="3" ry="7"  fill="#7a4a22" />
        {/* bark texture lines */}
        <line x1="660" y1="518" x2="660" y2="534" stroke="#4a2e16" strokeWidth="1.5" opacity="0.5" />
        <line x1="740" y1="516" x2="740" y2="536" stroke="#4a2e16" strokeWidth="1.5" opacity="0.5" />
        <line x1="820" y1="518" x2="820" y2="534" stroke="#4a2e16" strokeWidth="1.5" opacity="0.5" />
        <line x1="900" y1="516" x2="900" y2="536" stroke="#4a2e16" strokeWidth="1.5" opacity="0.5" />
        {/* moss on log */}
        <ellipse cx="700" cy="510" rx="30" ry="6" fill="#3a8c4a" />
        <ellipse cx="860" cy="510" rx="26" ry="5" fill="#3a8c4a" />
      </g>

      {/* Mushrooms - front-left cluster */}
      <g>
        <ellipse cx="200" cy="572" rx="14" ry="4" fill="#1f140a" opacity="0.5" />
        <rect x="194" y="558" width="12" height="14" fill="#f0e3c5" />
        <ellipse cx="200" cy="556" rx="20" ry="10" fill="#d4453a" />
        <ellipse cx="200" cy="556" rx="20" ry="10" fill="none" stroke="#a02a20" strokeWidth="1.5" />
        <circle cx="194" cy="552" r="2.5" fill="#f0e3c5" />
        <circle cx="206" cy="555" r="2"   fill="#f0e3c5" />
        <circle cx="200" cy="549" r="2"   fill="#f0e3c5" />
        {/* small mushroom */}
        <rect x="225" y="568" width="7" height="8" fill="#f0e3c5" />
        <ellipse cx="228" cy="567" rx="11" ry="6" fill="#d4453a" />
        <circle cx="225" cy="565" r="1.6" fill="#f0e3c5" />
      </g>

      {/* Mushrooms - right cluster */}
      <g>
        <ellipse cx="1380" cy="582" rx="16" ry="4" fill="#1f140a" opacity="0.5" />
        <rect x="1374" y="566" width="13" height="16" fill="#f0e3c5" />
        <ellipse cx="1380" cy="564" rx="22" ry="11" fill="#d4453a" />
        <ellipse cx="1380" cy="564" rx="22" ry="11" fill="none" stroke="#a02a20" strokeWidth="1.5" />
        <circle cx="1374" cy="559" r="2.5" fill="#f0e3c5" />
        <circle cx="1386" cy="562" r="2"   fill="#f0e3c5" />
      </g>

      {/* Ferns scattered across foreground */}
      <g stroke="#2e7a44" strokeWidth="2.5" strokeLinecap="round" fill="none">
        {[
          [100, 575], [340, 568], [460, 580], [620, 562], [970, 575],
          [1100, 580], [1230, 570], [1500, 578],
        ].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <path d="M0,8 Q-2,-8 -10,-18" />
            <path d="M0,8 Q0,-10 0,-22" />
            <path d="M0,8 Q2,-8 10,-18" />
            <path d="M0,8 Q-4,-2 -14,-6" />
            <path d="M0,8 Q4,-2 14,-6" />
          </g>
        ))}
      </g>

      {/* Glowing motes drifting through air */}
      <g fill="#fff3a8">
        <circle cx="350"  cy="280" r="3" opacity="0.85" />
        <circle cx="510"  cy="220" r="2" opacity="0.7" />
        <circle cx="720"  cy="320" r="3" opacity="0.9" />
        <circle cx="890"  cy="260" r="2" opacity="0.7" />
        <circle cx="1060" cy="240" r="3" opacity="0.85" />
        <circle cx="1240" cy="300" r="2" opacity="0.7" />
      </g>
    </BiomeSvg>
  );
}
