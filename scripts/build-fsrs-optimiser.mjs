/**
 * Builds the in-browser FSRS optimiser into `public/fsrs/` (D7 of the move to
 * Cloudflare, openspec/changes/move-to-cloudflare/design.md):
 *
 *   optimiser-worker.js            the Web Worker the /settings/optimiser page starts
 *   wasi-thread.js                 the thread worker the wasm binding spawns
 *   fsrs-binding.wasm32-wasi.wasm  the FSRS binding (vendored, see below)
 *
 * They are plain static files so they ship as Worker static assets with fixed
 * paths, and next.config.ts can give `/fsrs/*` the cross-origin isolation
 * headers the threaded wasm needs. Like `public/sw/`, the output is gitignored
 * and rebuilt by `npm run build` and `npm run dev`.
 *
 * The wasm comes from `vendor/fsrs-binding-wasm32-wasi/`, an unmodified copy of
 * the npm package @open-spaced-repetition/binding-wasm32-wasi. npm refuses to
 * install that package on any machine (its package.json says `cpu: wasm32`),
 * so it is vendored; the hash below pins the exact bytes. To update it:
 * `npm pack @open-spaced-repetition/binding-wasm32-wasi@<version>`, copy the
 * same five files over, and update the version and hash here.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const projectRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const vendorDir = path.join(projectRoot, "vendor", "fsrs-binding-wasm32-wasi");
const outDir = path.join(projectRoot, "public", "fsrs");

const FSRS_WASM_VERSION = "0.5.0";
const FSRS_WASM_SHA256 =
  "c1c843e8cbda3069c6933565087e8984b882ca7cd38652b2155af5a0c47d879f";
const WASM_FILE = "fsrs-binding.wasm32-wasi.wasm";

async function main() {
  const wasm = await fs.readFile(path.join(vendorDir, WASM_FILE));
  const sha = crypto.createHash("sha256").update(wasm).digest("hex");
  if (sha !== FSRS_WASM_SHA256) {
    throw new Error(
      `[build-fsrs-optimiser] ${WASM_FILE} hash ${sha} does not match the pinned ` +
        `${FSRS_WASM_VERSION} hash; see the header of this script.`,
    );
  }
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, WASM_FILE), wasm);

  await esbuild.build({
    absWorkingDir: projectRoot,
    entryPoints: {
      "optimiser-worker": "lib/srs/optimiser/worker.ts",
      "wasi-thread": "lib/srs/optimiser/wasiThread.ts",
    },
    outdir: outDir,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "eof",
    logLevel: "warning",
  });
  console.log(`[build-fsrs-optimiser] wrote ${path.relative(projectRoot, outDir)}/`);
}

await main();
