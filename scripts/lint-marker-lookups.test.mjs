/**
 * Forcing-function tests for scripts/lint-marker-lookups.mjs (#2081), the
 * lint check that stops workflows from looking up a marker with `in:body`
 * search or an unanchored contains().
 *
 * The flagged fixtures are lines copied from the workflows as they stood when
 * #2081 was filed, so the check is pinned against the forms that actually
 * misfired rather than against paraphrases of them.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { ALLOWLIST, applyAllowlist, run, scanText } from "./lint-marker-lookups.mjs";

const flagged = (line) => scanText("x.yml", line).length > 0;

describe("scanText: forms that have misfired", () => {
  it.each([
    [
      "auto-release.yml qa-drift-check (#1997)",
      `            | jq -r --arg m "$MARKER" '[.[] | select(.body | contains($m))] | .[0].number // empty')`,
    ],
    [
      "cron-health-monitor.yml",
      `              '[.[] | select(.body | contains($marker))] | .[0].number // empty')`,
    ],
    [
      "pokeapi-species-monitor.yml",
      `            '[.[] | select(.body | contains($marker))] | .[0].number // empty')`,
    ],
    ["monitor-grade-log-divergence.yml (#2003)", `            --search "$MARKER in:body" \\`],
    [
      "coverage.yml comment lookup",
      `            --jq ".[] | select(.body | contains(\\"$MARKER\\")) | .id" | head -1 || echo "")`,
    ],
    [
      "vercel-preview-on-ready.yml if: filter",
      `       ((contains(github.event.comment.body, '<!-- auto-review:') &&`,
    ],
    ["a search in single quotes", `gh issue list --search '<!-- x --> in:body'`],
  ])("flags %s", (_name, line) => {
    expect(flagged(line)).toBe(true);
  });

  it("reports the rule and the 1-based line number", () => {
    const text = ["run: |", "  set -e", `  gh issue list --search "$MARKER in:body"`].join("\n");
    expect(scanText("m.yml", text)).toEqual([
      {
        file: "m.yml",
        line: 3,
        rules: ["search-in-body"],
        text: `gh issue list --search "$MARKER in:body"`,
      },
    ]);
  });
});

describe("scanText: forms that are fine", () => {
  it.each([
    ["a jq startswith lookup", `'[.[] | select(.body | startswith($marker))] | .[0].number'`],
    ["an Actions startsWith expression", `if: startsWith(github.event.comment.body, '/preview')`],
    [
      "the shared helper call",
      `EXISTING=$(node .github/scripts/find-marker-issue.mjs --repo "$REPO" --marker "$MARKER")`,
    ],
    [
      "a label check",
      `HAS_LABEL: \${{ contains(github.event.pull_request.labels.*.name, 'no-changelog') }}`,
    ],
    [
      "an author-association check",
      `contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'),`,
    ],
    ["a body file argument", `gh issue edit "$EXISTING" --repo "$REPO" --body-file "$BODY_FILE"`],
    ["a YAML or shell comment naming the banned form", `  # We do NOT use --search '... in:body' here`],
    ["a comment naming contains() on a body", `# select(.body | contains($m)) took over #1997`],
  ])("does not flag %s", (_name, line) => {
    expect(flagged(line)).toBe(false);
  });

  it("handles CRLF files and blank lines", () => {
    expect(scanText("x.yml", "a\r\n\r\n  --search \"x in:body\"\r\n")).toHaveLength(1);
    expect(scanText("x.yml", "\r\n\r\n")).toEqual([]);
  });
});

describe("applyAllowlist", () => {
  const v = (file, text, line = 1) => ({ file, line, rules: ["unanchored-contains"], text });

  it("removes the one line an entry names", () => {
    const violations = [v("a.yml", "select(.body | contains($m))"), v("b.yml", "other contains( body")];
    const result = applyAllowlist(violations, [
      { file: "a.yml", needle: "contains($m)", reason: "test" },
    ]);
    expect(result.violations).toEqual([violations[1]]);
    expect(result.problems).toEqual([]);
  });

  it("only matches the named file", () => {
    const violations = [v("b.yml", "select(.body | contains($m))")];
    const result = applyAllowlist(violations, [
      { file: "a.yml", needle: "contains($m)", reason: "test" },
    ]);
    expect(result.violations).toEqual(violations);
    expect(result.problems).toHaveLength(1);
  });

  it("reports an entry whose line is gone or fixed, so exemptions cannot go stale", () => {
    const result = applyAllowlist([], [{ file: "a.yml", needle: "contains($m)", reason: "test" }]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("remove the entry");
  });

  it("will not let one entry cover a copied line", () => {
    const violations = [
      v("a.yml", "select(.body | contains($m))", 3),
      v("a.yml", "select(.body | contains($m))", 9),
    ];
    const result = applyAllowlist(violations, [
      { file: "a.yml", needle: "contains($m)", reason: "test" },
    ]);
    expect(result.violations).toEqual(violations);
    expect(result.problems[0]).toContain("matches 2 flagged lines");
  });
});

describe("run", () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function fixture(files) {
    root = mkdtempSync(join(tmpdir(), "lint-marker-lookups-"));
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(root, ".github/workflows", name), text);
    }
    return root;
  }

  it("passes the real workflows with the real allowlist", () => {
    expect(run()).toEqual({ violations: [], problems: [] });
  });

  it("gives every allowlist entry a reason", () => {
    for (const entry of ALLOWLIST) {
      expect(entry.reason.length, `${entry.file}: ${entry.needle}`).toBeGreaterThan(20);
    }
  });

  it("flags a real exempted line once its entry is removed", () => {
    const allowlist = ALLOWLIST.filter(
      (e) => e.needle !== "contains(github.event.comment.body, '<!-- auto-review:')",
    );
    const { violations, problems } = run({ allowlist });
    expect(problems).toEqual([]);
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe("vercel-preview-on-ready.yml");
    expect(violations[0].text).toContain("contains(github.event.comment.body");
  });

  it("scans .yml and .yaml files and ignores everything else", () => {
    const dir = fixture({
      "new-monitor.yaml": `run: |\n  gh issue list --search "$MARKER in:body"\n`,
      "other.yml": `run: |\n  jq 'select(.body | contains($m))'\n`,
      "notes.md": `select(.body | contains($m)) in:body\n`,
    });
    const { violations } = run({ root: dir, allowlist: [] });
    expect(violations.map((x) => [x.file, x.line])).toEqual([
      ["new-monitor.yaml", 2],
      ["other.yml", 2],
    ]);
  });
});
