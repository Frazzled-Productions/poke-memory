/**
 * Generates iOS PWA splash screen PNGs for all current iPhone sizes.
 *
 * Each image is the app icon centred on the manifest theme colour (#DC0A2D).
 * Run once; commit the results under public/splash/.
 *
 * Usage:
 *   node scripts/generate-splash-screens.mjs
 *
 * Requires sharp (already a transitive dependency via Next.js).
 */

import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Use the project's own sharp copy.
const require = createRequire(import.meta.url);

// Resolve sharp from the project's node_modules.
function resolveSharp() {
  const candidate = path.join(projectRoot, 'node_modules', 'sharp');
  if (fs.existsSync(candidate)) return require(candidate);
  throw new Error('sharp not found - run `npm ci` in the project root first');
}
const sharp = resolveSharp();

// ─── Theme ────────────────────────────────────────────────────────────────────

const BG_COLOUR = '#DC0A2D'; // manifest theme_color
const ICON_SIZE = 180;        // rendered icon diameter (matches apple-icon.tsx)

// ─── Device table ─────────────────────────────────────────────────────────────
// Each entry covers one physical device form-factor.
// portrait  = { w, h } in CSS px; landscape swaps them.
// scale     = device pixel ratio (used in the media query only).
//
// Sources: Apple Human Interface Guidelines + Safari Web Content Guide (2024).
// https://developer.apple.com/design/human-interface-guidelines/layout#iOS-iPadOS-safe-areas

const DEVICES = [
  // iPhone 16 Pro Max
  { label: 'iphone16promax', w: 440, h: 956, scale: 3 },
  // iPhone 16 Pro  (402 × 874 logical, 3×; 15 Pro / 14 Pro use 393 × 852 - see iphone16 entry)
  { label: 'iphone16pro',    w: 402, h: 874, scale: 3 },
  // iPhone 16 Plus / 15 Plus / 14 Plus
  { label: 'iphone16plus',   w: 430, h: 932, scale: 3 },
  // iPhone 16 / 15 / 14
  { label: 'iphone16',       w: 393, h: 852, scale: 3 },
  // iPhone 13 mini / 12 mini
  { label: 'iphone13mini',   w: 375, h: 812, scale: 3 },
  // iPhone SE (3rd gen) / SE (2nd gen) / iPhone 8
  { label: 'iphoneSE',       w: 375, h: 667, scale: 2 },
];

// ─── Icon rendering ───────────────────────────────────────────────────────────
// Re-implement the app icon from apple-icon.tsx using sharp compositing
// so we don't need a headless browser.
//
// Layout (all coordinates in px at 1× scale, will be scaled by ICON_SIZE/180):
//   background circle  : 180×180, fill #DC0A2D
//   lens ring          : 92×92 circle, fill #5BB1F5, white border 8px, centred at (90, 72)
//   highlight dot      : 22×22 circle, rgba(255,255,255,0.7), at (52, 42) within lens
//   three indicator dots (16px ea.) at y=130, centred

async function buildIconBuffer(size = ICON_SIZE) {
  const s = size / 180; // scale factor

  const scale = (v) => Math.round(v * s);

  // Compose using SVG – sharp can render SVG natively via librsvg.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <!-- Background -->
  <rect width="${size}" height="${size}" fill="#DC0A2D"/>

  <!-- Lens housing (white ring) -->
  <circle
    cx="${scale(90)}" cy="${scale(72)}"
    r="${scale(46)}"
    fill="#5BB1F5"
    stroke="white"
    stroke-width="${scale(8)}"
  />

  <!-- Highlight reflection (upper-left inside lens) -->
  <circle
    cx="${scale(62)}" cy="${scale(54)}"
    r="${scale(11)}"
    fill="rgba(255,255,255,0.7)"
  />

  <!-- Indicator lights -->
  <circle cx="${scale(68)}" cy="${scale(130)}" r="${scale(8)}" fill="#FF3B47"/>
  <circle cx="${scale(90)}" cy="${scale(130)}" r="${scale(8)}" fill="#FFCB47"/>
  <circle cx="${scale(112)}" cy="${scale(130)}" r="${scale(8)}" fill="#4ECB71"/>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ─── Splash generation ────────────────────────────────────────────────────────

async function generateSplash(widthPx, heightPx, filename) {
  const iconBuf = await buildIconBuffer(ICON_SIZE);

  // Convert hex bg to RGB for sharp
  const r = parseInt(BG_COLOUR.slice(1, 3), 16);
  const g = parseInt(BG_COLOUR.slice(3, 5), 16);
  const b = parseInt(BG_COLOUR.slice(5, 7), 16);

  const iconLeft = Math.round((widthPx - ICON_SIZE) / 2);
  const iconTop  = Math.round((heightPx - ICON_SIZE) / 2);

  await sharp({
    create: {
      width:      widthPx,
      height:     heightPx,
      channels:   3,
      background: { r, g, b },
    },
  })
    .composite([{ input: iconBuf, left: iconLeft, top: iconTop }])
    .png({ compressionLevel: 9 })
    .toFile(filename);

  console.log(`  wrote ${path.relative(projectRoot, filename)} (${widthPx}×${heightPx})`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const outDir = path.join(projectRoot, 'public', 'splash');
fs.mkdirSync(outDir, { recursive: true });

console.log('Generating iOS splash screens…');

for (const dev of DEVICES) {
  // Portrait
  const pw = dev.w * dev.scale;
  const ph = dev.h * dev.scale;
  await generateSplash(pw, ph, path.join(outDir, `${dev.label}-portrait.png`));

  // Landscape
  await generateSplash(ph, pw, path.join(outDir, `${dev.label}-landscape.png`));
}

console.log('Done.');
