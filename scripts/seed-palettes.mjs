#!/usr/bin/env node
/**
 * Generate a theme palette for every species from its sprite (#2187).
 *
 * Reads `public/sprites/pokemon/<id>.png` for each default-form species in
 * `lib/pokemon/generated-core.json`, drops transparent and near-white or
 * near-black pixels, buckets the rest into a coarse colour histogram and
 * takes the most common colour as `primary`, the next distinct hue as
 * `accent`, a lighter tint of `primary` as `secondary`, and black or white for
 * `fgOnPrimary`, whichever contrasts more. A palette that fails the contrast
 * checks in `lib/theme/contrast.ts` is written as the species' primary type
 * instead, so `paletteFor` uses that type's palette from
 * `lib/theme/type-palettes.ts`.
 *
 * Output: `lib/theme/generated-palettes.json`, committed. Re-run after a
 * reseed or a change to the checks; `lib/theme/generated-palettes.test.ts`
 * fails if a species is missing or a palette fails a check.
 *
 * `sharp` is a Next.js transitive dependency and is NOT listed in
 * package.json - do not add it (same as `scripts/optimise-sprites.mjs`).
 *
 * Usage: npm run seed:palettes
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Node strips the types; the checks are the same ones the unit tests use.
import { contrastRatio, passesPaletteChecks } from '../lib/theme/contrast.ts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

let sharp;
try {
  const { default: sharpModule } = await import('sharp');
  sharp = sharpModule;
} catch {
  console.error(
    'Error: `sharp` could not be resolved. It is a Next.js transitive dependency.\n' +
      'Run `npm ci` (or `npm install`) to install the full dependency tree, then retry.',
  );
  process.exit(1);
}

const spritesDir = join(repoRoot, 'public', 'sprites', 'pokemon');
const corePath = join(repoRoot, 'lib', 'pokemon', 'generated-core.json');
const outPath = join(repoRoot, 'lib', 'theme', 'generated-palettes.json');

/** Pixels more transparent than this are ignored. */
const MIN_ALPHA = 200;
/** A pixel whose darkest channel is above this is near-white and ignored. */
const NEAR_WHITE_MIN = 230;
/** A pixel whose brightest channel is below this is near-black and ignored. */
const NEAR_BLACK_MAX = 30;
/** Bits kept per channel for the histogram (3 bits = 8 levels, 512 buckets). */
const BUCKET_BITS = 3;
/** Smallest hue difference (degrees) for the accent to count as distinct. */
const MIN_ACCENT_HUE_DISTANCE = 40;
/** Share of white mixed into `primary` to make `secondary`. */
const SECONDARY_TINT = 0.45;

function toHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function hueOf([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null; // grey: no hue
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function hueDistance(a, b) {
  if (a === null || b === null) return a === b ? 0 : 180;
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

/** Buckets sorted by pixel count, each with its mean colour. */
async function colourBuckets(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const shift = 8 - BUCKET_BITS;
  const buckets = new Map();
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < MIN_ALPHA) continue;
    if (Math.min(r, g, b) > NEAR_WHITE_MIN) continue;
    if (Math.max(r, g, b) < NEAR_BLACK_MAX) continue;
    const key = ((r >> shift) << (2 * BUCKET_BITS)) | ((g >> shift) << BUCKET_BITS) | (b >> shift);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .sort((x, y) => y[1].count - x[1].count || x[0] - y[0])
    .map(([, v]) => [v.r / v.count, v.g / v.count, v.b / v.count]);
}

/** The extracted palette, or null when the sprite has no usable pixels. */
function paletteFromBuckets(buckets) {
  if (buckets.length === 0) return null;
  const primaryRgb = buckets[0];
  const primaryHue = hueOf(primaryRgb);
  const accentRgb =
    buckets.slice(1).find((c) => hueDistance(hueOf(c), primaryHue) >= MIN_ACCENT_HUE_DISTANCE) ??
    buckets[1] ??
    primaryRgb;
  const secondaryRgb = primaryRgb.map((v) => v + (255 - v) * SECONDARY_TINT);
  const primary = toHex(primaryRgb);
  const fgOnPrimary =
    contrastRatio('#FFFFFF', primary) >= contrastRatio('#000000', primary) ? '#FFFFFF' : '#000000';
  return { primary, secondary: toHex(secondaryRgb), accent: toHex(accentRgb), fgOnPrimary };
}

const core = JSON.parse(await readFile(corePath, 'utf8'));
const species = core.filter((p) => p.isDefaultForm).sort((a, b) => a.id - b.id);

const out = {};
let extracted = 0;
for (const p of species) {
  const palette = paletteFromBuckets(await colourBuckets(join(spritesDir, `${p.id}.png`)));
  if (palette !== null && passesPaletteChecks(palette)) {
    out[p.id] = [palette.primary, palette.secondary, palette.accent, palette.fgOnPrimary];
    extracted += 1;
  } else {
    out[p.id] = p.types[0];
  }
}

// One entry per line so a re-run produces a readable diff.
const lines = Object.entries(out).map(([id, v]) => `  ${JSON.stringify(id)}: ${JSON.stringify(v)}`);
await writeFile(outPath, `{\n${lines.join(',\n')}\n}\n`);
console.log(
  `Wrote ${species.length} palettes to lib/theme/generated-palettes.json ` +
    `(${extracted} extracted, ${species.length - extracted} use their type palette).`,
);
