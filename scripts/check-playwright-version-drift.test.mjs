// Tests for scripts/check-playwright-version-drift.mjs (#2074).
//
// Two halves: the check against THIS checkout (a fitness test, so `npm test`
// also fails if a tag and the lockfile drift apart), and the CLI against
// throwaway fixture repos to prove the failure paths and the fix-it message.

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkPlaywrightVersionDrift,
  SCANNED_FILES,
} from "./check-playwright-version-drift.mjs";

const SCRIPT = fileURLToPath(new URL("./check-playwright-version-drift.mjs", import.meta.url));
const REPO_ROOT = resolve(dirname(SCRIPT), "..");

function runCli(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

describe("check-playwright-version-drift on this checkout", () => {
  it("finds no drift between the image tags and package-lock.json", () => {
    const { version, problems } = checkPlaywrightVersionDrift(REPO_ROOT);
    const lock = JSON.parse(readFileSync(join(REPO_ROOT, "package-lock.json"), "utf8"));
    expect(version).toBe(lock.packages["node_modules/@playwright/test"].version);
    expect(problems).toEqual([]);
  });

  it("sees every job and runnable command that pins the image", () => {
    const { references } = checkPlaywrightVersionDrift(REPO_ROOT);
    const count = (path) => references.filter((r) => r.path === path).length;
    // The six browser jobs named in #2074 (ci.yml holds two of them).
    expect(count(".github/workflows/ci.yml")).toBeGreaterThanOrEqual(2);
    for (const path of [
      ".github/workflows/e2e.yml",
      ".github/workflows/perf-budget.yml",
      ".github/workflows/visual-regression.yml",
      ".github/workflows/visual-baseline-update.yml",
      // The runnable `docker run` commands outside the workflows.
      "scripts/pre-pr-smoke.sh",
      ".claude/skills/investigate-ci-failure.md",
      "WORKFLOW.md",
    ]) {
      expect(count(path), path).toBeGreaterThanOrEqual(1);
    }
  });

  it("scans files that exist", () => {
    for (const path of SCANNED_FILES) {
      expect(existsSync(join(REPO_ROOT, path)), path).toBe(true);
    }
  });

  it("exits 0 from the command line", () => {
    const result = runCli();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^check-playwright-version-drift: OK - \d+ image reference\(s\) match/);
  });
});

describe("check-playwright-version-drift on a fixture repo", () => {
  /** @type {string[]} */
  const roots = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /**
   * @param {{ lock?: string | object, files?: Record<string, string> }} spec
   */
  function fixture({ lock = "1.62.1", files = {} } = {}) {
    const root = mkdtempSync(join(tmpdir(), "playwright-drift-"));
    roots.push(root);
    const lockJson =
      typeof lock === "string"
        ? {
            lockfileVersion: 3,
            packages: {
              "node_modules/@playwright/test": { version: lock },
              "node_modules/playwright": { version: lock },
              "node_modules/playwright-core": { version: lock },
            },
          }
        : lock;
    const all = {
      "package-lock.json": JSON.stringify(lockJson),
      ".github/workflows/ci.yml":
        "jobs:\n  e2e:\n    container:\n      image: mcr.microsoft.com/playwright:v1.62.1-noble\n",
      ...Object.fromEntries(SCANNED_FILES.map((path) => [path, "no image here\n"])),
      ...files,
    };
    for (const [path, content] of Object.entries(all)) {
      if (content === null) continue;
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    return root;
  }

  it("passes when the tags match", () => {
    const result = runCli(fixture());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 image reference(s) match @playwright/test 1.62.1");
  });

  it("fails a half-done bump with every stale site and the fix-it steps", () => {
    const root = fixture({
      files: {
        ".github/workflows/ci.yml":
          "jobs:\n  e2e:\n    container:\n      image: mcr.microsoft.com/playwright:v1.60.0-noble\n",
        ".github/workflows/e2e.yaml": "container:\n  image: mcr.microsoft.com/playwright:v1.60.0-noble\n",
        "scripts/pre-pr-smoke.sh": "docker run \\\n  mcr.microsoft.com/playwright:v1.60.0-noble \\\n",
      },
    });
    const result = runCli(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("drifted from package-lock.json (@playwright/test 1.62.1)");
    expect(result.stderr).toContain(".github/workflows/ci.yml:4 uses mcr.microsoft.com/playwright:v1.60.0-noble");
    expect(result.stderr).toContain(".github/workflows/e2e.yaml:2 uses mcr.microsoft.com/playwright:v1.60.0-noble");
    expect(result.stderr).toContain("scripts/pre-pr-smoke.sh:2 uses mcr.microsoft.com/playwright:v1.60.0-noble");
    expect(result.stderr).toContain("docker pull mcr.microsoft.com/playwright:v1.62.1-noble");
    expect(result.stderr).toContain("Move every tag listed above to v1.62.1-noble in this PR");
    expect(result.stderr).toContain("dispatch visual-baseline-update.yml on this branch");
  });

  it("only reads .yml and .yaml files from the workflows directory", () => {
    const root = fixture({
      files: {
        ".github/workflows/NOTES.txt": "mcr.microsoft.com/playwright:v1.60.0-noble\n",
      },
    });
    const { problems, references } = checkPlaywrightVersionDrift(root);
    expect(problems).toEqual([]);
    expect(references.map((r) => r.path)).toEqual([".github/workflows/ci.yml"]);
  });

  it("fails when a file on the scan list has gone", () => {
    const root = fixture({ files: { "docs/testing.md": null } });
    const { problems } = checkPlaywrightVersionDrift(root);
    expect(problems).toEqual([
      "docs/testing.md is on the scan list but does not exist; update SCANNED_FILES in " +
        "scripts/check-playwright-version-drift.mjs and the workflow's paths filter",
    ]);
  });

  it("fails when package-lock.json cannot be read", () => {
    const root = fixture({ files: { "package-lock.json": "{ not json" } });
    const result = runCli(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not read package-lock.json");
    // Without a locked version there is no tag to recommend.
    expect(result.stderr).not.toContain("To fix:");
  });

  it("fails when the Playwright packages are locked at different versions", () => {
    const root = fixture({
      lock: {
        lockfileVersion: 3,
        packages: {
          "node_modules/@playwright/test": { version: "1.62.1" },
          "node_modules/playwright": { version: "1.62.1" },
          "node_modules/playwright-core": { version: "1.60.0" },
        },
      },
    });
    const result = runCli(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("`node_modules/playwright-core` at 1.60.0");
  });
});
