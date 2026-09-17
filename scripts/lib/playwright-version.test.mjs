import { describe, it, expect } from "vitest";
import {
  expectedImageTag,
  findImageTagDrift,
  lockedPlaywrightVersion,
} from "./playwright-version.mjs";

/** A package-lock.json shape with the three Playwright entries. */
function lockWith({ test = "1.62.1", playwright = test, core = test } = {}) {
  const packages = { "": { name: "poke-memory" } };
  if (test !== null) packages["node_modules/@playwright/test"] = { version: test };
  if (playwright !== null) packages["node_modules/playwright"] = { version: playwright };
  if (core !== null) packages["node_modules/playwright-core"] = { version: core };
  return { lockfileVersion: 3, packages };
}

const job = (tag) =>
  `jobs:\n  e2e:\n    container:\n      image: mcr.microsoft.com/playwright:${tag}\n`;

describe("expectedImageTag", () => {
  it("builds the pinned noble tag", () => {
    expect(expectedImageTag("1.62.1")).toBe("v1.62.1-noble");
  });
});

describe("lockedPlaywrightVersion", () => {
  it("returns the version when all three entries agree", () => {
    expect(lockedPlaywrightVersion(lockWith())).toEqual({ ok: true, version: "1.62.1" });
  });

  it("rejects a lockfile without an @playwright/test entry", () => {
    const result = lockedPlaywrightVersion(
      lockWith({ test: null, playwright: "1.62.1", core: "1.62.1" }),
    );
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      "package-lock.json has no locked version for `node_modules/@playwright/test`",
    ]);
  });

  it("rejects a lockfile without a playwright-core entry", () => {
    const result = lockedPlaywrightVersion(lockWith({ core: null }));
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/node_modules\/playwright-core/);
  });

  it("rejects playwright-core locked at a different version", () => {
    const result = lockedPlaywrightVersion(lockWith({ core: "1.60.0" }));
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      "package-lock.json locks `node_modules/playwright-core` at 1.60.0 but " +
        "`node_modules/@playwright/test` at 1.62.1; they must match",
    ]);
  });

  it("rejects playwright locked at a different version", () => {
    const result = lockedPlaywrightVersion(lockWith({ playwright: "1.61.0" }));
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/`node_modules\/playwright` at 1\.61\.0/);
  });

  it("rejects a non-semver version string", () => {
    const result = lockedPlaywrightVersion(lockWith({ test: "latest" }));
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/node_modules\/@playwright\/test/);
  });

  it("rejects a lockfile with no packages map", () => {
    for (const lock of [{ lockfileVersion: 1, dependencies: {} }, null, "text"]) {
      const result = lockedPlaywrightVersion(lock);
      expect(result.ok).toBe(false);
      expect(result.problems[0]).toMatch(/no `packages` map/);
    }
  });
});

describe("findImageTagDrift", () => {
  const version = "1.62.1";

  it("reports nothing when every tag matches", () => {
    const result = findImageTagDrift({
      version,
      workflows: [
        { path: ".github/workflows/ci.yml", content: job("v1.62.1-noble") },
        { path: ".github/workflows/e2e.yml", content: job("v1.62.1-noble") },
      ],
      others: [
        {
          path: "scripts/pre-pr-smoke.sh",
          content: 'docker run --rm \\\n  mcr.microsoft.com/playwright:v1.62.1-noble \\\n  bash -c "npm ci"\n',
        },
      ],
    });
    expect(result.problems).toEqual([]);
    expect(result.references).toEqual([
      { path: ".github/workflows/ci.yml", line: 4, tag: "v1.62.1-noble" },
      { path: ".github/workflows/e2e.yml", line: 4, tag: "v1.62.1-noble" },
      { path: "scripts/pre-pr-smoke.sh", line: 2, tag: "v1.62.1-noble" },
    ]);
  });

  it("reports one stale tag with its path, line, found tag and expected tag", () => {
    const result = findImageTagDrift({
      version,
      workflows: [
        { path: ".github/workflows/ci.yml", content: job("v1.62.1-noble") },
        { path: ".github/workflows/perf-budget.yml", content: job("v1.60.0-noble") },
      ],
    });
    expect(result.problems).toEqual([
      ".github/workflows/perf-budget.yml:4 uses mcr.microsoft.com/playwright:v1.60.0-noble " +
        "(Playwright 1.60.0 instead of 1.62.1); expected mcr.microsoft.com/playwright:v1.62.1-noble",
    ]);
  });

  it("reports every stale tag in one file", () => {
    const content = `${job("v1.60.0-noble")}\n  auth:\n    container:\n      image: mcr.microsoft.com/playwright:v1.60.0-noble\n`;
    const result = findImageTagDrift({
      version,
      workflows: [{ path: ".github/workflows/ci.yml", content }],
    });
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toMatch(/^\.github\/workflows\/ci\.yml:4 /);
    expect(result.problems[1]).toMatch(/^\.github\/workflows\/ci\.yml:8 /);
  });

  it("reports two references on the same line separately", () => {
    const content =
      "a mcr.microsoft.com/playwright:v1.60.0-noble b mcr.microsoft.com/playwright:v1.62.1-noble\n";
    const result = findImageTagDrift({
      version,
      workflows: [{ path: ".github/workflows/ci.yml", content: job("v1.62.1-noble") }],
      others: [{ path: "WORKFLOW.md", content }],
    });
    expect(result.references.filter((r) => r.path === "WORKFLOW.md")).toHaveLength(2);
    expect(result.problems).toEqual([
      expect.stringMatching(/^WORKFLOW\.md:1 uses mcr\.microsoft\.com\/playwright:v1\.60\.0-noble /),
    ]);
  });

  it.each([
    ["latest", "not a pinned vX.Y.Z-noble tag"],
    ["v1.62", "not a pinned vX.Y.Z-noble tag"],
    ["noble", "not a pinned vX.Y.Z-noble tag"],
    ["1.62.1-noble", "not a pinned vX.Y.Z-noble tag"],
    ["v1.62.1", "not a pinned vX.Y.Z-noble tag"],
    ["v1.62.1-jammy", "the -jammy variant instead of -noble"],
  ])("treats the tag %s as drift", (tag, reason) => {
    const result = findImageTagDrift({
      version,
      workflows: [{ path: ".github/workflows/ci.yml", content: job(tag) }],
    });
    expect(result.problems).toEqual([
      `.github/workflows/ci.yml:4 uses mcr.microsoft.com/playwright:${tag} (${reason}); ` +
        "expected mcr.microsoft.com/playwright:v1.62.1-noble",
    ]);
  });

  it("treats an empty tag and a placeholder tag as drift", () => {
    const result = findImageTagDrift({
      version,
      workflows: [{ path: ".github/workflows/ci.yml", content: job("v1.62.1-noble") }],
      others: [
        { path: "docs/a.md", content: "the image `mcr.microsoft.com/playwright:` here\n" },
        { path: "docs/b.md", content: "use mcr.microsoft.com/playwright:v<version>-noble\n" },
      ],
    });
    expect(result.problems).toEqual([
      "docs/a.md:1 uses mcr.microsoft.com/playwright:(empty tag) (not a pinned vX.Y.Z-noble tag); " +
        "expected mcr.microsoft.com/playwright:v1.62.1-noble",
      "docs/b.md:1 uses mcr.microsoft.com/playwright:v (not a pinned vX.Y.Z-noble tag); " +
        "expected mcr.microsoft.com/playwright:v1.62.1-noble",
    ]);
  });

  it("ignores a digest suffix after a matching tag", () => {
    const result = findImageTagDrift({
      version,
      workflows: [
        {
          path: ".github/workflows/ci.yml",
          content: job("v1.62.1-noble@sha256:0123456789abcdef"),
        },
      ],
    });
    expect(result.problems).toEqual([]);
  });

  it("ignores prose that names the image without a tag", () => {
    const result = findImageTagDrift({
      version,
      workflows: [{ path: ".github/workflows/ci.yml", content: job("v1.62.1-noble") }],
      others: [
        {
          path: "WORKFLOW.md",
          content:
            "Runs inside the pinned `mcr.microsoft.com/playwright` image.\n" +
            "The pinned mcr.microsoft.com/playwright Docker image, see ci.yml.\n",
        },
      ],
    });
    expect(result.problems).toEqual([]);
    expect(result.references).toHaveLength(1);
  });

  it("handles CRLF line endings", () => {
    const result = findImageTagDrift({
      version,
      workflows: [
        {
          path: ".github/workflows/ci.yml",
          content: "jobs:\r\n  e2e:\r\n    container:\r\n      image: mcr.microsoft.com/playwright:v1.62.1-noble\r\n",
        },
      ],
    });
    expect(result.problems).toEqual([]);
    expect(result.references).toEqual([
      { path: ".github/workflows/ci.yml", line: 4, tag: "v1.62.1-noble" },
    ]);
  });

  it("fails when no workflow references the image, so it cannot pass on nothing", () => {
    const result = findImageTagDrift({
      version,
      workflows: [{ path: ".github/workflows/lint.yml", content: "jobs:\n  lint:\n" }],
      others: [{ path: "scripts/pre-pr-smoke.sh", content: "mcr.microsoft.com/playwright:v1.62.1-noble\n" }],
    });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/no mcr\.microsoft\.com\/playwright image reference .* in any workflow/);
  });

  it("does not require references outside the workflows", () => {
    const result = findImageTagDrift({
      version,
      workflows: [{ path: ".github/workflows/ci.yml", content: job("v1.62.1-noble") }],
      others: [{ path: "docs/testing.md", content: "no image here\n" }],
    });
    expect(result.problems).toEqual([]);
  });
});
