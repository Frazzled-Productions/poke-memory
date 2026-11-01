/**
 * Contract test for the integration gate (#2220). `integration-gate` passes when
 * the suite is skipped, so a path missing from the `cloud_write` filter looks like
 * a covered PR. This keeps the filter in step with what lib/sync/integration
 * imports, and runs the workflow's real Decide script for each trigger.
 *
 * Direct imports only: the transitive closure reaches most of lib/, and the
 * push-to-qa run is the backstop for that.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SUITE_DIR = "lib/sync/integration";
const workflow = readFileSync(
  join(repoRoot, ".github/workflows/integration-tests.yml"),
  "utf8",
);

// Routes reach the suite through their RPCs, not through an import:
// push-targets-rpc.test.ts and push-streak-nudge-rpc.test.ts pin what the push
// routes read, and rate-limit.test.ts pins what the feedback route calls.
const COVERED_WITHOUT_AN_IMPORT = [
  "app/api/push/send-daily/route.ts",
  "app/api/feedback/route.ts",
];

const between = (text, start, end) => {
  const from = text.indexOf(start);
  return text.slice(from, text.indexOf(end, from));
};

const filterGlobs = () =>
  [...between(workflow, "cloud_write:", "- name: Decide").matchAll(/- '([^']+)'/g)].map((m) => m[1]);

const isCovered = (path, globs) =>
  globs.some((g) => (g.endsWith("/**") ? path.startsWith(g.slice(0, -2)) : path === g));

/** First-party specifiers in `from`, `import()` and `vi.mock()`, as repo-relative paths. */
function suiteImports() {
  const spec = /(?:from\s+|import\(\s*|vi\.mock\(\s*)["']((?:@\/|\.\.?\/)[^"']+)["']/g;
  const found = new Set();
  for (const file of readdirSync(join(repoRoot, SUITE_DIR))) {
    const text = readFileSync(join(repoRoot, SUITE_DIR, file), "utf8");
    for (const [, s] of text.matchAll(spec)) {
      found.add(
        s.startsWith("@/")
          ? s.slice(2)
          : relative(repoRoot, join(repoRoot, normalize(join(SUITE_DIR, s)))),
      );
    }
  }
  return [...found];
}

/** Runs the workflow's own Decide step and returns what it writes to GITHUB_OUTPUT. */
function decide({ event, pathsMatch = "", hasLabel = "false" }) {
  const block = between(workflow, "- name: Decide", "  integration:\n");
  const script = block
    .slice(block.indexOf("run: |") + "run: |".length)
    .replace(/^ {10}/gm, "");
  const dir = mkdtempSync(join(tmpdir(), "integration-gate-"));
  const output = join(dir, "output");
  try {
    execFileSync("bash", ["-eu", "-c", script], {
      env: {
        PATH: process.env.PATH,
        EVENT_NAME: event,
        PATHS_MATCH: pathsMatch,
        HAS_LABEL: hasLabel,
        GITHUB_OUTPUT: output,
      },
    });
    return readFileSync(output, "utf8").trim();
  } finally {
    rmSync(dir, { recursive: true });
  }
}

describe("cloud_write filter", () => {
  it("finds the suite's imports and the filter", () => {
    expect(suiteImports()).toContain("lib/sync/cloud");
    expect(filterGlobs()).toContain("lib/sync/**");
  });

  it("covers every first-party path the suite imports", () => {
    const globs = filterGlobs();
    const missing = [...suiteImports(), ...COVERED_WITHOUT_AN_IMPORT]
      .filter((p) => !isCovered(p, globs))
      .sort();
    expect(missing).toEqual([]);
  });
});

describe("triggers", () => {
  it("runs on push to qa only, and still skips sprite-only pushes", () => {
    expect(workflow).toMatch(/^ {2}push:\n {4}branches: \[qa\]\n {4}paths-ignore:\n {6}- 'public\/sprites\/\*\*'$/m);
  });

  it("uses no secrets and no pull_request_target, so a fork PR has nothing to reach", () => {
    expect(workflow).not.toMatch(/secrets\.|^\s+pull_request_target:/m);
  });
});

describe("Decide script", () => {
  it.each([
    ["a push to qa", { event: "push" }, "run=true"],
    ["a manual dispatch", { event: "workflow_dispatch" }, "run=true"],
    ["a PR on a filtered path", { event: "pull_request", pathsMatch: "true" }, "run=true"],
    ["a PR with the label", { event: "pull_request", pathsMatch: "false", hasLabel: "true" }, "run=true"],
    ["any other PR", { event: "pull_request", pathsMatch: "false" }, "run=false"],
  ])("%s", (_name, input, expected) => {
    expect(decide(input)).toBe(expected);
  });
});
