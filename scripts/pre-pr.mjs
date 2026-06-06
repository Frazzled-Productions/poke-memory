/**
 * One-command pre-PR gate (#1716).
 *
 * Runs the exact gate AGENTS.md "Pre-PR build gate" prescribes, in order,
 * fail-fast: lint -> typecheck -> build -> test -> coverage -> diff-coverage.
 * Each step is the same `npm run` script CI runs, so this is a local mirror of
 * the CI required checks, not a second source of truth. CI remains the
 * enforcement layer; this is the local convenience command that stops a step
 * (most often `test:diff-coverage`, which has bitten before - #1649) being
 * skipped when a change is hand-rolled rather than driven through /batch-issues.
 *
 * Usage:
 *   npm run pre-pr
 *
 * The diff-coverage base ref is overridable for a main-targeting PR:
 *   DIFF_COVERAGE_BASE=origin/main npm run pre-pr
 *
 * `test:diff-coverage` itself already reads DIFF_COVERAGE_BASE (default
 * origin/qa); it is run immediately after `test:coverage` so the freshly
 * produced coverage/coverage-final.json is still present. Diff coverage with no
 * instrumented product lines changed is reported as skipped and passes (exit 0),
 * which is expected for a docs/tooling-only change.
 *
 * Exit codes: 0 if every step passes; the failing step's non-zero code on the
 * first failure (the chain stops there).
 */
import { spawnSync } from "node:child_process";

// In order. Each entry is an `npm run <script>` invocation. Fail-fast: the
// first non-zero exit stops the chain and propagates that code.
const STEPS = [
  "lint",
  "typecheck",
  "build",
  "test",
  "test:coverage",
  "test:diff-coverage",
];

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

for (const step of STEPS) {
  process.stdout.write(`\n=== pre-pr: npm run ${step} ===\n`);
  const result = spawnSync(npm, ["run", step], {
    stdio: "inherit",
    // Inherit the environment so DIFF_COVERAGE_BASE (and the rest) flow through
    // to the child scripts.
    env: process.env,
  });

  if (result.error) {
    console.error(`\n✗ pre-pr: failed to launch "npm run ${step}": ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\n✗ pre-pr: "npm run ${step}" exited ${result.status}. Stopping (fail-fast).`);
    process.exit(result.status ?? 1);
  }
}

process.stdout.write("\n✓ pre-pr: all steps passed (lint, typecheck, build, test, coverage, diff-coverage).\n");
