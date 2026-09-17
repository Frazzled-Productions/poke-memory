/**
 * Drift-check forcing function: assert that every pinned Playwright container
 * image tag matches the `@playwright/test` version locked in package-lock.json
 * (#2074).
 *
 * Why: the browser jobs run inside `mcr.microsoft.com/playwright` images, and
 * each image only ships browsers for one Playwright release. Dependabot bumps
 * the package but not the `container.image` lines, so a half-done bump fails
 * every browser job with a wall of "Executable doesn't exist" errors (#2035).
 * This script turns that into one named failure listing every file:line to fix.
 *
 * What it checks (rules live in scripts/lib/playwright-version.mjs):
 *  - package-lock.json: `@playwright/test`, `playwright` and `playwright-core`
 *    are locked to one version. That version is the single source of truth.
 *  - .github/workflows/*.yml and *.yaml: every image tag equals
 *    `v<locked>-noble`, and at least one such reference exists.
 *  - SCANNED_FILES: the scripts and docs that carry a runnable `docker run`
 *    command. Prose deliberately names the image without a tag, so any tag that
 *    creeps back into these files is checked too.
 *
 * Deliberately NOT scanned: CHANGELOG.md, changelog.d/ and docs/plans/ hold
 * historical mentions that must never be rewritten.
 *
 * Enforced today by scripts/check-playwright-version-drift.test.mjs, which
 * runs this check against the checkout inside `npm test`. Mirrors
 * check-node-version-drift.mjs and imports only Node built-ins and the pure
 * helper, so a dedicated workflow can also run it with plain `node` (no
 * `npm ci`).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expectedImageTag,
  findImageTagDrift,
  lockedPlaywrightVersion,
  PLAYWRIGHT_IMAGE,
} from "./lib/playwright-version.mjs";

const WORKFLOWS_DIR = ".github/workflows";

// Non-workflow files that reference the image. A workflow that runs this check
// behind a `paths:` filter must list these files too.
export const SCANNED_FILES = [
  "scripts/pre-pr-smoke.sh",
  "WORKFLOW.md",
  "docs/testing.md",
  ".claude/skills/investigate-ci-failure.md",
];

/**
 * Run the whole check against a repository checkout.
 *
 * @param {string} repoRoot Absolute path to the repository root.
 * @param {string[]} [scannedFiles] Repo-relative non-workflow files to scan.
 * @returns {{
 *   version: string | undefined,
 *   references: { path: string, line: number, tag: string }[],
 *   problems: string[],
 * }}
 */
export function checkPlaywrightVersionDrift(repoRoot, scannedFiles = SCANNED_FILES) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
  } catch (err) {
    return {
      version: undefined,
      references: [],
      problems: [`could not read package-lock.json: ${err.message}`],
    };
  }

  const locked = lockedPlaywrightVersion(lock);
  if (!locked.ok) {
    return { version: undefined, references: [], problems: locked.problems };
  }

  const read = (path) => ({
    path,
    content: readFileSync(join(repoRoot, path), "utf8"),
  });

  const workflows = readdirSync(join(repoRoot, WORKFLOWS_DIR))
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort()
    .map((f) => read(`${WORKFLOWS_DIR}/${f}`));

  // A listed file that has gone is a stale scan list, not a pass.
  const missing = scannedFiles.filter((path) => !existsSync(join(repoRoot, path)));
  const others = scannedFiles
    .filter((path) => !missing.includes(path))
    .map(read);

  const { references, problems } = findImageTagDrift({
    version: locked.version,
    workflows,
    others,
  });
  for (const path of missing) {
    problems.push(
      `${path} is on the scan list but does not exist; update SCANNED_FILES in ` +
        "scripts/check-playwright-version-drift.mjs and the workflow's paths filter",
    );
  }

  return { version: locked.version, references, problems };
}

// Usage: node scripts/check-playwright-version-drift.mjs [repoRoot]
// The optional root defaults to this checkout; the test passes a fixture.
function main() {
  const repoRoot = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { version, references, problems } = checkPlaywrightVersionDrift(repoRoot);

  if (problems.length > 0) {
    const locked = version ? ` (@playwright/test ${version})` : "";
    console.error(
      `\ncheck-playwright-version-drift: the Playwright image has drifted from package-lock.json${locked}:\n`,
    );
    for (const p of problems) console.error(`  - ${p}`);
    if (version) {
      const tag = `${PLAYWRIGHT_IMAGE}:${expectedImageTag(version)}`;
      console.error(
        "\nEach image ships browsers for exactly one Playwright release, so the browser jobs " +
          "fail with \"Executable doesn't exist\" until every tag matches (#2074). To fix:\n" +
          `  1. Confirm ${tag} is published (\`docker pull ${tag}\`) and that its Node major ` +
          "matches .nvmrc (`docker run --rm " +
          `${tag} node --version\`).\n` +
          `  2. Move every tag listed above to ${expectedImageTag(version)} in this PR.\n` +
          "  3. A new browser build can shift rendering: if Visual Regression fails on " +
          "rendering-only differences, dispatch visual-baseline-update.yml on this branch.\n",
      );
    }
    process.exit(1);
  }

  console.log(
    `check-playwright-version-drift: OK - ${references.length} image reference(s) match ` +
      `@playwright/test ${version} (${PLAYWRIGHT_IMAGE}:${expectedImageTag(version)}).`,
  );
}

const INVOKED_DIRECTLY =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (INVOKED_DIRECTLY) {
  main();
}
