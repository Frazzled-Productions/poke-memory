#!/usr/bin/env node
// scripts/split-seed.mjs
// Re-generates the split seed files from an existing generated.json
// without re-fetching from PokéAPI.  Run after any manual edit to generated.json.
//
// Produces four files:
//   generated-core.json         — all fields except flavorTexts and evolutionChain
//   generated-chains.json       — deduplicated evolution chains + pokemon→hash map
//   generated-flavor.json       — id + flavorTexts (lib/ + public/)
//   generated-locale-names.json — per-species locale names + transliterations (#1259)
//
// Usage: node scripts/split-seed.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// Build-time transliteration: pinyin-pro (zh-Hans / zh-Hant) and wanakana
// (ja rōmaji fallback).  Both are devDependencies — never imported at runtime.
import { pinyin as pinyinPro } from "pinyin-pro";
import { toRomaji } from "wanakana";

/** Generate pinyin with tone marks for a Chinese name. */
function generatePinyin(name) {
  return pinyinPro(name, { toneType: "symbol" }).trim();
}

/** Normalise a PokéAPI ja-roma string; fall back to wanakana if absent. */
function normaliseRomaji(jaRoma, jaKana) {
  if (jaRoma) return jaRoma.replace(/\s+/g, " ").trim();
  return toRomaji(jaKana).trim();
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const libDir = resolve(__dirname, "../lib/pokemon");
const publicDir = resolve(__dirname, "../public/pokemon-data");

const records = JSON.parse(await readFile(resolve(libDir, "generated.json"), "utf-8"));

await mkdir(publicDir, { recursive: true });

// generated-core.json — strip flavorTexts + evolutionChain
const coreRecords = records.map(({ flavorTexts: _ft, evolutionChain: _ec, ...rest }) => rest);
await writeFile(resolve(libDir, "generated-core.json"), JSON.stringify(coreRecords), "utf-8");

// generated-chains.json — deduped chains + pokemon→hash map
const chainsByHash = {};
const pokemonChain = {};
for (const p of records) {
  const ec = p.evolutionChain ?? [];
  const key = JSON.stringify(ec);
  const hash = createHash("md5").update(key).digest("hex").slice(0, 8);
  if (!chainsByHash[hash]) chainsByHash[hash] = ec;
  pokemonChain[String(p.id)] = hash;
}
await writeFile(
  resolve(libDir, "generated-chains.json"),
  JSON.stringify({ chains: chainsByHash, pokemonChain }),
  "utf-8",
);

// generated-flavor.json — id + flavorTexts (lib/ + public/)
const flavorRecords = records
  .filter((p) => p.flavorTexts && p.flavorTexts.length > 0)
  .map((p) => ({ id: p.id, flavorTexts: p.flavorTexts }));
const flavorJson = JSON.stringify(flavorRecords);
await writeFile(resolve(libDir, "generated-flavor.json"), flavorJson, "utf-8");
await writeFile(resolve(publicDir, "generated-flavor.json"), flavorJson, "utf-8");

// generated-locale-names.json (#1259)
// Re-derive locale names from generated.json's `name` field by checking
// whether the existing sidecar already has an entry.  If a pre-existing
// generated-locale-names.json exists, preserve its data; otherwise derive
// placeholder entries from the English name only.
//
// NOTE: This path is primarily for re-splitting an existing generated.json
// that was produced before #1259.  A full re-seed (scripts/seed-pokemon.mjs)
// is the canonical way to get locale names with full PokéAPI data.
// split-seed.mjs carries the derivation logic so that the split files remain
// consistent after any manual generated.json edit.

let existingLocaleNames = {};
try {
  const existingJson = await readFile(resolve(libDir, "generated-locale-names.json"), "utf-8");
  const existingArr = JSON.parse(existingJson);
  for (const entry of existingArr) {
    existingLocaleNames[entry.speciesId] = entry;
  }
} catch {
  // No existing sidecar — build placeholder entries.
}

const localeNamesRecords = records
  .filter((p) => p.isDefaultForm)
  .map((p) => {
    // Prefer the existing sidecar entry if available.
    if (existingLocaleNames[p.speciesId]) {
      return existingLocaleNames[p.speciesId];
    }
    // Fallback: English-only entry (no locale data available without re-seed).
    const jaKana = "";   // Not available in generated.json — re-seed to populate.
    const zhHans = "";
    const zhHant = "";
    const jaRoma = "";
    return {
      speciesId: p.speciesId,
      nameByLocale: {
        en: p.displayName ?? p.name,
        ja: jaKana || p.displayName ?? p.name,
        "zh-Hans": zhHans || p.displayName ?? p.name,
        "zh-Hant": zhHant || p.displayName ?? p.name,
      },
      transliterationByLocale: {
        ja: normaliseRomaji(jaRoma, jaKana) || p.displayName ?? p.name,
        "zh-Hans": zhHans ? generatePinyin(zhHans) : p.displayName ?? p.name,
        "zh-Hant": zhHant ? generatePinyin(zhHant) : p.displayName ?? p.name,
      },
    };
  });

localeNamesRecords.sort((a, b) => a.speciesId - b.speciesId);
const localeNamesJson = JSON.stringify(localeNamesRecords);
await writeFile(resolve(libDir, "generated-locale-names.json"), localeNamesJson, "utf-8");
await writeFile(resolve(publicDir, "generated-locale-names.json"), localeNamesJson, "utf-8");

const coreSize = JSON.stringify(coreRecords).length;
const chainsSize = JSON.stringify({ chains: chainsByHash, pokemonChain }).length;
const flavorSize = flavorJson.length;
const localeNamesSize = localeNamesJson.length;
process.stdout.write(
  `Split seed files written:\n` +
  `  generated-core.json:         ${(coreSize / 1024).toFixed(0)} KB\n` +
  `  generated-chains.json:       ${(chainsSize / 1024).toFixed(0)} KB\n` +
  `  generated-flavor.json:       ${(flavorSize / 1024).toFixed(0)} KB (lib/ + public/pokemon-data/)\n` +
  `  generated-locale-names.json: ${(localeNamesSize / 1024).toFixed(0)} KB (lib/ + public/pokemon-data/)\n`,
);
