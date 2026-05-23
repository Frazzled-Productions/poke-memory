#!/usr/bin/env node
/**
 * Pre-generate optimised WebP sprite variants for all Pokémon sprites.
 *
 * Reads every `public/sprites/pokemon/<id>.png`, converts it to WebP at each
 * render width used across the app, and writes the result to
 * `public/sprites/pokemon/webp/<id>/<width>.webp`.
 *
 * The generated files are committed to the repository so the build never
 * needs to run this script — they are static assets served directly without
 * any Vercel Image Optimisation transformation.
 *
 * `sharp` is used for conversion. It is a Next.js transitive dependency and
 * is NOT listed in package.json — do not add it. If `sharp` cannot be
 * resolved, the script exits with an error explaining that it must be run
 * after `npm ci` (or `npm install`) has resolved the Next.js dependency tree.
 *
 * Usage:
 *   node scripts/optimise-sprites.mjs          # skip existing files
 *   node scripts/optimise-sprites.mjs --force  # regenerate all files
 */

import { readdir, mkdir, access } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Resolve `sharp` as a Next.js transitive dep — do NOT add to package.json.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Width set — mirrors lib/sprites/imageLoaderHelpers.ts GENERATED_SPRITE_WIDTHS.
// Keep in sync manually; this script is intentionally framework-free so it
// does not import TypeScript source directly.
// ---------------------------------------------------------------------------
const GENERATED_WIDTHS = [32, 40, 48, 56, 64, 120, 150, 180, 192, 320];

/** Maximum source width we will generate variants for. Source PNGs are ~475 px. */
const SOURCE_RESOLUTION_CAP = 475;

/**
 * WebP quality (0–100). Lowered from 75 to 65 after the A/B in #1190 / #1192
 * showed ~2.4 MiB / 4.5% repo-size saving with no visible regression at the
 * painted sizes the app uses. q65 captures ~70% of the achievable saving
 * while leaving a comfortable margin above the encoder's artefact frontier.
 */
const QUALITY = 65;

/** Number of sprites to process in parallel. */
const CONCURRENCY = 20;

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const force = args.includes('--force');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const spritesDir = join(repoRoot, 'public', 'sprites', 'pokemon');
const webpBaseDir = join(spritesDir, 'webp');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if a file exists. */
async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a single source PNG to all generated widths.
 *
 * @param {string} pngPath  Absolute path to the source PNG.
 * @param {number} id       Numeric species ID.
 * @returns {Promise<{ id: number; generated: number; skipped: number; failed: number }>}
 */
async function convertSprite(pngPath, id) {
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  // Read source dimensions once so we can cap at source resolution.
  let sourceWidth;
  try {
    const meta = await sharp(pngPath).metadata();
    sourceWidth = meta.width ?? SOURCE_RESOLUTION_CAP;
  } catch (err) {
    console.error(`  [${id}] Failed to read metadata: ${err.message}`);
    // Treat every width as failed — we cannot determine the source size.
    failed += GENERATED_WIDTHS.length;
    return { id, generated, skipped, failed };
  }

  const outDir = join(webpBaseDir, String(id));
  await mkdir(outDir, { recursive: true });

  for (const width of GENERATED_WIDTHS) {
    // Cap at source resolution — do not upscale.
    const targetWidth = Math.min(width, sourceWidth);
    const outPath = join(outDir, `${width}.webp`);

    if (!force && (await fileExists(outPath))) {
      skipped++;
      continue;
    }

    try {
      await sharp(pngPath)
        .resize(targetWidth, null, { withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toFile(outPath);
      generated++;
    } catch (err) {
      console.error(`  [${id}] width=${width}: ${err.message}`);
      failed++;
      process.exitCode = 1; // Signal failure at the end.
    }
  }

  return { id, generated, skipped, failed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const pngFiles = (await readdir(spritesDir)).filter(
  (f) => extname(f) === '.png',
);

console.log(
  `Found ${pngFiles.length} source PNGs. Widths: [${GENERATED_WIDTHS.join(', ')}]. Quality: ${QUALITY}. Force: ${force}.`,
);

let totalGenerated = 0;
let totalSkipped = 0;
let totalFailed = 0;

// Process with bounded concurrency.
let index = 0;

async function worker() {
  while (index < pngFiles.length) {
    const file = pngFiles[index++];
    if (!file) continue;

    const idStr = basename(file, '.png');
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id)) {
      console.warn(`Skipping non-numeric filename: ${file}`);
      continue;
    }

    const pngPath = join(spritesDir, file);
    const result = await convertSprite(pngPath, id);
    totalGenerated += result.generated;
    totalSkipped += result.skipped;
    totalFailed += result.failed;
  }
}

const workers = Array.from({ length: CONCURRENCY }, () => worker());
await Promise.all(workers);

const totalFiles = totalGenerated + totalSkipped + totalFailed;
console.log(
  `Done. ${totalGenerated} generated, ${totalSkipped} skipped, ${totalFailed} failed (${totalFiles} total variant slots).`,
);

if (totalFailed > 0) {
  console.error(`${totalFailed} conversion(s) failed — see errors above.`);
  process.exit(1);
}
