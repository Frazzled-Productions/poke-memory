#!/usr/bin/env node
/**
 * Runner shim for qa:seed-cloud.
 *
 * Step 1: Bundle scripts/qa-seed-cloud.ts with esbuild, resolving the @/ alias
 *         to the repo root and keeping @supabase/supabase-js external.
 * Step 2: Execute the bundled ESM with node, forwarding all CLI args and env.
 *
 * Usage (via npm script):
 *   npm run qa:seed-cloud -- all --dry-run
 *   npm run qa:seed-cloud -- qa-mastery
 *   npm run qa:seed-cloud -- all --user my-user
 *
 * Required env vars (except with --dry-run):
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   QA_SEED_PASSWORD (optional, defaults to documented constant)
 *
 * Store credentials in .env.qa.local (already covered by .gitignore).
 * Run with credentials: node --env-file=.env.qa.local scripts/run-qa-seed-cloud.mjs all
 */

import { spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Use the local .bin/esbuild native binary (installed as a devDependency).
const esbuildBin = resolve(repoRoot, "node_modules/.bin/esbuild");

// Output to a stable location inside the repo tree so ESM package resolution
// walks up to find node_modules (temp dirs have no parent node_modules chain).
const outDir = resolve(repoRoot, "node_modules/.cache/qa-seed-cloud");
mkdirSync(outDir, { recursive: true });
const outFile = `${outDir}/qa-seed-cloud.mjs`;

const entryPoint = resolve(repoRoot, "scripts/qa-seed-cloud.ts");

// esbuild alias: @/ → <repoRoot>/ (matches tsconfig.json paths: {"@/*": ["./*"]})
// Keeps @supabase/supabase-js external so it's loaded from node_modules at runtime.
const aliasArg = `@=${repoRoot}`;

console.log("[qa:seed-cloud] Bundling with esbuild ...");

const esbuildArgs = [
  entryPoint,
  "--bundle",
  "--platform=node",
  "--packages=external",
  "--format=esm",
  `--alias:${aliasArg}`,
  `--outfile=${outFile}`,
];

const buildResult = spawnSync(esbuildBin, esbuildArgs, {
  stdio: "inherit",
  cwd: repoRoot,
});

if (buildResult.status !== 0) {
  console.error("[qa:seed-cloud] esbuild failed (exit code", buildResult.status, ")");
  process.exit(buildResult.status ?? 1);
}

console.log("[qa:seed-cloud] Bundle ready. Running ...\n");

// Forward all CLI args after the script name (npm passes them after --).
// process.argv here is: [node, run-qa-seed-cloud.mjs, ...user-args]
const userArgs = process.argv.slice(2);

const runResult = spawnSync(process.execPath, [outFile, ...userArgs], {
  stdio: "inherit",
  cwd: repoRoot,
  env: process.env,
});

process.exit(runResult.status ?? 0);
