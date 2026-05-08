// scripts/seed-pokemon.mjs
// Fetches all canonical Pokémon species from PokéAPI and writes
// lib/pokemon/generated.json.  Run with: node scripts/seed-pokemon.mjs
// Node 20+ — uses global fetch, node:fs/promises, node:path, node:url.

import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPECIES_LIST_URL =
  "https://pokeapi.co/api/v2/pokemon-species?limit=10000&offset=0";
const CONCURRENCY = 20;
const MAX_RETRIES = 3;
const BACKOFF_MS = [500, 1000, 2000];
const PROGRESS_INTERVAL = 50;

const FLAVOR_TEXTS_MAX = 12;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sleep for `ms` milliseconds. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a URL with retry on 5xx / network errors.
 * Returns { ok: true, data } or { ok: false, reason, fatal }
 *   fatal=true  → caller should skip the record entirely (non-retryable failure)
 *   fatal=false → transient, already exhausted retries
 */
async function fetchWithRetry(url, label) {
  let attempt = 0;
  while (true) {
    let res;
    try {
      res = await fetch(url);
    } catch (networkErr) {
      // Network-level error
      if (attempt < MAX_RETRIES) {
        const delay = BACKOFF_MS[attempt];
        process.stderr.write(
          `[seed] WARN: network error for ${label} (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms: ${networkErr.message}\n`
        );
        await sleep(delay);
        attempt++;
        continue;
      }
      return { ok: false, reason: networkErr.message, fatal: false };
    }

    if (res.status === 429) {
      process.stderr.write(
        `[seed] WARN: rate-limited at ${label}, skipping\n`
      );
      return { ok: false, reason: "rate-limited", fatal: true };
    }

    if (res.status >= 500) {
      if (attempt < MAX_RETRIES) {
        const delay = BACKOFF_MS[attempt];
        process.stderr.write(
          `[seed] WARN: HTTP ${res.status} for ${label} (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms\n`
        );
        await sleep(delay);
        attempt++;
        continue;
      }
      return { ok: false, reason: `HTTP ${res.status}`, fatal: false };
    }

    if (!res.ok) {
      // 4xx other than 429 — non-retryable
      process.stderr.write(
        `[seed] WARN: HTTP ${res.status} for ${label}, skipping\n`
      );
      return { ok: false, reason: `HTTP ${res.status}`, fatal: true };
    }

    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      process.stderr.write(
        `[seed] WARN: JSON parse error for ${label}: ${parseErr.message}, skipping\n`
      );
      return { ok: false, reason: "json-parse", fatal: true };
    }

    return { ok: true, data };
  }
}


function extractFlavorTexts(flavorTextEntries) {
  const en = (flavorTextEntries ?? []).filter(e => e.language?.name === "en");
  if (en.length === 0) return [];
  const seen = new Set();
  const results = [];
  for (const entry of en) {
    const normalized = normalizeFlavorText(entry.flavor_text);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    results.push(normalized);
    if (results.length >= FLAVOR_TEXTS_MAX) break;
  }
  return results;
}

function normalizeFlavorText(text) {
  if (!text) return "";
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out += (code === 12 || code === 10 || code === 13) ? " " : text[i];
  }
  return out.replace(/  +/g, " ").trim();
}

function flattenChain(node, evolvesFromId, idToName) {
  const url = node.species?.url ?? "";
  const parts = url.split("/").filter(Boolean);
  const speciesId = parseInt(parts[parts.length - 1] || parts[parts.length - 2], 10);
  if (!speciesId || isNaN(speciesId)) return [];
  const name = idToName.get(speciesId) ?? node.species.name;
  const nodes = [{ speciesId, name, evolvesFromId }];
  for (const child of (node.evolves_to ?? [])) {
    nodes.push(...flattenChain(child, speciesId, idToName));
  }
  return nodes;
}
/**
 * Process a single species ID. Returns a record object or null if it should
 * be skipped.
 */
async function processSpecies(id) {
  // 1. Fetch species for display name
  const speciesResult = await fetchWithRetry(
    `https://pokeapi.co/api/v2/pokemon-species/${id}`,
    `species/${id}`
  );
  if (!speciesResult.ok) return null;

  const speciesData = speciesResult.data;

  // Extract English display name
  const englishEntry = speciesData.names?.find(
    (n) => n.language?.name === "en"
  );
  if (!englishEntry) {
    process.stderr.write(
      `[seed] WARN: no English name for species ${id}, skipping\n`
    );
    return null;
  }
  const name = englishEntry.name;
  const flavorTexts = extractFlavorTexts(speciesData.flavor_text_entries);
  const flavorText = flavorTexts[0] ?? "";
  const evolutionChainUrl = speciesData.evolution_chain?.url ?? null;

  const genus = speciesData.genera?.find(g => g.language?.name === "en")?.genus ?? null;
  const generation = speciesData.generation?.name ?? null;
  const captureRate = speciesData.capture_rate ?? null;
  const baseHappiness = speciesData.base_happiness ?? null;
  const growthRate = speciesData.growth_rate?.name ?? null;
  const habitat = speciesData.habitat?.name ?? null;
  const genderRate = speciesData.gender_rate ?? null;
  const isLegendary = speciesData.is_legendary ?? false;
  const isMythical = speciesData.is_mythical ?? false;

  // 2. Fetch the base form's Pokémon data for the sprite
  const pokemonUrl = speciesData.varieties?.[0]?.pokemon?.url;
  if (!pokemonUrl) {
    process.stderr.write(
      `[seed] WARN: no variety URL for ${id} (${name}), skipping\n`
    );
    return null;
  }

  const pokemonResult = await fetchWithRetry(pokemonUrl, `pokemon/${id}`);
  if (!pokemonResult.ok) return null;

  const pokemonData = pokemonResult.data;

  // Sprite preference: official-artwork → front_default → skip
  const spriteUrl =
    pokemonData.sprites?.other?.["official-artwork"]?.front_default ??
    pokemonData.sprites?.front_default ??
    null;

  if (!spriteUrl) {
    process.stderr.write(
      `[seed] WARN: no sprite for ${id} (${name})\n`
    );
    return null;
  }

  const types = (pokemonData.types ?? []).map(t => t.type.name);

  const statsMap = {};
  for (const s of (pokemonData.stats ?? [])) {
    statsMap[s.stat.name] = s.base_stat;
  }
  const stats = {
    hp: statsMap["hp"] ?? 0,
    attack: statsMap["attack"] ?? 0,
    defense: statsMap["defense"] ?? 0,
    specialAttack: statsMap["special-attack"] ?? 0,
    specialDefense: statsMap["special-defense"] ?? 0,
    speed: statsMap["speed"] ?? 0,
  };

  const height = pokemonData.height ?? null;
  const weight = pokemonData.weight ?? null;
  const baseExperience = pokemonData.base_experience ?? null;

  return {
    id, name, spriteUrl,
    height, weight, baseExperience,
    types, stats, flavorText, flavorTexts,
    genus, generation, captureRate, baseHappiness,
    growthRate, habitat, genderRate, isLegendary, isMythical,
    evolutionChainUrl,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Resolve output path relative to this script so CWD doesn't matter
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outputPath = resolve(__dirname, "../lib/pokemon/generated.json");

  // ------------------------------------------------------------------
  // Step 1: Fetch species list
  // ------------------------------------------------------------------
  process.stderr.write(`[seed] Fetching species list from PokéAPI...\n`);

  let listRes;
  try {
    listRes = await fetch(SPECIES_LIST_URL);
  } catch (err) {
    process.stderr.write(
      `[seed] ERROR: failed to fetch species list: ${err.message}\n`
    );
    process.exit(1);
  }

  if (!listRes.ok) {
    process.stderr.write(
      `[seed] ERROR: species list returned HTTP ${listRes.status}\n`
    );
    process.exit(1);
  }

  let listData;
  try {
    listData = await listRes.json();
  } catch (err) {
    process.stderr.write(
      `[seed] ERROR: failed to parse species list JSON: ${err.message}\n`
    );
    process.exit(1);
  }

  const results = listData.results ?? [];
  const total = results.length;
  process.stderr.write(`[seed] Fetched ${total} species\n`);

  // Extract numeric IDs from the url field (e.g. ".../pokemon-species/1/")
  const speciesIds = results
    .map((entry) => {
      const match = entry.url?.match(/\/pokemon-species\/(\d+)\/?$/);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((id) => id !== null);

  if (speciesIds.length === 0) {
    process.stderr.write(`[seed] ERROR: no species IDs parsed from list\n`);
    process.exit(1);
  }

  // ------------------------------------------------------------------
  // Step 2: Process species in batches with concurrency cap
  // ------------------------------------------------------------------
  const partialRecords = [];
  let done = 0;
  let skipped = 0;

  for (let i = 0; i < speciesIds.length; i += CONCURRENCY) {
    const batch = speciesIds.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map((id) => processSpecies(id)));

    for (let j = 0; j < batchResults.length; j++) {
      const record = batchResults[j];
      done++;
      if (record === null) {
        skipped++;
      } else {
        partialRecords.push(record);
        // Progress every PROGRESS_INTERVAL species
        if (done % PROGRESS_INTERVAL === 0) {
          process.stderr.write(
            `[seed] [${done}/${total}] ${record.name}\n`
          );
        }
      }
    }
  }

  process.stderr.write(
    `[seed] Phase 1 complete: ${partialRecords.length} records, ${skipped} skipped
`
  );

  // ------------------------------------------------------------------
  // Step 3: Fetch evolution chains (deduped by URL)
  // ------------------------------------------------------------------
  const idToName = new Map(partialRecords.map(r => [r.id, r.name]));
  const uniqueChainUrls = [...new Set(partialRecords.map(r => r.evolutionChainUrl).filter(Boolean))];

  process.stderr.write(
    `[seed] Fetching ${uniqueChainUrls.length} unique evolution chains...
`
  );

  const chainDataMap = new Map();
  let chainsDone = 0;

  for (let i = 0; i < uniqueChainUrls.length; i += CONCURRENCY) {
    const batch = uniqueChainUrls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async url => {
        const result = await fetchWithRetry(url, url);
        return { url, result };
      })
    );
    for (const { url, result } of batchResults) {
      chainsDone++;
      if (result.ok) {
        chainDataMap.set(url, flattenChain(result.data.chain, null, idToName));
      } else {
        chainDataMap.set(url, []);
      }
      if (chainsDone % 100 === 0) {
        process.stderr.write(
          `[seed] [phase 2] ${chainsDone}/${uniqueChainUrls.length} chains
`
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // Step 4: Merge chains, sort, and write output
  // ------------------------------------------------------------------
  const records = partialRecords.map(({ evolutionChainUrl: _url, ...rest }) => ({
    ...rest,
    evolutionChain: _url ? (chainDataMap.get(_url) ?? []) : [],
  }));

  records.sort((a, b) => a.id - b.id);

  const json = JSON.stringify(records, null, 2);
  await writeFile(outputPath, json, "utf-8");

  process.stderr.write(
    `[seed] Wrote ${records.length} records to lib/pokemon/generated.json
`
  );

  if (skipped > 0) {
    process.stderr.write(
      `[seed] Skipped ${skipped} species (warnings logged above)
`
    );
  }
}

main();
