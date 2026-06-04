/**
 * Drift-check forcing function: assert that every hardcoded Node-major literal
 * in CI workflows and the README matches the single source of truth, .nvmrc.
 *
 * Why: .nvmrc declares the required Node major (the local prebuild/preinstall
 * guard, scripts/check-node-version.mjs, already reads it at runtime). CI
 * workflows and the README, however, can state the Node major as a hardcoded
 * literal that silently drifts from .nvmrc when it is next bumped. A missed
 * literal re-introduces the "wrong Node, cryptic failure" class of bug that
 * #1485 set out to kill (#1575). This script fails loudly on any such drift.
 *
 * What it checks:
 *  - .github/workflows/*.yml: every `node-version:` LITERAL line (anchored on the
 *    colon so `node-version-file:` does NOT match). After the migration to
 *    `node-version-file: .nvmrc` there should be ZERO such literals, so this
 *    guards against re-introduction. Any found must equal the .nvmrc major.
 *  - README.md: the Homebrew `node@N` example and any "Node N" prose major must
 *    equal the .nvmrc major.
 *  - AGENTS.md: the Homebrew `node@N` literal must equal the .nvmrc major. Only
 *    the `node@N` literal is scanned here, NOT prose.
 *
 * Deliberate exemptions (NOT checked):
 *  - package.json `engines.node` ("24.x"): a deliberately looser floor than the
 *    exact .nvmrc pin (see AGENTS.md), so it is excluded by design.
 *  - AGENTS.md PROSE is deliberately NOT prose-scanned (the `\bNode N\b` form):
 *    AGENTS.md intentionally references "Node 26" as the WRONG/bad version (the
 *    failure mode it documents), so a generic prose scan would false-positive.
 *    Only README prose carries the canonical "Node N" statement, so prose stays
 *    README-only.
 *  - The Playwright container image tag (`mcr.microsoft.com/playwright:vX-noble`)
 *    bakes its own Node; that image's Node is a SEPARATE manual-bump invariant
 *    and is intentionally not tied to .nvmrc here.
 *
 * Mirrors the pseudo-locale-drift.yml / scope-lookup-drift.yml model. Imports
 * only Node built-ins so CI can run it with plain `node` (no `npm ci`).
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// --- Single source of truth: .nvmrc major (same regex as check-node-version.mjs).
const nvmrcPath = resolve(repoRoot, ".nvmrc");
const nvmrcContent = readFileSync(nvmrcPath, "utf8").trim();
const nvmrcMatch = nvmrcContent.match(/^v?(\d+)/);
if (!nvmrcMatch) {
  console.error(
    `check-node-version-drift: .nvmrc value "${nvmrcContent}" is non-numeric; cannot derive a major to compare against.`,
  );
  process.exit(1);
}
const requiredMajor = parseInt(nvmrcMatch[1], 10);

/** @type {string[]} */
const errors = [];

// --- 1. Workflow YAML: no `node-version:` literal may diverge from .nvmrc.
const workflowsDir = resolve(repoRoot, ".github", "workflows");
const workflowFiles = readdirSync(workflowsDir).filter(
  (f) => f.endsWith(".yml") || f.endsWith(".yaml"),
);

// Match `node-version:` with a value, but NOT `node-version-file:`. The
// negative lookahead on `-file` keeps the file-based form (the desired state)
// from being flagged.
const nodeVersionLiteral = /node-version(?!-file)\s*:\s*['"]?v?(\d+)/;

for (const file of workflowFiles) {
  const fullPath = join(workflowsDir, file);
  const lines = readFileSync(fullPath, "utf8").split("\n");
  lines.forEach((line, idx) => {
    const m = line.match(nodeVersionLiteral);
    if (m) {
      const major = parseInt(m[1], 10);
      if (major !== requiredMajor) {
        errors.push(
          `.github/workflows/${file}:${idx + 1} pins node-version: ${major}, but .nvmrc requires ${requiredMajor}. ` +
            `Use \`node-version-file: .nvmrc\` instead of a hardcoded literal.`,
        );
      } else {
        // Even a matching literal is drift-prone; require the file-based form.
        errors.push(
          `.github/workflows/${file}:${idx + 1} hardcodes node-version: ${major}. ` +
            `Replace it with \`node-version-file: .nvmrc\` so the Node major stays derived from .nvmrc (#1575).`,
        );
      }
    }
  });
}

// --- 2. Homebrew `node@N` literal: scanned in BOTH README.md and AGENTS.md.
// AGENTS.md prose is deliberately NOT scanned (it references "Node 26" as the
// bad version), so only the `node@N` literal is checked there. README.md
// additionally carries the canonical "Node N" prose, which IS scanned.
const literalFiles = ["README.md", "AGENTS.md"];
for (const file of literalFiles) {
  const filePath = resolve(repoRoot, file);
  const fileLines = readFileSync(filePath, "utf8").split("\n");
  fileLines.forEach((line, idx) => {
    // Homebrew example: node@24
    for (const m of line.matchAll(/node@(\d+)/g)) {
      const major = parseInt(m[1], 10);
      if (major !== requiredMajor) {
        errors.push(
          `${file}:${idx + 1} references node@${major}, but .nvmrc requires ${requiredMajor}.`,
        );
      }
    }
  });
}

// --- 3. README.md prose only: "Node 24" (case-insensitive boundary so
// "Node 24.x" still matches the major). README is the only file whose prose
// states the canonical Node major; AGENTS.md prose is exempt (see header).
const readmePath = resolve(repoRoot, "README.md");
const readmeLines = readFileSync(readmePath, "utf8").split("\n");
readmeLines.forEach((line, idx) => {
  for (const m of line.matchAll(/\bNode (\d+)\b/g)) {
    const major = parseInt(m[1], 10);
    if (major !== requiredMajor) {
      errors.push(
        `README.md:${idx + 1} states "Node ${major}", but .nvmrc requires ${requiredMajor}.`,
      );
    }
  }
});

if (errors.length > 0) {
  console.error(
    `\ncheck-node-version-drift: Node-major drift from .nvmrc (${requiredMajor}):\n`,
  );
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    `\n.nvmrc is the single source of truth for the required Node major. ` +
      `Update .nvmrc only, and let workflows derive the major via \`node-version-file: .nvmrc\`.\n`,
  );
  process.exit(1);
}

console.log(
  `check-node-version-drift: OK - no Node-major drift from .nvmrc (${requiredMajor}).`,
);
