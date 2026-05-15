// scripts/seed-pokemon.mjs
// Fetches all canonical Pokémon species from PokéAPI and writes
// lib/pokemon/generated.json.  Run with: node scripts/seed-pokemon.mjs
// Node 20+ — uses global fetch, node:fs/promises, node:path, node:url.

import { writeFile, mkdir, readFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

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
 * Write `buffer` to `destPath` atomically: write to a unique sibling temp file
 * first, then rename it into place. `rename` on the same filesystem is atomic,
 * so a concurrent reader sees either the old file or the fully-written new one
 * — never a partial write. This also closes the check-then-write race between
 * the `existsSync` skip-guard and the write itself.
 */
async function writeFileAtomic(destPath, buffer) {
  const tmpPath = `${destPath}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmpPath, buffer);
    await rename(tmpPath, destPath);
  } catch (err) {
    // Best-effort cleanup of the temp file if the rename never happened.
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tmpPath);
    } catch {
      // ignore — temp file may not exist
    }
    throw err;
  }
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


/**
 * Download a sprite from `url` to `destPath`.
 * Skips download if the file already exists (idempotent).
 * Retries on network errors and 5xx responses, same policy as fetchWithRetry.
 * Returns { ok, skipped }.
 */
async function downloadSprite(url, destPath) {
  if (existsSync(destPath)) return { ok: true, skipped: true };

  let attempt = 0;
  while (true) {
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        const delay = BACKOFF_MS[attempt];
        process.stderr.write(
          `[seed] WARN: network error downloading sprite (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms: ${err.message}\n`
        );
        await sleep(delay);
        attempt++;
        continue;
      }
      return { ok: false, skipped: false, reason: err.message };
    }

    if (res.status === 429) {
      process.stderr.write(`[seed] WARN: rate-limited downloading sprite, skipping\n`);
      return { ok: false, skipped: false, reason: "rate-limited" };
    }

    if (res.status >= 500) {
      if (attempt < MAX_RETRIES) {
        const delay = BACKOFF_MS[attempt];
        process.stderr.write(
          `[seed] WARN: HTTP ${res.status} downloading sprite (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms\n`
        );
        await sleep(delay);
        attempt++;
        continue;
      }
      return { ok: false, skipped: false, reason: `HTTP ${res.status}` };
    }

    if (!res.ok) {
      return { ok: false, skipped: false, reason: `HTTP ${res.status}` };
    }

    try {
      const buffer = Buffer.from(await res.arrayBuffer());
      await writeFileAtomic(destPath, buffer);
      return { ok: true, skipped: false };
    } catch (err) {
      return { ok: false, skipped: false, reason: err.message };
    }
  }
}

/**
 * Download a cry from `url` to `destPath`.
 * Skips download if the file already exists (idempotent).
 * Returns { ok, skipped }.
 */
async function downloadCry(url, destPath) {
  if (existsSync(destPath)) return { ok: true, skipped: true };

  let attempt = 0;
  while (true) {
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        const delay = BACKOFF_MS[attempt];
        process.stderr.write(
          `[seed] WARN: network error downloading cry (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms: ${err.message}\n`
        );
        await sleep(delay);
        attempt++;
        continue;
      }
      return { ok: false, skipped: false, reason: err.message };
    }

    if (res.status === 429) {
      process.stderr.write(`[seed] WARN: rate-limited downloading cry, skipping\n`);
      return { ok: false, skipped: false, reason: "rate-limited" };
    }

    if (res.status >= 500) {
      if (attempt < MAX_RETRIES) {
        const delay = BACKOFF_MS[attempt];
        process.stderr.write(
          `[seed] WARN: HTTP ${res.status} downloading cry (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms\n`
        );
        await sleep(delay);
        attempt++;
        continue;
      }
      return { ok: false, skipped: false, reason: `HTTP ${res.status}` };
    }

    if (!res.ok) {
      return { ok: false, skipped: false, reason: `HTTP ${res.status}` };
    }

    try {
      const buffer = Buffer.from(await res.arrayBuffer());
      await writeFileAtomic(destPath, buffer);
      return { ok: true, skipped: false };
    } catch (err) {
      return { ok: false, skipped: false, reason: err.message };
    }
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

// Trim a PokéAPI EvolutionDetail to the slug-flat shape consumed by
// lib/pokemon/triggers.ts. PokéAPI nests references as { name, url }; we
// keep only the slug so the persisted form doesn't force defensive
// null-checks at every consumer.
//
// `region` is included here for use during chain post-processing
// (addFormEdges). It is stripped from the final persisted chain node before
// writing generated.json — see addFormEdges below.
function trimDetail(d) {
  if (!d) return null;
  return {
    trigger: typeof d.trigger === "string" ? d.trigger : (d.trigger?.name ?? "other"),
    min_level: d.min_level ?? null,
    min_happiness: d.min_happiness ?? null,
    min_affection: d.min_affection ?? null,
    min_beauty: d.min_beauty ?? null,
    min_move_count: d.min_move_count ?? null,
    min_steps: d.min_steps ?? null,
    min_damage_taken: d.min_damage_taken ?? null,
    // PokéAPI uses "" as the "any time" sentinel — normalise to null.
    time_of_day: d.time_of_day === "" || d.time_of_day == null ? null : d.time_of_day,
    location: d.location?.name ?? null,
    known_move: d.known_move?.name ?? null,
    known_move_type: d.known_move_type?.name ?? null,
    held_item: d.held_item?.name ?? null,
    needs_overworld_rain: d.needs_overworld_rain === true,
    turn_upside_down: d.turn_upside_down === true,
    relative_physical_stats: d.relative_physical_stats ?? null,
    gender: d.gender ?? null,
    party_species: d.party_species?.name ?? null,
    party_type: d.party_type?.name ?? null,
    item: d.item?.name ?? null,
    trade_species: d.trade_species?.name ?? null,
    used_move: d.used_move?.name ?? null,
    // Seed-time only: which regional variant this edge targets.
    // Stripped before persisting by addFormEdges.
    region: d.region?.name ?? null,
  };
}

// ---------------------------------------------------------------------------
// Form-aware evolution edge helpers
// (Logic mirrors lib/pokemon/chainExpansion.ts which is the TS source for
// unit tests.)
// ---------------------------------------------------------------------------

/**
 * Build a lookup table: speciesId → (formSlug → { pokemonId, displayName }).
 * Only indexes entries where formSlug is a regional prefix
 * (alola / galar / hisui / paldea).
 *
 * @param {Array} records  Partial records from processSpecies, each with
 *   { speciesId, isDefaultForm, formSlug, id, displayName }.
 * @returns {Map<number, Map<string, {pokemonId: number, displayName: string}>>}
 */
function buildVarietiesLookup(records) {
  const lookup = new Map();
  for (const rec of records) {
    if (rec.isDefaultForm || !rec.formSlug) continue;
    // Only index regional slugs — the ones PokéAPI uses in evolution_details.region.
    if (!/^(alola|galar|hisui|paldea)/.test(rec.formSlug)) continue;
    if (!lookup.has(rec.speciesId)) {
      lookup.set(rec.speciesId, new Map());
    }
    lookup.get(rec.speciesId).set(rec.formSlug, {
      pokemonId: rec.id,
      displayName: rec.displayName,
    });
  }
  return lookup;
}

/**
 * Expand region-tagged chain nodes into additional form-aware edge nodes.
 *
 * For each node whose detail.region is non-null:
 *   1. Resolve the child form variety (speciesId → region). Skip if absent.
 *   2. Resolve the parent form variety (evolvesFromId → region). Fall back
 *      to the default pokemonId (= speciesId) if no regional variant exists.
 *   3. Emit an additional node using the form pokemon IDs, stripping `region`
 *      from the persisted detail.
 *
 * Dedup key: `${evolvesFromId}>>>${speciesId}`. Guarantees one node per
 * unique (from, to) pair in the output regardless of how many times a
 * species-level edge appears across the input (e.g. shared chains).
 *
 * @param {Array} nodes     Flat chain nodes from flattenChain.
 * @param {Map}   lookup    VarietiesLookup from buildVarietiesLookup.
 * @returns {Array}         Combined node list, deduped on (evolvesFromId, speciesId).
 */
function addFormEdges(nodes, lookup) {
  const seen = new Set();
  const result = [];

  function pushIfNew(node) {
    const key =
      node.evolvesFromId === null
        ? `null>>>${node.speciesId}`
        : `${node.evolvesFromId}>>>${node.speciesId}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(node);
  }

  for (const node of nodes) {
    // Always emit the node itself (default or no-region).
    pushIfNew(node);

    // Emit a form-aware edge when a region is tagged.
    const region = node.detail?.region;
    if (!region || node.evolvesFromId === null) continue;

    const parentSpeciesId = node.evolvesFromId;
    const childSpeciesId = node.speciesId;

    // Child form: required — skip if the child has no such regional variant.
    const childVarieties = lookup.get(childSpeciesId);
    const childEntry = childVarieties?.get(region);
    if (!childEntry) continue;

    // Parent form: optional — fall back to default pokemonId (= speciesId
    // for default forms whose id matches their speciesId).
    const parentVarieties = lookup.get(parentSpeciesId);
    const parentEntry = parentVarieties?.get(region);
    const parentFormId = parentEntry?.pokemonId ?? parentSpeciesId;

    // Strip `region` from the emitted detail so it is not persisted.
    let detailWithoutRegion = null;
    if (node.detail !== null) {
      const { region: _r, ...rest } = node.detail;
      detailWithoutRegion = rest;
    }

    pushIfNew({
      speciesId: childEntry.pokemonId,
      name: childEntry.displayName,
      evolvesFromId: parentFormId,
      detail: detailWithoutRegion,
    });
  }

  return result;
}

// One node per (parent, child) in evolves_to[]. Multiple evolution_details[]
// entries on a single child (e.g. Urshifu has tower-of-darkness AND
// use-item:scroll-of-darkness on Single-Strike Urshifu) collapse to the first
// detail — picking deduplicates the "alternative paths to the same child" case
// without losing branching, which is encoded as separate evolves_to[] entries.
function flattenChain(node, evolvesFromId, idToName) {
  const url = node.species?.url ?? "";
  const parts = url.split("/").filter(Boolean);
  const speciesId = parseInt(parts[parts.length - 1] || parts[parts.length - 2], 10);
  if (!speciesId || isNaN(speciesId)) return [];
  const name = idToName.get(speciesId) ?? node.species.name;
  const details = node.evolution_details ?? [];
  const detail = details.length > 0 ? trimDetail(details[0]) : null;
  const nodes = [{ speciesId, name, evolvesFromId, detail }];
  for (const child of (node.evolves_to ?? [])) {
    nodes.push(...flattenChain(child, speciesId, idToName));
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Form-filtering helpers
// (Logic mirrors lib/pokemon/forms.ts which is the TS source for unit tests.)
// ---------------------------------------------------------------------------

/**
 * Returns true if a PokéAPI pokemon entry is a stub with no real game data.
 * Stub Megas (IDs 10278+) have base_experience === null and no moves.
 */
function isStubEntry(pokemonData) {
  return (
    pokemonData.base_experience === null &&
    (pokemonData.moves ?? []).length === 0
  );
}

/**
 * Returns true if an alternate form is worth including in the seed.
 * See lib/pokemon/forms.ts for the full v1 scope rationale.
 */
function isWorthLearning(formData, pokemonData) {
  if (isStubEntry(pokemonData)) return false;
  if (formData.is_battle_only) return false;

  const fn = formData.form_name ?? "";
  if (fn === "" || fn === "totem") return false;
  if (/-(meteor)$/.test(fn)) return false;
  if (/(^|-)(gliding|limited|sprinting|swimming|aquatic|drive|glide|low-power)/.test(fn)) return false;

  return true;
}

/**
 * Classifies a form into a broad category for future scope-toggle filtering.
 */
function formCategoryFor(formData) {
  const fn = formData.form_name ?? "";
  if (/^(alola|galar|hisui|paldea)/.test(fn)) return "regional";
  if (/^mega/.test(fn)) return "mega";
  if (fn === "gmax") return "gmax";
  if (fn === "primal") return "primal";
  if (fn === "" || formData.is_default) return "default";
  return "forme";
}

/**
 * Converts a kebab-case slug into a title-cased display name fallback.
 * E.g. "alolan-raichu" → "Alolan Raichu".
 */
function slugToDisplayName(slug) {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Edge-ID allocation for one-card-per-evolution-edge.
//
// Sub-range carve-out inside the evolution namespace [1_000_001, 1_999_999]:
//   [1_000_001, 1_500_000]  reserved for legacy per-pre-evo cloud rows (#262
//                            orphans; never re-issued — see supabase-expert
//                            recommendation in the #262 plan).
//   [1_500_001, 1_999_999]  edge cards.
//
// Stability across re-seeds: load prior generated.json, preserve every
// existing (preEvoId, postEvoId) → edgeId mapping, and only allocate fresh
// IDs for newly-discovered edges (e.g. future generations). Without this,
// adding a single species in the middle of the sort order would re-number
// every later edge and orphan more cloud rows.
const EVOLUTION_ID_OFFSET = 1_000_000;
const EDGE_ID_BASE = EVOLUTION_ID_OFFSET + 500_000; // first edge = 1_500_001
const EVOLUTION_ID_MAX = 2_000_000;

async function allocateEdgeIds(records, outputPath) {
  const priorByKey = new Map(); // "fromId->toId" → edgeId

  if (existsSync(outputPath)) {
    try {
      const priorRaw = await readFile(outputPath, "utf-8");
      const prior = JSON.parse(priorRaw);
      for (const rec of prior) {
        for (const node of rec.evolutionChain ?? []) {
          if (typeof node.edgeId === "number" && node.evolvesFromId !== null) {
            const key = `${node.evolvesFromId}->${node.speciesId}`;
            if (!priorByKey.has(key)) priorByKey.set(key, node.edgeId);
          }
        }
      }
    } catch (err) {
      process.stderr.write(
        `[seed] WARN: could not parse prior generated.json for edge-ID reuse: ${err.message}\n`,
      );
    }
  }

  // Gather all unique edges from the freshly-flattened chains.
  const allEdges = new Set();
  for (const rec of records) {
    for (const node of rec.evolutionChain ?? []) {
      if (node.evolvesFromId !== null) {
        allEdges.add(`${node.evolvesFromId}->${node.speciesId}`);
      }
    }
  }

  // Sort deterministically: (fromId, toId) ascending. Stable across runs as
  // long as the species set is unchanged.
  const sortedEdges = [...allEdges].sort((a, b) => {
    const [aF, aT] = a.split("->").map(Number);
    const [bF, bT] = b.split("->").map(Number);
    return aF - bF || aT - bT;
  });

  // New IDs start after the highest prior ID (or at base+1 on first run).
  let nextId = EDGE_ID_BASE + 1;
  for (const id of priorByKey.values()) {
    if (id >= nextId) nextId = id + 1;
  }

  const edgeIdByKey = new Map(priorByKey);
  let allocated = 0;
  let reused = 0;
  for (const key of sortedEdges) {
    if (edgeIdByKey.has(key)) {
      reused++;
    } else {
      if (nextId >= EVOLUTION_ID_MAX) {
        throw new Error(`Edge-ID allocator overflowed evolution namespace at ${nextId}`);
      }
      edgeIdByKey.set(key, nextId++);
      allocated++;
    }
  }

  // Validate every ID is in-range. Defensive — also catches corrupt priors.
  for (const id of edgeIdByKey.values()) {
    if (id <= EDGE_ID_BASE || id >= EVOLUTION_ID_MAX) {
      throw new Error(
        `Edge ID ${id} outside reserved sub-range (${EDGE_ID_BASE + 1}..${EVOLUTION_ID_MAX - 1}); namespace integrity check failed.`,
      );
    }
  }

  // Attach to each chain node. The same edge appears in every species record
  // within its chain (Eevee's chain has 8 edges; each is referenced 9× — once
  // per species in the chain). Same ID, every time.
  for (const rec of records) {
    for (const node of rec.evolutionChain ?? []) {
      if (node.evolvesFromId !== null) {
        const key = `${node.evolvesFromId}->${node.speciesId}`;
        node.edgeId = edgeIdByKey.get(key);
      }
    }
  }

  process.stderr.write(
    `[seed] Edge IDs: ${reused} reused, ${allocated} newly allocated (range ${EDGE_ID_BASE + 1}..${nextId - 1})\n`,
  );
}
/**
 * Process a single species ID.
 *
 * Returns an array of partial records — one for the default form plus one per
 * included alternate form. Returns an empty array if the default form should
 * be skipped entirely (e.g. missing sprite).
 *
 * The records at this stage carry `remoteSpriteUrl`, `remoteCryUrl`, and
 * `evolutionChainUrl` (resolved later); these are stripped before writing
 * generated.json.
 */
async function processSpecies(speciesId) {
  // ------------------------------------------------------------------
  // Step 1: Fetch species data (display name, chain, varieties list)
  // ------------------------------------------------------------------
  const speciesResult = await fetchWithRetry(
    `https://pokeapi.co/api/v2/pokemon-species/${speciesId}`,
    `species/${speciesId}`
  );
  if (!speciesResult.ok) return [];

  const speciesData = speciesResult.data;

  // English display name from the species record.
  const englishEntry = speciesData.names?.find(
    (n) => n.language?.name === "en"
  );
  if (!englishEntry) {
    process.stderr.write(
      `[seed] WARN: no English name for species ${speciesId}, skipping\n`
    );
    return [];
  }
  const speciesDisplayName = englishEntry.name;
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

  const varieties = speciesData.varieties ?? [];

  // ------------------------------------------------------------------
  // Step 2: Fetch default variety (varieties[0])
  // ------------------------------------------------------------------
  const defaultVariety = varieties[0];
  if (!defaultVariety?.pokemon?.url) {
    process.stderr.write(
      `[seed] WARN: no variety URL for species ${speciesId} (${speciesDisplayName}), skipping\n`
    );
    return [];
  }

  // The default variety's pokemon ID is extracted from the URL.
  const defaultPokemonIdMatch = defaultVariety.pokemon.url.match(/\/pokemon\/(\d+)\/?$/);
  const defaultPokemonId = defaultPokemonIdMatch
    ? parseInt(defaultPokemonIdMatch[1], 10)
    : speciesId;

  const defaultPokemonResult = await fetchWithRetry(
    defaultVariety.pokemon.url,
    `pokemon/${defaultPokemonId}`
  );
  if (!defaultPokemonResult.ok) return [];

  const defaultPokemonData = defaultPokemonResult.data;

  const defaultSpriteUrl =
    defaultPokemonData.sprites?.other?.["official-artwork"]?.front_default ??
    defaultPokemonData.sprites?.front_default ??
    null;

  if (!defaultSpriteUrl) {
    process.stderr.write(
      `[seed] WARN: no sprite for species ${speciesId} (${speciesDisplayName})\n`
    );
    return [];
  }

  const defaultCryUrl = defaultPokemonData.cries?.latest ?? null;
  const defaultTypes = (defaultPokemonData.types ?? []).map(t => t.type.name);
  const defaultStatsMap = {};
  for (const s of (defaultPokemonData.stats ?? [])) {
    defaultStatsMap[s.stat.name] = s.base_stat;
  }
  const defaultStats = {
    hp: defaultStatsMap["hp"] ?? 0,
    attack: defaultStatsMap["attack"] ?? 0,
    defense: defaultStatsMap["defense"] ?? 0,
    specialAttack: defaultStatsMap["special-attack"] ?? 0,
    specialDefense: defaultStatsMap["special-defense"] ?? 0,
    speed: defaultStatsMap["speed"] ?? 0,
  };

  const results = [];

  // Default-form record.
  results.push({
    id: defaultPokemonId,
    speciesId,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: speciesDisplayName,
    name: speciesDisplayName,
    remoteSpriteUrl: defaultSpriteUrl,
    remoteCryUrl: defaultCryUrl,
    height: defaultPokemonData.height ?? null,
    weight: defaultPokemonData.weight ?? null,
    baseExperience: defaultPokemonData.base_experience ?? null,
    types: defaultTypes,
    stats: defaultStats,
    flavorText,
    flavorTexts,
    genus,
    generation,
    captureRate,
    baseHappiness,
    growthRate,
    habitat,
    genderRate,
    isLegendary,
    isMythical,
    evolutionChainUrl,
  });

  // ------------------------------------------------------------------
  // Step 3: Walk alternate varieties (varieties[1..n])
  // ------------------------------------------------------------------
  for (let i = 1; i < varieties.length; i++) {
    const variety = varieties[i];
    if (!variety?.pokemon?.url) continue;

    const altIdMatch = variety.pokemon.url.match(/\/pokemon\/(\d+)\/?$/);
    if (!altIdMatch) continue;
    const altPokemonId = parseInt(altIdMatch[1], 10);

    // Fetch pokemon data for sprite / types / stats / stub check.
    const altPokemonResult = await fetchWithRetry(
      variety.pokemon.url,
      `pokemon/${altPokemonId}`
    );
    if (!altPokemonResult.ok) continue;
    const altPokemonData = altPokemonResult.data;

    // Stub-entry check (fan-wiki Megas with IDs 10278+).
    if (isStubEntry(altPokemonData)) {
      process.stderr.write(
        `[seed] SKIP: stub entry ${altPokemonId} (species ${speciesId})\n`
      );
      continue;
    }

    // Fetch pokemon-form for form_name, is_battle_only, names[].
    // PokéAPI provides the forms[] array on the pokemon; use the first form slug.
    const formSlugOrUrl = altPokemonData.forms?.[0]?.url;
    if (!formSlugOrUrl) {
      process.stderr.write(
        `[seed] WARN: no form URL for variety ${altPokemonId} (species ${speciesId}), skipping alt\n`
      );
      continue;
    }

    const formResult = await fetchWithRetry(formSlugOrUrl, `form/${altPokemonId}`);
    if (!formResult.ok) continue;
    const formData = formResult.data;

    if (!isWorthLearning(formData, altPokemonData)) {
      continue;
    }

    const category = formCategoryFor(formData);
    const formSlug = formData.form_name || null;

    // Display name: English from pokemon-form.names[], fallback to slug title-case.
    const formEnglishName = (formData.names ?? []).find(
      (n) => n.language?.name === "en"
    )?.name ?? null;
    const displayName = formEnglishName ?? slugToDisplayName(variety.pokemon.name ?? String(altPokemonId));

    const altSpriteUrl =
      altPokemonData.sprites?.other?.["official-artwork"]?.front_default ??
      altPokemonData.sprites?.front_default ??
      null;

    if (!altSpriteUrl) {
      process.stderr.write(
        `[seed] WARN: no sprite for alt form ${altPokemonId} (species ${speciesId}), skipping\n`
      );
      continue;
    }

    const altCryUrl = altPokemonData.cries?.latest ?? null;
    const altTypes = (altPokemonData.types ?? []).map(t => t.type.name);
    const altStatsMap = {};
    for (const s of (altPokemonData.stats ?? [])) {
      altStatsMap[s.stat.name] = s.base_stat;
    }
    const altStats = {
      hp: altStatsMap["hp"] ?? 0,
      attack: altStatsMap["attack"] ?? 0,
      defense: altStatsMap["defense"] ?? 0,
      specialAttack: altStatsMap["special-attack"] ?? 0,
      specialDefense: altStatsMap["special-defense"] ?? 0,
      speed: altStatsMap["speed"] ?? 0,
    };

    results.push({
      id: altPokemonId,
      speciesId,
      isDefaultForm: false,
      formCategory: category,
      formSlug,
      displayName,
      // `name` mirrors displayName for compatibility with consumers that read `name`.
      name: displayName,
      remoteSpriteUrl: altSpriteUrl,
      remoteCryUrl: altCryUrl,
      height: altPokemonData.height ?? null,
      weight: altPokemonData.weight ?? null,
      baseExperience: altPokemonData.base_experience ?? null,
      types: altTypes,
      stats: altStats,
      flavorText,
      flavorTexts,
      genus,
      generation,
      captureRate,
      baseHappiness,
      growthRate,
      habitat,
      genderRate,
      isLegendary,
      isMythical,
      // Evolution chain is shared with the default form.
      // Form-aware evolution edges are tracked separately in #448.
      evolutionChainUrl,
    });
  }

  return results;
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
  // processSpecies now returns an array (default form + included alt forms).
  // ------------------------------------------------------------------
  const partialRecords = [];
  let done = 0;
  let skipped = 0;

  for (let i = 0; i < speciesIds.length; i += CONCURRENCY) {
    const batch = speciesIds.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map((id) => processSpecies(id)));

    for (let j = 0; j < batchResults.length; j++) {
      const speciesRecords = batchResults[j]; // always an array
      done++;
      if (speciesRecords.length === 0) {
        skipped++;
      } else {
        for (const record of speciesRecords) {
          partialRecords.push(record);
        }
        // Progress every PROGRESS_INTERVAL species (keyed on the default form).
        if (done % PROGRESS_INTERVAL === 0) {
          const defaultRecord = speciesRecords.find(r => r.isDefaultForm) ?? speciesRecords[0];
          process.stderr.write(
            `[seed] [${done}/${total}] ${defaultRecord.displayName} (${speciesRecords.length} form${speciesRecords.length > 1 ? "s" : ""})\n`
          );
        }
      }
    }
  }

  process.stderr.write(
    `[seed] Phase 1 complete: ${partialRecords.length} records (including alt forms), ${skipped} species skipped\n`
  );

  // ------------------------------------------------------------------
  // Step 3: Fetch evolution chains (deduped by URL)
  // idToName is keyed on speciesId (the canonical species integer) since
  // flattenChain resolves names from speciesId nodes in the chain JSON.
  // ------------------------------------------------------------------
  const idToName = new Map(
    partialRecords
      .filter(r => r.isDefaultForm)
      .map(r => [r.speciesId, r.displayName])
  );
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
  // Step 3.1: Expand region-tagged edges into form-aware edge nodes.
  // Build a varieties lookup from the partial records (formSlug → pokemonId)
  // then post-process each chain to add edges using form pokemon IDs.
  // Dedup key: `${evolvesFromId}>>>${speciesId}`.
  // ------------------------------------------------------------------
  const varietiesLookup = buildVarietiesLookup(partialRecords);
  let formEdgesAdded = 0;
  for (const [url, nodes] of chainDataMap) {
    const expanded = addFormEdges(nodes, varietiesLookup);
    formEdgesAdded += expanded.length - nodes.length;
    chainDataMap.set(url, expanded);
  }
  process.stderr.write(
    `[seed] Form-aware edges: ${formEdgesAdded} additional edge nodes added across ${chainDataMap.size} chains\n`
  );

  // ------------------------------------------------------------------
  // Step 3.5: Download sprites to public/sprites/pokemon/
  // ------------------------------------------------------------------
  const spritesDir = resolve(__dirname, "../public/sprites/pokemon");
  await mkdir(spritesDir, { recursive: true });

  let spritesDownloaded = 0;
  let spritesSkipped = 0;
  let spritesFailed = 0;
  const failedSpriteIds = new Set();

  for (let i = 0; i < partialRecords.length; i += CONCURRENCY) {
    const batch = partialRecords.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (record) => {
      const destPath = resolve(spritesDir, `${record.id}.png`);
      const result = await downloadSprite(record.remoteSpriteUrl, destPath);
      if (!result.ok) {
        process.stderr.write(
          `[seed] WARN: sprite download failed for ${record.id} (${record.name}): ${result.reason}\n`
        );
        spritesFailed++;
        failedSpriteIds.add(record.id);
      } else if (result.skipped) {
        spritesSkipped++;
      } else {
        spritesDownloaded++;
      }
    }));
    if ((i + CONCURRENCY) % (CONCURRENCY * 5) === 0) {
      process.stderr.write(
        `[seed] [sprites] ${Math.min(i + CONCURRENCY, partialRecords.length)}/${partialRecords.length} processed\n`
      );
    }
  }

  process.stderr.write(
    `[seed] Sprites: ${spritesDownloaded} downloaded, ${spritesSkipped} already existed, ${spritesFailed} failed\n`
  );

  // ------------------------------------------------------------------
  // Step 3.6: Download cries to public/cries/
  // ------------------------------------------------------------------
  const criesDir = resolve(__dirname, "../public/cries");
  await mkdir(criesDir, { recursive: true });

  let criesDownloaded = 0;
  let criesSkipped = 0;
  let criesFailed = 0;
  const failedCryIds = new Set();

  for (let i = 0; i < partialRecords.length; i += CONCURRENCY) {
    const batch = partialRecords.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (record) => {
      if (!record.remoteCryUrl) return;
      const destPath = resolve(criesDir, `${record.id}.ogg`);
      const result = await downloadCry(record.remoteCryUrl, destPath);
      if (!result.ok) {
        process.stderr.write(
          `[seed] WARN: cry download failed for ${record.id} (${record.name}): ${result.reason}\n`
        );
        criesFailed++;
        failedCryIds.add(record.id);
      } else if (result.skipped) {
        criesSkipped++;
      } else {
        criesDownloaded++;
      }
    }));
    if ((i + CONCURRENCY) % (CONCURRENCY * 5) === 0) {
      process.stderr.write(
        `[seed] [cries] ${Math.min(i + CONCURRENCY, partialRecords.length)}/${partialRecords.length} processed\n`
      );
    }
  }

  process.stderr.write(
    `[seed] Cries: ${criesDownloaded} downloaded, ${criesSkipped} already existed, ${criesFailed} failed\n`
  );

  // ------------------------------------------------------------------
  // Step 4: Merge chains, sort, and write output
  // ------------------------------------------------------------------
  const records = partialRecords.map(({ evolutionChainUrl: _url, remoteSpriteUrl, remoteCryUrl, ...rest }) => ({
    ...rest,
    spriteUrl: failedSpriteIds.has(rest.id)
      ? remoteSpriteUrl
      : `/sprites/pokemon/${rest.id}.png`,
    cryUrl: remoteCryUrl === null || remoteCryUrl === undefined || failedCryIds.has(rest.id)
      ? null
      : `/cries/${rest.id}.ogg`,
    evolutionChain: _url ? (chainDataMap.get(_url) ?? []) : [],
  }));

  records.sort((a, b) => a.id - b.id);

  // Assign stable edge IDs to each chain entry. Reads prior generated.json
  // (if present) to preserve existing IDs across re-seeds.
  await allocateEdgeIds(records, outputPath);

  const json = JSON.stringify(records, null, 2) + "\n";
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

main().catch((err) => {
  process.stderr.write(`[seed] FATAL: ${err.message}\n`);
  process.exit(1);
});
