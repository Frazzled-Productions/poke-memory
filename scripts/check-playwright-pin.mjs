/**
 * Drift check: every `mcr.microsoft.com/playwright:vX.Y.Z` image tag in the
 * repo must match the `@playwright/test` version locked in package-lock.json
 * (#2074). Wired into `npm run lint`, so CI's check job fails with a named
 * error on a half-done Playwright bump (such as a Dependabot PR that moved the
 * package but not the workflow containers) instead of every browser job failing
 * with missing-browser errors.
 *
 * Scans every git-tracked text file, so the workflow containers and the copies
 * in scripts/pre-pr-smoke.sh, WORKFLOW.md, docs/ and .claude/skills/ are all
 * covered, including any added later. Excluded: the lockfile itself, the
 * changelog (historical record), and this checker plus its helper and test.
 *
 * Fix a failure by moving every reported tag to the locked version, after
 * confirming the matching `-noble` tag is published:
 *   curl -s https://mcr.microsoft.com/v2/playwright/tags/list | jq -r '.tags[]'
 *
 * Run directly: `node scripts/check-playwright-pin.mjs` (or
 * `npm run lint:playwright-pin`). Node built-ins only.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  lockedPlaywrightVersion,
  findImageTagDrift,
} from "./lib/playwright-pin.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const EXCLUDED = new Set([
  "package-lock.json",
  "CHANGELOG.md",
  "scripts/check-playwright-pin.mjs",
  "scripts/lib/playwright-pin.mjs",
  "scripts/lib/playwright-pin.test.mjs",
]);
const TEXT_EXTENSIONS =
  /\.(ya?ml|md|sh|mjs|cjs|js|ts|tsx|json|txt|toml)$|(^|\/)Dockerfile/;

const lock = JSON.parse(
  readFileSync(resolve(repoRoot, "package-lock.json"), "utf8"),
);
const { version, errors } = lockedPlaywrightVersion(lock);

if (version) {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(
      (p) =>
        p &&
        TEXT_EXTENSIONS.test(p) &&
        !EXCLUDED.has(p) &&
        !p.startsWith("changelog.d/"),
    );
  const files = tracked.map((path) => ({
    path,
    text: readFileSync(resolve(repoRoot, path), "utf8"),
  }));
  errors.push(...findImageTagDrift(files, version));
}

if (errors.length > 0) {
  console.error("\ncheck-playwright-pin: Playwright version drift:\n");
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    "\nThe Playwright image ships browsers for exactly one Playwright build, so " +
      "every `playwright:vX.Y.Z` tag must equal the locked @playwright/test " +
      "version. Move the tags in the same PR as the package bump (#2074).\n",
  );
  process.exit(1);
}

console.log(
  `check-playwright-pin: OK - every Playwright image tag matches @playwright/test ${version}.`,
);
