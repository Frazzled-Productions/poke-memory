#!/usr/bin/env node
// scripts/seed-validate.mjs
// Standalone runner for between-step seed validation.
//
// Checks that the generated artefacts are internally consistent after a
// seed:all run (or any individual seed step).  Suitable for running:
//
//   npm run seed:validate            # validate all artefacts
//   npm run seed:validate -- --step=sprites   # validate sprites only
//
// Valid --step values: species-count, shards, sprites, locale-names, all (default)
//
// Exit 0 if all checks pass; exit 1 if any check fails.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateSpeciesCount,
  validateShards,
  validateShardParity,
  validateSprites,
  validateLocaleNames,
  // validateSpeciesIds is also exported from ./lib/seed-validate.mjs for use in
  // pipeline orchestrators that have access to both the prior and current
  // generated.json id sets. The standalone runner cannot use it because it
  // does not have access to a prior snapshot.
} from "./lib/seed-validate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const libDir = resolve(repoRoot, "lib/pokemon");
const publicDir = resolve(repoRoot, "public/pokemon-data");
const webpRoot = resolve(repoRoot, "public/sprites/pokemon/webp");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(filePath, label) {
  if (!existsSync(filePath)) {
    console.error(`ERROR: ${label} not found at ${filePath}`);
    console.error(`  Run the relevant seed step first (see npm run seed:all).`);
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.error(`ERROR: Could not parse ${label}: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Print a ValidationResult and return whether it passed.
 * @param {{ ok: boolean, message: string }} result
 * @returns {boolean}
 */
function report(result) {
  if (result.ok) {
    console.log(`  OK  ${result.message}`);
  } else {
    console.error(`  ${result.message}`);
  }
  return result.ok;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const stepArg = args.find((a) => a.startsWith("--step="))?.replace("--step=", "") ?? "all";
const validSteps = ["species-count", "shards", "sprites", "locale-names", "shard-parity", "all"];

if (!validSteps.includes(stepArg)) {
  console.error(
    `ERROR: Unknown --step value "${stepArg}".\n` +
    `  Valid values: ${validSteps.join(", ")}`,
  );
  process.exit(1);
}

const runAll = stepArg === "all";

// ---------------------------------------------------------------------------
// Load artefacts (only what is needed for the requested step)
// ---------------------------------------------------------------------------

let generated, defaultForms, defaultSpeciesIds;

if (runAll || stepArg === "species-count" || stepArg === "shards" || stepArg === "sprites" || stepArg === "locale-names") {
  generated = readJson(resolve(libDir, "generated.json"), "generated.json");
  defaultForms = generated.filter((p) => p.isDefaultForm);
  defaultSpeciesIds = defaultForms.map((p) => p.speciesId);
}

/** Minimal readFileFn for validateShardParity: returns content string or null. */
function readFileOrNull(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Run validation steps
// ---------------------------------------------------------------------------

let allPassed = true;
let anyStepRan = false;

// --- species-count ----------------------------------------------------------
if (runAll || stepArg === "species-count") {
  console.log("\n-- Species count --");
  anyStepRan = true;
  // In standalone mode we only have the current count; pass 0 as the
  // pre-seed baseline so the check always passes for "not empty".
  const result = validateSpeciesCount(generated.length, 0);
  if (!report(result)) allPassed = false;
}

// --- shards -----------------------------------------------------------------
if (runAll || stepArg === "shards") {
  console.log("\n-- Shard completeness (orphan-chain / form-edge / empty-chain check) --");
  anyStepRan = true;

  const core = readJson(resolve(libDir, "generated-core.json"), "generated-core.json");
  const flavor = readJson(resolve(libDir, "generated-flavor.json"), "generated-flavor.json");
  const chains = readJson(resolve(libDir, "generated-chains.json"), "generated-chains.json");
  const localeNames = readJson(resolve(libDir, "generated-locale-names.json"), "generated-locale-names.json");

  const results = validateShards(generated, core, flavor, chains, localeNames);
  for (const r of results) {
    if (!report(r)) allPassed = false;
  }
}

// --- shard-parity -----------------------------------------------------------
if (runAll || stepArg === "shard-parity") {
  console.log("\n-- Shard lib/public parity --");
  anyStepRan = true;

  const results = validateShardParity(libDir, publicDir, readFileOrNull);
  for (const r of results) {
    if (!report(r)) allPassed = false;
  }
}

// --- sprites ----------------------------------------------------------------
if (runAll || stepArg === "sprites") {
  console.log("\n-- Sprite on-disk presence --");
  anyStepRan = true;

  const result = validateSprites(defaultSpeciesIds, webpRoot, existsSync);
  if (!report(result)) allPassed = false;
}

// --- locale-names -----------------------------------------------------------
if (runAll || stepArg === "locale-names") {
  console.log("\n-- Locale-name completeness --");
  anyStepRan = true;

  const localeNames = readJson(
    resolve(libDir, "generated-locale-names.json"),
    "generated-locale-names.json",
  );

  const results = validateLocaleNames(localeNames);
  for (const r of results) {
    if (!report(r)) allPassed = false;
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("");
if (!anyStepRan) {
  console.error("No validation steps ran - this is a bug in seed-validate.mjs.");
  process.exit(1);
}

if (allPassed) {
  console.log("seed:validate PASSED - all checked artefacts are consistent.");
  process.exit(0);
} else {
  console.error("seed:validate FAILED - see errors above for remediation steps.");
  process.exit(1);
}
