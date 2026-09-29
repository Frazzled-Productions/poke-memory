import { describe, it, expect } from "vitest";
import {
  lockedPlaywrightVersion,
  findImageTagDrift,
  findMissingPins,
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

  it("reports (missing) for an absent playwright or playwright-core entry", () => {
    const lock = lockAt("1.63.0");
    delete lock.packages["node_modules/playwright"];
    delete lock.packages["node_modules/playwright-core"];
    const { version, errors } = lockedPlaywrightVersion(lock);
    expect(version).toBe("1.63.0");
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("node_modules/playwright at (missing)");
    expect(errors[1]).toContain("node_modules/playwright-core at (missing)");
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

  it("reports major.minor and major-only tags as mismatches instead of ignoring them", () => {
    const files = [
      {
        path: ".github/workflows/e2e.yml",
        text: `${image("1.63")}\n${image("1")}`,
      },
    ];
    const errors = findImageTagDrift(files, "1.63.0");
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/e2e\.yml:1 pins playwright:v1\.63,/);
    expect(errors[1]).toMatch(/e2e\.yml:2 pins playwright:v1,/);
  });
});

describe("findMissingPins", () => {
  const ciPin = {
    path: ".github/workflows/ci.yml",
    text: "image: mcr.microsoft.com/playwright:v1.63.0-noble",
  };

  it("passes when ci.yml carries a tag", () => {
    expect(
      findMissingPins([ciPin, { path: "README.md", text: "none" }]),
    ).toEqual([]);
  });

  it("fails when no tag is found anywhere, so a removed pin cannot print OK", () => {
    const errors = findMissingPins([
      { path: ".github/workflows/ci.yml", text: "runs-on: ubuntu-latest" },
      { path: "WORKFLOW.md", text: "no pins" },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("no Playwright image tags");
  });

  it("fails when tags exist elsewhere but ci.yml has lost its pin", () => {
    const errors = findMissingPins([
      { path: ".github/workflows/ci.yml", text: "runs-on: ubuntu-latest" },
      { ...ciPin, path: ".github/workflows/e2e.yml" },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(
      /^\.github\/workflows\/ci\.yml has no Playwright image tag/,
    );
  });
});
