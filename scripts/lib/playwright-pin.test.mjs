import { describe, it, expect } from "vitest";
import {
  lockedPlaywrightVersion,
  findImageTagDrift,
} from "./playwright-pin.mjs";

const lockAt = (test, pw = test, core = test) => ({
  packages: {
    "node_modules/@playwright/test": { version: test },
    "node_modules/playwright": { version: pw },
    "node_modules/playwright-core": { version: core },
  },
});

describe("lockedPlaywrightVersion", () => {
  it("returns the locked @playwright/test version when all entries agree", () => {
    expect(lockedPlaywrightVersion(lockAt("1.63.0"))).toEqual({
      version: "1.63.0",
      errors: [],
    });
  });

  it("flags a playwright-core entry that disagrees with @playwright/test", () => {
    const { version, errors } = lockedPlaywrightVersion(
      lockAt("1.63.0", "1.63.0", "1.62.1"),
    );
    expect(version).toBe("1.63.0");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("playwright-core at 1.62.1");
  });

  it("reports a missing @playwright/test entry", () => {
    const { version, errors } = lockedPlaywrightVersion({ packages: {} });
    expect(version).toBeNull();
    expect(errors[0]).toContain("no locked version");
  });
});

describe("findImageTagDrift", () => {
  const image = (v) => `      image: mcr.microsoft.com/playwright:v${v}-noble`;

  it("passes when every tag matches the locked version", () => {
    const files = [
      { path: ".github/workflows/e2e.yml", text: `jobs:\n${image("1.63.0")}` },
      { path: "WORKFLOW.md", text: "no tag here" },
    ];
    expect(findImageTagDrift(files, "1.63.0")).toEqual([]);
  });

  it("names the file and line of every stale tag (the #2035 half-done bump)", () => {
    const files = [
      {
        path: ".github/workflows/ci.yml",
        text: `a\n${image("1.60.0")}\nb\n${image("1.63.0")}`,
      },
      {
        path: "scripts/pre-pr-smoke.sh",
        text: `docker run ${image("1.60.0").trim()} ${image("1.61.0").trim()}`,
      },
    ];
    const errors = findImageTagDrift(files, "1.63.0");
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/^\.github\/workflows\/ci\.yml:2 pins playwright:v1\.60\.0/);
    expect(errors[1]).toMatch(/^scripts\/pre-pr-smoke\.sh:1 pins playwright:v1\.60\.0/);
    expect(errors[2]).toMatch(/^scripts\/pre-pr-smoke\.sh:1 pins playwright:v1\.61\.0/);
  });
});
