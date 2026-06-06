#!/usr/bin/env node
/**
 * Bundle-size guard for the async-seed work (#1677 / #1604).
 *
 * The full Pokémon seed (~1.3 MB of species + evolution + flavour data) is
 * fetched at runtime from public/pokemon-data/*.json (see lib/pokemon/seed-async.ts),
 * NOT bundled into any JS chunk. This guard fails the build if the seed leaks
 * back into a static chunk - e.g. a module re-introduces a value import of
 * `@/lib/pokemon/seed` (SEED_POKEMON / SEED_EVOLUTION_CARDS) instead of the
 * async loader.
 *
 * Detection: a bundled seed contains the entire species list. We test for that
 * by counting how many obscure mid/late-dex species names co-occur in a single
 * chunk. A curated subset (e.g. the theme colour palette, which lists ~20
 * popular species) never contains these; the full seed contains all of them.
 *
 * Usage: node scripts/check-bundle-size.mjs   (run after `npm run build`)
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const NEXT_DIR = join(process.cwd(), ".next");
const CHUNKS_DIR = join(NEXT_DIR, "static", "chunks");

// Obscure species deliberately chosen to be absent from any curated subset
// (theme palettes, onboarding examples). If a single chunk contains most of
// these, the entire seed list has been inlined into it.
const SEED_MARKERS = [
  "Bidoof",
  "Luvdisc",
  "Stunfisk",
  "Klefki",
  "Binacle",
  "Dustox",
  "Spoink",
  "Delibird",
  "Bibarel",
  "Cascoon",
];
// Flag a chunk if it contains at least this many markers (the full seed has all
// of them; any legitimate curated subset has none).
const MARKER_THRESHOLD = 5;

/** Recursively collect all .js files under a directory. */
async function collectJsFiles(dir) {
  let files = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(await collectJsFiles(full));
    } else if (extname(entry.name) === ".js") {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  console.log("Checking static chunks for an inlined Pokémon seed...\n");

  const chunks = await collectJsFiles(CHUNKS_DIR);
  if (chunks.length === 0) {
    console.error(
      `No chunks found under ${CHUNKS_DIR}. Did you run \`npm run build\` first?`,
    );
    process.exit(1);
  }

  const offenders = [];
  let largest = { path: "", size: 0 };

  for (const chunkPath of chunks) {
    let content;
    try {
      content = await readFile(chunkPath, "utf8");
    } catch {
      continue;
    }
    const hits = SEED_MARKERS.filter((m) => content.includes(m));
    if (hits.length >= MARKER_THRESHOLD) {
      const { size } = await stat(chunkPath);
      offenders.push({
        path: chunkPath.replace(process.cwd(), ""),
        size,
        hits: hits.length,
      });
    }
    const { size } = await stat(chunkPath);
    if (size > largest.size) {
      largest = { path: chunkPath.replace(process.cwd(), ""), size };
    }
  }

  console.log(
    `Largest chunk: ${largest.path}  (${(largest.size / 1024).toFixed(1)} kB)`,
  );

  if (offenders.length > 0) {
    console.error("\nFAIL: the Pokémon seed is bundled into a static chunk:");
    for (const { path, size, hits } of offenders) {
      console.error(
        `  ${path}  (${(size / 1024).toFixed(1)} kB, ${hits}/${SEED_MARKERS.length} seed markers)`,
      );
    }
    console.error(
      "\nThe seed must be fetched at runtime via lib/pokemon/seed-async.ts " +
        "(getSeedIfLoaded / useSeed), not value-imported from @/lib/pokemon/seed.",
    );
    process.exit(1);
  }

  console.log("\nOK: no static chunk contains the inlined seed.");
}

main().catch((err) => {
  console.error("check-bundle-size failed:", err);
  process.exit(1);
});
