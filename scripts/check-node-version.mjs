/**
 * Pre-build / pre-install guard: fail fast if the running Node major does not
 * match the required major declared in .nvmrc.
 *
 * .nvmrc is the single source of truth for the required Node version. This
 * script reads it at runtime so you only need to update one file when the
 * required major changes.
 *
 * Wired as `prebuild` and `preinstall` in package.json so both `npm run build`
 * and `npm install` / `npm ci` bail out immediately under the wrong major,
 * instead of failing deep inside the build with a cryptic error.
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Read the required major from .nvmrc (single source of truth).
const nvmrcPath = resolve(repoRoot, ".nvmrc");
let nvmrcContent;
try {
  nvmrcContent = readFileSync(nvmrcPath, "utf8").trim();
} catch {
  console.error(
    `check-node-version: could not read ${nvmrcPath}. Skipping version check.`,
  );
  process.exit(0);
}

// .nvmrc may contain "24", "v24", "24.16.0", "lts/iron", etc. Extract the
// leading numeric major. If the content is non-numeric (e.g. "lts/iron"),
// skip the check rather than erroneously blocking the build.
const majorMatch = nvmrcContent.match(/^v?(\d+)/);
if (!majorMatch) {
  // Non-numeric .nvmrc value — cannot compare majors, skip guard.
  process.exit(0);
}
const requiredMajor = parseInt(majorMatch[1], 10);

const actualVersion = process.version; // e.g. "v26.0.0"
const actualMajor = parseInt(process.version.slice(1).split(".")[0], 10);

if (actualMajor !== requiredMajor) {
  console.error(`
ERROR: Wrong Node.js version detected.

  Required: Node ${requiredMajor}.x  (from .nvmrc)
  Detected: ${actualVersion}

Running \`npm run build\` (or \`npm install\`) under Node ${actualMajor} is unsupported
and may produce incorrect output or fail deep inside the build.

How to fix:

  Option A — Homebrew node@24 (no nvm required):
    export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
    npm run build

  Option B — nvm:
    nvm install ${requiredMajor}
    nvm use

  NOTE: if \`nvm use\` appears to succeed but the Node version does not change,
  your ~/.nvm/versions/node directory may be empty (common when Node was
  installed via Homebrew rather than nvm). In that case, run \`nvm install ${requiredMajor}\`
  first, or use Option A.
`);
  process.exit(1);
}
