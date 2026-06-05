/**
 * Forcing-function test for the no-em-dash gate (scripts/check-no-em-dash.mjs).
 *
 * This is the test that protects the gate the issue (#1648) is about: the
 * linter must flag an em dash in a code comment, must NOT flag the standalone
 * "no value" glyph, and must never flag its own detector file. The script's
 * pure helpers are imported directly (no subprocess, no fixture files); the
 * end-to-end repo scan is exercised via `run()`.
 */

import { describe, it, expect } from "vitest";
import * as gate from "../../scripts/check-no-em-dash.mjs";

const { scanText, isStandaloneNoValueGlyph, commentRanges, run, EM_DASH } = gate as {
  scanText: (fileName: string, text: string) => { file: string; line: number }[];
  isStandaloneNoValueGlyph: (text: string) => boolean;
  commentRanges: (text: string) => [number, number][];
  run: () => unknown[];
  EM_DASH: string;
};

describe("no-em-dash gate: comment scanning", () => {
  it("flags an em dash in a single-line comment", () => {
    const v = scanText("x.ts", "// a comment with an em dash " + EM_DASH + " here\n");
    expect(v.length).toBe(1);
  });

  it("flags an em dash in a JSDoc block comment", () => {
    const src = `/**\n * docs ${EM_DASH} with an em dash\n */\nexport const x = 1;\n`;
    expect(scanText("x.ts", src).length).toBe(1);
  });

  it("flags an em dash in a JSX comment", () => {
    const src = `export const A = () => <div>{/* note ${EM_DASH} here */}</div>;\n`;
    expect(scanText("x.tsx", src).length).toBe(1);
  });

  it("flags a line comment that follows a JSX close tag on the same line", () => {
    // The `/` in `</div>` must not be mistaken for a regex open and swallow the
    // trailing comment (regression: the regex heuristic used to trigger on `<`).
    const src = `export const A = () => <div>x</div>; // tail ${EM_DASH} note\n`;
    expect(scanText("x.tsx", src).length).toBe(1);
  });

  it("flags an em dash in a test describe string", () => {
    const src = `describe("a label ${EM_DASH} with a dash", () => {});\n`;
    expect(scanText("x.test.ts", src).length).toBe(1);
  });

  it("flags an em dash inside a template literal (script output)", () => {
    const src = "const n = 3; const s = `count " + EM_DASH + " ${n}`;\n";
    expect(scanText("x.ts", src).length).toBe(1);
  });

  it("does NOT flag a comment that contains only a hyphen", () => {
    expect(scanText("x.ts", "// a normal - comment\n").length).toBe(0);
  });
});

describe("no-em-dash gate: standalone no-value glyph allowance", () => {
  it("treats a string whose only content is the dash as the no-value glyph", () => {
    expect(isStandaloneNoValueGlyph(`"${EM_DASH}"`)).toBe(true);
    expect(isStandaloneNoValueGlyph(EM_DASH)).toBe(true);
  });

  it("treats an em dash embedded in prose as a real violation", () => {
    expect(isStandaloneNoValueGlyph(`"game over ${EM_DASH} done"`)).toBe(false);
  });

  it("does NOT flag a standalone glyph string literal", () => {
    const src = `const fmt = (n: number | null) => (n === null ? "${EM_DASH}" : String(n));\n`;
    expect(scanText("x.ts", src).length).toBe(0);
  });

  it("does NOT flag a standalone glyph in a JSX text node", () => {
    const src = `export const A = () => <p>${EM_DASH}</p>;\n`;
    expect(scanText("x.tsx", src).length).toBe(0);
  });

  it("does NOT flag a test assertion matching the glyph literal", () => {
    const src = `expect(text).not.toContain("${EM_DASH}");\n`;
    expect(scanText("x.test.ts", src).length).toBe(0);
  });
});

describe("no-em-dash gate: comment-range extraction does not misread strings", () => {
  it("does not treat a // inside a string literal as a comment", () => {
    const ranges = commentRanges('const url = "https://example.com/path";\n');
    expect(ranges).toEqual([]);
  });

  it("extracts a trailing line comment after a string literal", () => {
    const ranges = commentRanges('const s = "a"; // trailing\n');
    expect(ranges.length).toBe(1);
  });
});

describe("no-em-dash gate: repo state and self-reference", () => {
  it("the detector file does not flag itself (and the repo is clean)", () => {
    // `run()` scans the whole repo including the detector file, which holds the
    // em-dash glyph by necessity. A clean result proves both the self-reference
    // exclusion and that the repo carries no em dashes in scanned source.
    expect(run()).toEqual([]);
  });
});
