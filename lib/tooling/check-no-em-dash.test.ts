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

type Violation = { file: string; line: number; column: number };

const {
  scanText,
  scanPlainText,
  isStandaloneNoValueGlyph,
  commentRanges,
  classify,
  isExcluded,
  looksBinary,
  run,
  EM_DASH,
  EXCLUDED_PATHS,
} = gate as {
  scanText: (fileName: string, text: string) => Violation[];
  scanPlainText: (fileName: string, text: string) => Violation[];
  isStandaloneNoValueGlyph: (text: string) => boolean;
  commentRanges: (text: string) => [number, number][];
  classify: (relPath: string) => "source" | "text" | "skip";
  isExcluded: (relPath: string) => boolean;
  looksBinary: (buf: Uint8Array) => boolean;
  run: () => unknown[];
  EM_DASH: string;
  EXCLUDED_PATHS: string[];
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

describe("no-em-dash gate: file routing (#2045)", () => {
  it.each([
    ["app/page.tsx"],
    ["lib/srs/scheduler.ts"],
    ["eslint.config.mjs"],
    ["next.config.ts"],
    [".github/scripts/cut-release.mjs"],
  ])("parses %s as JS/TS source, wherever it lives", (path) => {
    expect(classify(path)).toBe("source");
  });

  it.each([
    [".github/workflows/ci.yml"],
    [".github/ISSUE_TEMPLATE/bug.yml"],
    ["AGENTS.md"],
    ["WORKFLOW.md"],
    ["docs/dpia.md"],
    [".claude/agents/ui-coder.md"],
    ["changelog.d/unreleased/foo.md"],
    ["CHANGELOG.md"],
    ["scripts/vercel-ignored-build.sh"],
    ["db/migrations/001_initial_sync_schema.sql"],
    ["app/globals.css"],
    ["messages/en.json"],
    ["messages/ja.json"],
    ["LICENSE"],
    [".env.local.example"],
    ["tools/art/generate.py"],
  ])("line-scans %s as plain text (no docs exemption)", (path) => {
    expect(classify(path)).toBe("text");
  });

  it.each([
    ["public/sprites/pokemon/25.png"],
    ["public/sprites/pokemon/webp/25/192.webp"],
    ["public/cries/25.ogg"],
    ["public/cries/25.mp3"],
    ["docs/screenshots/practice-cardflip.gif"],
  ])("skips the known binary %s without reading it", (path) => {
    expect(classify(path)).toBe("skip");
  });

  it("skips the detector file itself", () => {
    expect(classify("scripts/check-no-em-dash.mjs")).toBe("skip");
  });

  it("sniffs a NUL byte as binary, and plain UTF-8 as text", () => {
    expect(looksBinary(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))).toBe(true);
    expect(looksBinary(new TextEncoder().encode(`a line ${EM_DASH} of text\n`))).toBe(false);
  });
});

describe("no-em-dash gate: exclusions (#2045)", () => {
  it.each([
    ["package-lock.json"],
    ["lib/pokemon/generated.json"],
    ["lib/pokemon/generated-flavor.json"],
    ["public/pokemon-data/generated-core.json"],
    ["messages/xx-pseudo.json"],
  ])("excludes the generated / third-party file %s", (path) => {
    expect(isExcluded(path)).toBe(true);
    expect(classify(path)).toBe("skip");
  });

  it("does not over-match: authored neighbours of excluded paths are still scanned", () => {
    for (const path of [
      "lib/pokemon/generated.ts",
      "lib/pokemon/seed.json",
      "public/pokemon-data.md",
      "messages/en.json",
      "package.json",
    ]) {
      expect(isExcluded(path)).toBe(false);
    }
  });

  it("every exclusion entry is an exact path or a directory prefix ending in /", () => {
    for (const entry of EXCLUDED_PATHS) {
      expect(entry.startsWith("/")).toBe(false);
      expect(entry.includes("*")).toBe(false);
    }
  });
});

describe("no-em-dash gate: plain-text line scan (#2045)", () => {
  it("flags a YAML comment", () => {
    const v = scanPlainText(".github/workflows/x.yml", `on: push\n# note ${EM_DASH} here\n`);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(2);
  });

  it("flags a YAML run string (CI log output)", () => {
    const src = `jobs:\n  a:\n    steps:\n      - run: echo "skip ${EM_DASH} nothing to do"\n`;
    expect(scanPlainText("x.yml", src)).toHaveLength(1);
  });

  it("flags Markdown prose, including in docs and YAML front matter", () => {
    const src = `---\ndescription: an agent ${EM_DASH} with a dash\n---\n\n# Title\n\nBody ${EM_DASH} text.\n`;
    const v = scanPlainText("docs/x.md", src);
    expect(v.map((x) => x.line)).toEqual([2, 7]);
  });

  it("flags a shell comment and an echo string", () => {
    const src = `#!/bin/sh\n# why ${EM_DASH} because\necho "done ${EM_DASH} ok"\n`;
    expect(scanPlainText("x.sh", src)).toHaveLength(2);
  });

  it("flags SQL and CSS comments", () => {
    expect(scanPlainText("x.sql", `-- note ${EM_DASH} here\nselect 1;\n`)).toHaveLength(1);
    expect(scanPlainText("x.css", `/* note ${EM_DASH} here */\n.a { color: red; }\n`)).toHaveLength(1);
  });

  it("flags UI copy in a JSON message catalogue, in any locale", () => {
    expect(scanPlainText("messages/en.json", `{ "a": "Done ${EM_DASH} well played" }\n`)).toHaveLength(1);
    expect(scanPlainText("messages/zh-Hans.json", `{ "a": "完成${EM_DASH}${EM_DASH}好" }\n`)).toHaveLength(1);
  });

  it("does not flag other dash characters (en dash, horizontal bar, hyphen)", () => {
    const src = "{ \"a\": \"1\u20132\", \"b\": \"完成\u2015\u2015好\", \"c\": \"a - b\" }\n";
    expect(scanPlainText("messages/zh-Hant.json", src)).toEqual([]);
  });

  it("gives no standalone-glyph allowance outside JS/TS", () => {
    expect(scanPlainText("x.md", `| value | ${EM_DASH} |\n`)).toHaveLength(1);
  });

  it("reports the 1-based line and column of the first dash", () => {
    const v = scanPlainText("x.md", `one\ntwo ${EM_DASH} three ${EM_DASH}\n`);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ line: 2, column: 5 });
  });

  it("returns nothing for clean text", () => {
    expect(scanPlainText("x.md", "a spaced - hyphen, a comma, a colon: fine\n")).toEqual([]);
  });
});

describe("no-em-dash gate: repo state and self-reference", () => {
  it("the detector file does not flag itself (and the repo is clean)", () => {
    // `run()` scans every tracked file including the detector file, which holds
    // the em-dash glyph by necessity. A clean result proves both the
    // self-reference exclusion and that no tracked text (source, docs,
    // workflows, SQL, CSS, catalogues) carries an em dash.
    expect(run()).toEqual([]);
  });
});
