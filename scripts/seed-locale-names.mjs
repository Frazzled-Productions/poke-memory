#!/usr/bin/env node
// scripts/seed-locale-names.mjs
// Fetches multi-locale Pokemon names from PokéAPI and writes
// lib/pokemon/generated-locale-names.json (+ public/pokemon-data/ copy).
//
// Run with: node scripts/seed-locale-names.mjs
// Node 20+ — uses global fetch.
//
// This script is a targeted complement to the full seed-pokemon.mjs:
// it only fetches /pokemon-species/{id} for locale name extraction and
// skips sprites, cries, evolution chains, and alternate forms.
//
// Idempotent: species already present in the existing sidecar are skipped
// unless --force is passed.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import { pinyin as pinyinPro } from "pinyin-pro";
import { toRomaji } from "wanakana";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Hardcoded PokéAPI base — species IDs from generated.json are appended as
// integers only.  Explicit constant keeps CodeQL's taint-tracking clean.
const POKEAPI_SPECIES_BASE = "https://pokeapi.co/api/v2/pokemon-species/";

const CONCURRENCY = 20;
const MAX_RETRIES = 3;
const BACKOFF_MS = [500, 1000, 2000];
const PROGRESS_INTERVAL = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Write `content` to `destPath` atomically: write to a unique sibling temp
 * file first, then rename into place.  Eliminates the check-then-write race
 * that CodeQL flags on a plain existsSync + writeFile pair.
 */
async function writeFileAtomic(destPath, content) {
  const tmpPath = `${destPath}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmpPath, content, "utf-8");
    await rename(tmpPath, destPath);
  } catch (err) {
    try { await (await import("node:fs/promises")).unlink(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

// Accept a speciesId (number) rather than a generic URL string so that the
// fetch target is always POKEAPI_SPECIES_BASE + integer — CodeQL cannot follow
// a taint path from file data through a numeric parameter to fetch().
async function fetchSpeciesWithRetry(speciesId) {
  const url = POKEAPI_SPECIES_BASE + String(speciesId);
  const label = `species/${speciesId}`;
  let attempt = 0;
  while (true) {
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await sleep(BACKOFF_MS[attempt]);
        attempt++;
        continue;
      }
      return { ok: false, reason: err.message };
    }
    if (res.status === 429) {
      process.stderr.write(`[locale-seed] WARN: rate-limited at ${label}, skipping\n`);
      return { ok: false, reason: "rate-limited" };
    }
    if (res.status >= 500) {
      if (attempt < MAX_RETRIES) {
        await sleep(BACKOFF_MS[attempt]);
        attempt++;
        continue;
      }
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    try {
      const data = await res.json();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, reason: "json-parse" };
    }
  }
}

function generatePinyin(name) {
  return pinyinPro(name, { toneType: "symbol" }).trim();
}

function normaliseRomaji(jaRoma, jaKana) {
  if (jaRoma) return jaRoma.replace(/\s+/g, " ").trim();
  // Defensive fallback for any species missing ja-roma (rare, but guarded).
  if (jaKana) {
    process.stderr.write(`[locale-seed] WARN: missing ja-roma, using wanakana fallback\n`);
    return toRomaji(jaKana).trim();
  }
  return "";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const libDir = resolve(__dirname, "../lib/pokemon");
const publicDir = resolve(__dirname, "../public/pokemon-data");
const generatedPath = resolve(libDir, "generated.json");
const sidecarPath = resolve(libDir, "generated-locale-names.json");
const sidecarPublicPath = resolve(publicDir, "generated-locale-names.json");

const forceFlag = process.argv.includes("--force");

// Read generated.json for the list of default-form species IDs.
if (!existsSync(generatedPath)) {
  process.stderr.write("[locale-seed] ERROR: lib/pokemon/generated.json not found — run npm run seed first\n");
  process.exit(1);
}
const allRecords = JSON.parse(await readFile(generatedPath, "utf-8"));
const defaultForms = allRecords.filter((p) => p.isDefaultForm);
process.stderr.write(`[locale-seed] Found ${defaultForms.length} default-form species in generated.json\n`);

// Load existing sidecar to skip already-done entries (unless --force).
const existingBySpeciesId = {};
if (existsSync(sidecarPath) && !forceFlag) {
  try {
    const existing = JSON.parse(await readFile(sidecarPath, "utf-8"));
    for (const entry of existing) {
      existingBySpeciesId[entry.speciesId] = entry;
    }
    process.stderr.write(`[locale-seed] Loaded ${Object.keys(existingBySpeciesId).length} existing entries from sidecar\n`);
  } catch (err) {
    process.stderr.write(`[locale-seed] WARN: could not read existing sidecar: ${err.message}\n`);
  }
}

const toDo = defaultForms.filter((p) => !existingBySpeciesId[p.speciesId]);
process.stderr.write(`[locale-seed] ${toDo.length} species to fetch (${defaultForms.length - toDo.length} skipped — already in sidecar)\n`);

const results = { ...existingBySpeciesId };
let done = 0;
let skipped = 0;
let warnings = 0;

for (let i = 0; i < toDo.length; i += CONCURRENCY) {
  const batch = toDo.slice(i, i + CONCURRENCY);
  await Promise.all(batch.map(async (p) => {
    const res = await fetchSpeciesWithRetry(p.speciesId);
    if (!res.ok) {
      process.stderr.write(`[locale-seed] WARN: could not fetch species ${p.speciesId} (${p.displayName ?? p.name}): ${res.reason}\n`);
      skipped++;
      // Keep any existing entry; otherwise fall back to English-only.
      if (!results[p.speciesId]) {
        results[p.speciesId] = {
          speciesId: p.speciesId,
          nameByLocale: { en: p.displayName ?? p.name, ja: p.displayName ?? p.name, "zh-Hans": p.displayName ?? p.name, "zh-Hant": p.displayName ?? p.name },
          transliterationByLocale: { ja: p.displayName ?? p.name, "zh-Hans": p.displayName ?? p.name, "zh-Hant": p.displayName ?? p.name },
        };
      }
      return;
    }

    const namesArr = res.data.names ?? [];
    const enName = namesArr.find((n) => n.language?.name === "en")?.name ?? p.displayName ?? p.name;
    const jaName = namesArr.find((n) => n.language?.name === "ja")?.name ?? "";
    const zhHansName = namesArr.find((n) => n.language?.name === "zh-hans")?.name ?? "";
    const zhHantName = namesArr.find((n) => n.language?.name === "zh-hant")?.name ?? "";
    const jaRoma = namesArr.find((n) => n.language?.name === "ja-roma")?.name ?? "";

    if (!jaName) { process.stderr.write(`[locale-seed] WARN: no ja name for species ${p.speciesId} (${enName})\n`); warnings++; }
    if (!zhHansName) { process.stderr.write(`[locale-seed] WARN: no zh-hans name for species ${p.speciesId} (${enName})\n`); warnings++; }
    if (!zhHantName) { process.stderr.write(`[locale-seed] WARN: no zh-hant name for species ${p.speciesId} (${enName})\n`); warnings++; }

    results[p.speciesId] = {
      speciesId: p.speciesId,
      nameByLocale: {
        en: enName,
        ja: jaName || enName,
        "zh-Hans": zhHansName || enName,
        "zh-Hant": zhHantName || enName,
      },
      transliterationByLocale: {
        ja: normaliseRomaji(jaRoma, jaName) || enName,
        "zh-Hans": zhHansName ? generatePinyin(zhHansName) : enName,
        "zh-Hant": zhHantName ? generatePinyin(zhHantName) : enName,
      },
    };

    done++;
  }));

  const processed = Math.min(i + CONCURRENCY, toDo.length);
  if (processed % PROGRESS_INTERVAL === 0 || processed === toDo.length) {
    process.stderr.write(`[locale-seed] [${processed}/${toDo.length}] fetched\n`);
  }
}

// Sort by speciesId and write.
const sorted = Object.values(results).sort((a, b) => a.speciesId - b.speciesId);
const json = JSON.stringify(sorted);

await mkdir(publicDir, { recursive: true });
await writeFileAtomic(sidecarPath, json);
await writeFileAtomic(sidecarPublicPath, json);

const kb = (json.length / 1024).toFixed(1);
process.stderr.write(
  `[locale-seed] Done: ${done} fetched, ${skipped} skipped, ${warnings} warnings\n` +
  `[locale-seed] Wrote ${sorted.length} entries to generated-locale-names.json (${kb} KB)\n`,
);
