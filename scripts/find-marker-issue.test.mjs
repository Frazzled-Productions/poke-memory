/**
 * Tests for the monitor tracking-issue lookup (#2010, #2081) used by
 * .github/workflows/monitor-grade-log-divergence.yml.
 *
 * It lives under scripts/ (the node vitest project) rather than lib/ because it
 * guards CI tooling, not product code. The CLI cases run the script the way
 * the workflow does, so the stdin/exit-code contract is covered too.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { findMarkerIssue } from "../.github/scripts/find-marker-issue.mjs";

const MARKER = "<!-- monitor:grade-log-divergence -->";
const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.github/scripts/find-marker-issue.mjs",
);

describe("findMarkerIssue", () => {
  it("matches an issue whose body starts with the marker line", () => {
    expect(findMarkerIssue([{ number: 40, body: `${MARKER}\n\nreport` }], MARKER)).toBe(40);
  });

  it("matches a body that is only the marker", () => {
    expect(findMarkerIssue([{ number: 40, body: MARKER }], MARKER)).toBe(40);
  });

  it("does NOT match an issue that quotes the marker mid-body", () => {
    const issues = [
      { number: 12, body: `Retro notes: the monitor uses ${MARKER} as its key.` },
      { number: 13, body: `Line one\n${MARKER}\nmore` },
    ];
    expect(findMarkerIssue(issues, MARKER)).toBeNull();
  });

  it("does NOT match when the marker is only a prefix of the first line", () => {
    expect(findMarkerIssue([{ number: 14, body: `${MARKER} trailing text` }], MARKER)).toBeNull();
  });

  it("matches a CRLF body", () => {
    expect(findMarkerIssue([{ number: 9, body: `${MARKER}\r\n\r\nreport` }], MARKER)).toBe(9);
  });

  it("does NOT match a null or empty body", () => {
    const issues = [
      { number: 3, body: null },
      { number: 4, body: "" },
      { number: 5 },
    ];
    expect(findMarkerIssue(issues, MARKER)).toBeNull();
  });

  it("picks the oldest issue when two match", () => {
    const issues = [
      { number: 77, body: `${MARKER}\n\nnewer` },
      { number: 40, body: `${MARKER}\n\nolder` },
    ];
    expect(findMarkerIssue(issues, MARKER)).toBe(40);
  });

  it("returns null for an empty list", () => {
    expect(findMarkerIssue([], MARKER)).toBeNull();
  });

  it("throws on input that is not an array", () => {
    expect(() => findMarkerIssue({ number: 1 }, MARKER)).toThrow(TypeError);
  });
});

describe("find-marker-issue CLI", () => {
  const run = (input, marker = MARKER) =>
    spawnSync(process.execPath, [SCRIPT, marker], { input, encoding: "utf8" });

  it("prints the matching issue number", () => {
    const out = execFileSync(process.execPath, [SCRIPT, MARKER], {
      input: JSON.stringify([{ number: 40, body: `${MARKER}\n\nreport` }]),
      encoding: "utf8",
    });
    expect(out.trim()).toBe("40");
  });

  it("prints nothing and exits 0 when no issue matches", () => {
    const res = run(JSON.stringify([{ number: 12, body: `quote ${MARKER}` }]));
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });

  it("exits non-zero on malformed input, so a broken lookup fails the step", () => {
    const res = run("HTTP 502 Bad Gateway");
    expect(res.status).not.toBe(0);
    expect(res.stdout).toBe("");
  });

  it("exits non-zero when the marker argument is missing", () => {
    const res = spawnSync(process.execPath, [SCRIPT], { input: "[]", encoding: "utf8" });
    expect(res.status).not.toBe(0);
  });
});
