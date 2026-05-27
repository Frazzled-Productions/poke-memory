#!/usr/bin/env node
// scripts/split-seed.mjs
// Re-generates the three split seed files from an existing generated.json
// without re-fetching from PokéAPI.  Run after any manual edit to generated.json.
//
// Usage: node scripts/split-seed.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

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

const coreSize = JSON.stringify(coreRecords).length;
const chainsSize = JSON.stringify({ chains: chainsByHash, pokemonChain }).length;
const flavorSize = flavorJson.length;
process.stdout.write(
  `Split seed files written:\n` +
  `  generated-core.json:   ${(coreSize / 1024).toFixed(0)} KB\n` +
  `  generated-chains.json: ${(chainsSize / 1024).toFixed(0)} KB\n` +
  `  generated-flavor.json: ${(flavorSize / 1024).toFixed(0)} KB (lib/ + public/pokemon-data/)\n`,
);
