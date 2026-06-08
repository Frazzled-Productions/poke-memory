#!/usr/bin/env node
// scripts/seed-all.mjs
// One-command orchestrator for a full Pokémon data re-seed.
//
// Run with:
//   npm run seed:all           # additive default (new species only)
//   npm run seed:all -- --force  # full regenerate (PokéAPI corrected existing data)
//
// Steps (in order):
//   1. seed               - PokéAPI fetch -> generated.json + PNGs + cries
//   2. seed:sprites       - PNG -> committed WebP variants (needs sharp)
//   3. seed:tts           - Cloud TTS MP3s (needs GOOGLE_CLOUD_TTS_API_KEY; skipped if absent)
//   4. seed:split         - split generated.json into the four committed shards
//   5. generate:scope-lookup  - regenerate scopeLookup.ts from generated.json
//   6. generate:pseudo-locale - regenerate xx-pseudo.json from messages/en.json
//
// Safety: re-seed is purely additive. New species are new PokéAPI IDs, which
// become new (user_id, card_type, subject_key) cards. No existing card_reviews
// row is touched, no DB migration is needed, and nothing is pushed to the
// cloud. See docs/reseed.md for the full runbook.

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseArgs,
  buildStepList,
  formatStepBanner,
  formatStepFailure,
  formatSuccess,
} from "./lib/seed-all-helpers.mjs";
import {
  validateSpeciesCount,
  validateShards,
  validateSprites,
  validateLocaleNames,
} from "./lib/seed-validate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const libDir = resolve(repoRoot, "lib/pokemon");
const webpRoot = resolve(repoRoot, "public/sprites/pokemon/webp");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return true when the given environment variable key is present in the
 * dotenv-style file at `filePath` (used to detect keys in .env.local that
 * are not yet in the parent process environment).
 *
 * @param {string} filePath  Absolute path to the env file.
 * @param {string} key       Variable name to look for.
 * @returns {boolean}
 */
function envFileContainsKey(filePath, key) {
  try {
    const content = readFileSync(filePath, "utf8");
    return content.split(/\r?\n/).some((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("#") && trimmed.startsWith(key + "=");
    });
  } catch {
    return false;
  }
}

/**
 * Read generated.json and return the record count, or 0 if the file does not
 * yet exist (fresh checkout before any seed run).
 *
 * @returns {number}
 */
function readGeneratedCount() {
  const generatedPath = resolve(libDir, "generated.json");
  if (!existsSync(generatedPath)) return 0;
  try {
    const records = JSON.parse(readFileSync(generatedPath, "utf-8"));
    return Array.isArray(records) ? records.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Run between-step validation for a given step and exit the process if any
 * check fails.  Prints the validation banner and individual results.
 *
 * @param {string} script  The npm script that just completed (used to choose which checks to run).
 * @param {number} preSeedCount  Record count before "seed" ran (used for species-count check).
 */
function validateAfterStep(script, preSeedCount) {
  console.log(`\n[validate] Running post-step checks for "${script}"...`);

  const generatedPath = resolve(libDir, "generated.json");
  let generated, defaultSpeciesIds;
  if (existsSync(generatedPath)) {
    try {
      generated = JSON.parse(readFileSync(generatedPath, "utf-8"));
      defaultSpeciesIds = generated.filter((p) => p.isDefaultForm).map((p) => p.speciesId);
    } catch {
      console.error("[validate] ERROR: Could not parse generated.json for validation.");
      process.exit(1);
    }
  }

  /** @param {{ ok: boolean, message: string }} r */
  function report(r) {
    if (r.ok) {
      console.log(`  OK  ${r.message}`);
    } else {
      console.error(`  ${r.message}`);
    }
    return r.ok;
  }

  let allPassed = true;

  if (script === "seed") {
    // Assert species count did not shrink.
    const currentCount = generated ? generated.length : 0;
    if (!report(validateSpeciesCount(currentCount, preSeedCount))) allPassed = false;
  }

  if (script === "seed:split") {
    // Assert all four shards cover every record in generated.json.
    const tryRead = (name) => {
      const p = resolve(libDir, name);
      if (!existsSync(p)) {
        console.error(`[validate] ERROR: ${name} not found - run npm run seed:split first.`);
        process.exit(1);
      }
      return JSON.parse(readFileSync(p, "utf-8"));
    };
    const core = tryRead("generated-core.json");
    const flavor = tryRead("generated-flavor.json");
    const chains = tryRead("generated-chains.json");
    const localeNames = tryRead("generated-locale-names.json");
    for (const r of validateShards(generated, core, flavor, chains, localeNames)) {
      if (!report(r)) allPassed = false;
    }
  }

  if (script === "seed:sprites") {
    // Assert that a WebP file exists for every default-form species.
    if (!report(validateSprites(defaultSpeciesIds, webpRoot, existsSync))) allPassed = false;
  }

  if (script === "seed:locale-names") {
    // Assert locale-name completeness.
    const localeNamesPath = resolve(libDir, "generated-locale-names.json");
    if (!existsSync(localeNamesPath)) {
      console.error("[validate] ERROR: generated-locale-names.json not found - run npm run seed:locale-names first.");
      process.exit(1);
    }
    const localeNames = JSON.parse(readFileSync(localeNamesPath, "utf-8"));
    for (const r of validateLocaleNames(localeNames)) {
      if (!report(r)) allPassed = false;
    }
  }

  if (!allPassed) {
    console.error(
      `\n[validate] Post-step validation FAILED after "${script}".\n` +
      `  See errors above. Fix the issues, then re-run:\n` +
      `    npm run seed:all\n` +
      `  Re-runs are safe: the orchestrator is additive by default.`,
    );
    process.exit(1);
  }

  console.log(`[validate] All checks passed.\n`);
}

/**
 * Run an npm script as a child process and wait for it to exit.
 * Inherits stdio so the script's output streams directly to the terminal.
 *
 * @param {string} script  npm script name (key in package.json scripts).
 * @param {string[]} extraArgs  Additional CLI args forwarded after `--`.
 * @returns {Promise<number>} Resolves with the exit code.
 */
function runScript(script, extraArgs = []) {
  return new Promise((resolve) => {
    const args = ["run", script];
    if (extraArgs.length > 0) {
      args.push("--", ...extraArgs);
    }
    const child = spawn(npm, args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      console.error(`Failed to spawn "npm run ${script}": ${err.message}`);
      resolve(1);
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { force } = parseArgs(process.argv.slice(2));
// `seed:tts` loads .env.local via --env-file-if-exists, so check both the
// parent process environment and .env.local to avoid a false-negative skip.
const hasTtsKey =
  Boolean(process.env.GOOGLE_CLOUD_TTS_API_KEY) ||
  envFileContainsKey(
    resolve(repoRoot, ".env.local"),
    "GOOGLE_CLOUD_TTS_API_KEY",
  );

const steps = buildStepList({ force, hasTtsKey });
const total = steps.length;

console.log(
  `\nPoke-Memory seed:all orchestrator` +
    `\nMode   : ${force ? "--force (full regenerate)" : "additive (new species only)"}` +
    `\nSteps  : ${total}` +
    `\nTTS key: ${hasTtsKey ? "present" : "absent (TTS step will be skipped)"}` +
    `\n`,
);

let skipped = 0;

// Snapshot the species count before "seed" runs so the post-step validation
// can assert the count did not shrink (additive invariant).
const preSeedCount = readGeneratedCount();

/** Steps that warrant between-step validation. */
const VALIDATED_STEPS = new Set(["seed", "seed:split", "seed:sprites", "seed:locale-names"]);

for (let i = 0; i < steps.length; i++) {
  const step = steps[i];

  console.log(formatStepBanner(i, total, step.name));

  if (step.skipReason !== null) {
    console.warn(`\nWARNING: ${step.skipReason}`);
    skipped++;
    continue;
  }

  const extraArgs = step.forceFlag ? ["--force"] : [];
  const code = await runScript(step.script, extraArgs);

  if (code !== 0) {
    console.error(formatStepFailure(step.script, code));
    process.exit(code);
  }

  if (VALIDATED_STEPS.has(step.script)) {
    validateAfterStep(step.script, preSeedCount);
  }
}

console.log(formatSuccess(skipped));
