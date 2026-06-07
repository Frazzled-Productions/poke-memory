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
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseArgs,
  buildStepList,
  formatStepBanner,
  formatStepFailure,
  formatSuccess,
} from "./lib/seed-all-helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    const child = spawn("npm", args, {
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
const hasTtsKey = Boolean(process.env.GOOGLE_CLOUD_TTS_API_KEY);

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
}

console.log(formatSuccess(skipped));
