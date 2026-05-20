// scripts/seed-version-groups.mjs
// Enriches lib/pokemon/generated.json with a `versionGroups: string[]` field
// per entry, listing every version-group whose pokedex includes the species.
//
// Why a separate script?  The main seed-pokemon.mjs downloads sprites and cries
// from PokéAPI which takes ~hours; this enrichment only needs metadata, so
// running it independently is fast (~30 seconds end-to-end) and keeps the main
// seed pipeline untouched.
//
// Idempotent: re-running produces the same output for the same PokéAPI state.
//
// Form handling: regional alternate forms (Alolan/Galarian/Hisuian/Paldean)
// receive only the region-matching version-groups instead of the default
// species' full membership.  Non-regional `forme` entries (Rotom appliances,
// Deoxys formes, etc.) inherit the default species' version-groups since they
// appear in the same dex slot.
//
// Run with: node scripts/seed-version-groups.mjs

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_GROUP_LIST_URL =
  "https://pokeapi.co/api/v2/version-group/?limit=100";
const CONCURRENCY = 10;
const MAX_RETRIES = 3;
const BACKOFF_MS = [500, 1000, 2000];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url, label) {
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
      throw new Error(`network error for ${label}: ${err.message}`);
    }
    if (res.status === 429) {
      // Conservative: wait longer and retry once on rate-limit.
      if (attempt < MAX_RETRIES) {
        process.stderr.write(`[vg-seed] rate-limited at ${label}, backing off\n`);
        await sleep(2000);
        attempt++;
        continue;
      }
      throw new Error(`rate-limited at ${label}`);
    }
    if (res.status >= 500) {
      if (attempt < MAX_RETRIES) {
        await sleep(BACKOFF_MS[attempt]);
        attempt++;
        continue;
      }
      throw new Error(`HTTP ${res.status} for ${label}`);
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${label}`);
    }
    return res.json();
  }
}

/** Map a pokedex slug to the regional-form prefix it corresponds to, or null. */
function regionalPrefixForPokedex(pokedexSlug) {
  // Pokedex slugs that house regional variants.
  // (original-alola / updated-alola for SM / USUM; original-melemele etc are
  // sub-island dexes that also live within the SM/USUM version-groups.)
  if (/(^|-)alola/.test(pokedexSlug) || /melemele|akala|ulaula|poni/.test(pokedexSlug)) return "alola";
  if (/(^|-)galar/.test(pokedexSlug) || /isle-of-armor|crown-tundra/.test(pokedexSlug)) return "galar";
  if (/(^|-)hisui/.test(pokedexSlug)) return "hisui";
  if (/(^|-)paldea/.test(pokedexSlug) || /kitakami|blueberry|indigo-disk|teal-mask/.test(pokedexSlug)) return "paldea";
  return null;
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const seedPath = resolve(__dirname, "../lib/pokemon/generated.json");

  process.stderr.write("[vg-seed] Fetching version-group list...\n");
  const vgList = await fetchWithRetry(VERSION_GROUP_LIST_URL, "version-group list");

  // Map: pokedexSlug -> Set<versionGroupSlug>
  const pokedexToVersionGroups = new Map();
  // Map: versionGroupSlug -> string[] of pokedexSlugs (for diagnostics)
  const versionGroupToPokedexes = new Map();

  process.stderr.write(`[vg-seed] Found ${vgList.results.length} version-groups, fetching each...\n`);

  // Fetch each version-group to learn its pokedexes.
  for (let i = 0; i < vgList.results.length; i += CONCURRENCY) {
    const batch = vgList.results.slice(i, i + CONCURRENCY);
    const responses = await Promise.all(
      batch.map((vg) => fetchWithRetry(vg.url, `version-group/${vg.name}`)),
    );
    for (let j = 0; j < responses.length; j++) {
      const vgSlug = batch[j].name;
      const data = responses[j];
      const pokedexes = (data.pokedexes ?? []).map((p) => p.name);
      versionGroupToPokedexes.set(vgSlug, pokedexes);
      for (const pdex of pokedexes) {
        if (!pokedexToVersionGroups.has(pdex)) {
          pokedexToVersionGroups.set(pdex, new Set());
        }
        pokedexToVersionGroups.get(pdex).add(vgSlug);
      }
    }
  }

  process.stderr.write(`[vg-seed] Collected ${pokedexToVersionGroups.size} unique pokedexes across all version-groups\n`);

  // Fetch each pokedex to enumerate its species.
  const pokedexSlugs = [...pokedexToVersionGroups.keys()];

  // speciesId -> Set<versionGroupSlug>
  const speciesIdToVersionGroups = new Map();
  // speciesId -> Set<pokedexSlug> (used to determine regional-form membership)
  const speciesIdToPokedexes = new Map();

  process.stderr.write(`[vg-seed] Fetching ${pokedexSlugs.length} pokedexes...\n`);

  for (let i = 0; i < pokedexSlugs.length; i += CONCURRENCY) {
    const batch = pokedexSlugs.slice(i, i + CONCURRENCY);
    const responses = await Promise.all(
      batch.map((slug) =>
        fetchWithRetry(`https://pokeapi.co/api/v2/pokedex/${slug}/`, `pokedex/${slug}`),
      ),
    );
    for (let j = 0; j < responses.length; j++) {
      const pdex = batch[j];
      const vgs = pokedexToVersionGroups.get(pdex) ?? new Set();
      const entries = responses[j].pokemon_entries ?? [];
      for (const entry of entries) {
        const url = entry.pokemon_species?.url ?? "";
        const m = url.match(/\/pokemon-species\/(\d+)\/?$/);
        if (!m) continue;
        const speciesId = parseInt(m[1], 10);
        if (!speciesIdToVersionGroups.has(speciesId)) {
          speciesIdToVersionGroups.set(speciesId, new Set());
          speciesIdToPokedexes.set(speciesId, new Set());
        }
        const setVG = speciesIdToVersionGroups.get(speciesId);
        const setPD = speciesIdToPokedexes.get(speciesId);
        setPD.add(pdex);
        for (const vg of vgs) setVG.add(vg);
      }
    }
    process.stderr.write(
      `[vg-seed] [${Math.min(i + CONCURRENCY, pokedexSlugs.length)}/${pokedexSlugs.length}] pokedexes processed\n`,
    );
  }

  process.stderr.write(`[vg-seed] Resolved version-groups for ${speciesIdToVersionGroups.size} species\n`);

  // Now load the existing seed and enrich.
  process.stderr.write(`[vg-seed] Loading existing seed at ${seedPath}\n`);
  const raw = await readFile(seedPath, "utf-8");
  const records = JSON.parse(raw);

  // For regional forms, narrow to version-groups whose pokedex slug matches
  // the regional prefix.  Build a fast lookup from versionGroupSlug -> Set of
  // its pokedex slugs.
  const vgToPokedexSet = new Map();
  for (const [vg, pdexes] of versionGroupToPokedexes) {
    vgToPokedexSet.set(vg, new Set(pdexes));
  }

  function regionalPrefixForFormSlug(formSlug) {
    if (!formSlug) return null;
    if (/^alola/.test(formSlug)) return "alola";
    if (/^galar/.test(formSlug)) return "galar";
    if (/^hisui/.test(formSlug)) return "hisui";
    if (/^paldea/.test(formSlug)) return "paldea";
    return null;
  }

  let enrichedCount = 0;
  let missingCount = 0;
  let regionalNarrowed = 0;

  for (const rec of records) {
    const speciesId = rec.speciesId;
    const allForSpecies = speciesIdToVersionGroups.get(speciesId);
    if (!allForSpecies || allForSpecies.size === 0) {
      // Species not in any pokedex (very unusual — likely a brand-new species
      // whose dex membership hasn't been published yet).  Preserve any prior
      // versionGroups field rather than wiping it.
      if (!Array.isArray(rec.versionGroups)) rec.versionGroups = [];
      missingCount++;
      continue;
    }

    const regionalPrefix = !rec.isDefaultForm ? regionalPrefixForFormSlug(rec.formSlug) : null;

    if (regionalPrefix) {
      // Only keep version-groups whose pokedex slugs include the regional prefix
      // (e.g. an Alolan form lives in original-alola / updated-alola dexes only).
      const allowed = [];
      for (const vg of allForSpecies) {
        const pdexes = vgToPokedexSet.get(vg) ?? new Set();
        let matchesRegion = false;
        for (const pdex of pdexes) {
          if (regionalPrefixForPokedex(pdex) === regionalPrefix) {
            matchesRegion = true;
            break;
          }
        }
        if (matchesRegion) allowed.push(vg);
      }
      rec.versionGroups = allowed.sort();
      regionalNarrowed++;
    } else {
      rec.versionGroups = [...allForSpecies].sort();
    }
    enrichedCount++;
  }

  process.stderr.write(
    `[vg-seed] Enriched: ${enrichedCount} (${regionalNarrowed} regional narrowed), ${missingCount} without any pokedex membership\n`,
  );

  const json = JSON.stringify(records, null, 2) + "\n";
  await writeFile(seedPath, json, "utf-8");
  process.stderr.write(`[vg-seed] Wrote ${records.length} records to ${seedPath}\n`);

  // Diagnostic: print version-group coverage counts.
  const vgCounts = new Map();
  for (const rec of records) {
    for (const vg of rec.versionGroups ?? []) {
      vgCounts.set(vg, (vgCounts.get(vg) ?? 0) + 1);
    }
  }
  const sorted = [...vgCounts.entries()].sort((a, b) => b[1] - a[1]);
  process.stderr.write(`[vg-seed] Coverage by version-group:\n`);
  for (const [vg, n] of sorted) {
    process.stderr.write(`  ${vg.padEnd(36)} ${n}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`[vg-seed] FATAL: ${err.message}\n`);
  process.exit(1);
});
