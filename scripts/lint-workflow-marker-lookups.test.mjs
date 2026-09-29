/**
 * Tests for the workflow marker-lookup lint (#2081), the forcing function that
 * keeps every monitor on .github/scripts/find-marker-issue.mjs.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { findViolations, lintWorkflowDir } from "./lint-workflow-marker-lookups.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const SCRIPT = resolve(here, "lint-workflow-marker-lookups.mjs");

/** Wrap shell lines in a minimal step so they sit in a `run: |` block. */
const step = (...shell) =>
  ["      - name: s", "        run: |", ...shell.map((l) => `          ${l}`)].join("\n");

const rules = (text) => findViolations("w.yml", text).map((v) => v.rule);

describe("line rules", () => {
  it("flags an unanchored jq contains on an issue body", () => {
    const text = step(
      'EXISTING=$(gh api "repos/$REPO/issues/$PR/comments" \\',
      "  | jq -r --arg m \"$MARKER\" '[.[] | select(.body | contains($m))] | .[0].number // empty')",
    );
    const v = findViolations("w.yml", text);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ file: "w.yml", line: 4, rule: "unanchored-body-match" });
  });

  it("flags the no-space, escaped --jq and parenthesised forms", () => {
    expect(rules(step(`X=$(gh api u --jq '.[] | select(.body|contains("x")) | .id')`))).toEqual([
      "unanchored-body-match",
    ]);
    expect(rules(step(`X=$(gh api u --jq ".[] | select(.body | contains(\\"$MARKER\\")) | .id")`))).toEqual([
      "unanchored-body-match",
    ]);
    expect(rules(step(`X=$(jq '.[] | select((.body // "") | contains($m))' f)`))).toEqual([
      "unanchored-body-match",
    ]);
  });

  it("flags test( and index( and a match with pipes between .body and the call", () => {
    expect(rules(step(`X=$(jq '.[] | select(.body | test($m))' f)`))).toEqual([
      "unanchored-body-match",
    ]);
    expect(rules(step(`X=$(jq '.[] | select(.body | index($m))' f)`))).toEqual([
      "unanchored-body-match",
    ]);
    expect(
      rules(step(`X=$(jq '.[] | select(.body | ascii_downcase | ltrimstr(" ") | contains($m))' f)`)),
    ).toEqual(["unanchored-body-match"]);
  });

  it("flags an in:body search, with or without a marker variable", () => {
    expect(rules(step(`gh issue list --search "$MARKER in:body" --json number`))).toEqual([
      "in-body-search",
    ]);
    expect(rules(step(`gh issue list --search 'foo in:body'`))).toEqual(["in-body-search"]);
  });

  it("flags a --search for a marker without in:body", () => {
    expect(rules(step(`gh issue list --search "<!-- monitor:x -->"`))).toEqual(["marker-search"]);
    expect(rules(step(`gh issue list --search "$MARKER"`))).toEqual(["marker-search"]);
    expect(rules(step(`gh issue list --search "\${DEDUP_MARKER}"`))).toEqual(["marker-search"]);
  });

  it("does not flag a --search that is not for a marker", () => {
    expect(rules(step(`gh pr list --search "$SHA" --state merged`))).toEqual([]);
  });

  it("ignores comment lines that describe the banned forms", () => {
    const text = [
      "# We do NOT use `gh issue list --search '... in:body'`.",
      step("# an unanchored jq `select(.body | contains($m))` misfired (#1997)", "echo ok"),
    ].join("\n");
    expect(rules(text)).toEqual([]);
  });

  it("allows a startswith match and a GitHub expression contains()", () => {
    expect(rules(step(`X=$(gh api u --jq ".[] | select(.body | startswith(\\"$M\\")) | .id")`))).toEqual([]);
    expect(rules(`        if: contains(github.event.comment.body, '<!-- auto-review:')`)).toEqual([]);
  });

  it("does not read `||` in an `if:` expression as a jq pipe", () => {
    expect(
      rules(`        if: github.event.comment.body == '' || contains(github.event.comment.body, '/preview')`),
    ).toEqual([]);
    // A single jq pipe later in the same expression is still caught.
    expect(rules(step(`X=$(jq '.[] | select(.body == "" or (.body | contains($m)))' f)`))).toEqual([
      "unanchored-body-match",
    ]);
  });
});

describe("issue-list-no-helper (positive rule)", () => {
  it("flags a step that lists issue bodies without calling the helper", () => {
    const text = step(
      'OPEN=$(gh issue list --repo "$REPO" --state open \\',
      "  --limit 500 --json number,body,author)",
      'echo "$OPEN"',
    );
    const v = findViolations("w.yml", text);
    expect(v.map((x) => x.rule)).toEqual(["issue-list-no-helper"]);
    expect(v[0].line).toBe(3);
  });

  it("passes when the same step calls find-marker-issue.mjs", () => {
    const text = step(
      'OPEN=$(gh issue list --repo "$REPO" --state open --limit 500 --json number,body,author)',
      'EXISTING=$(node .github/scripts/find-marker-issue.mjs "$MARKER" --author github-actions <<<"$OPEN")',
    );
    expect(rules(text)).toEqual([]);
  });

  it("does not count a helper call in a DIFFERENT step", () => {
    const text = [
      step('OPEN=$(gh issue list --json number,body)'),
      step('node .github/scripts/find-marker-issue.mjs "$M" --author x <<<"$OPEN"'),
    ].join("\n");
    expect(rules(text)).toEqual(["issue-list-no-helper"]);
  });

  it("flags gh api on an issues LIST endpoint but not a single issue or its comments", () => {
    expect(rules(step('X=$(gh api "repos/$REPO/issues?state=open" --paginate)'))).toEqual([
      "issue-list-no-helper",
    ]);
    expect(rules(step('X=$(gh api "repos/$REPO/issues" --paginate)'))).toEqual([
      "issue-list-no-helper",
    ]);
    expect(rules(step(`X=$(gh api "repos/$REPO/issues/$N" --jq '.body // ""')`))).toEqual([]);
    expect(rules(step('X=$(gh api "repos/$REPO/issues/$N/comments")'))).toEqual([]);
  });

  it("flags the --json= spelling, gh search issues and a gh api graphql issue-body query", () => {
    expect(rules(step("X=$(gh issue list --json=number,body)"))).toEqual(["issue-list-no-helper"]);
    expect(rules(step('X=$(gh search issues --repo "$R" --json number,body)'))).toEqual([
      "issue-list-no-helper",
    ]);
    expect(rules(step('X=$(gh search issues --repo "$R" --json=body,number)'))).toEqual([
      "issue-list-no-helper",
    ]);
    expect(
      rules(
        step(
          "X=$(gh api graphql -f query='",
          '  query { repository(owner: "o", name: "r") {',
          "    issues(first: 100) { nodes { number body } } } }')",
        ),
      ),
    ).toEqual(["issue-list-no-helper"]);
    expect(rules(step("X=$(gh search issues --json number,title)"))).toEqual([]);
    expect(
      rules(step("X=$(gh api graphql -f query='query { viewer { issues(first: 1) { totalCount } } }')")),
    ).toEqual([]);
  });

  it("does not flag an issue list that does not request bodies", () => {
    expect(rules(step('X=$(gh issue list --json number,state --jq ".[].number")'))).toEqual([]);
  });

  it("accepts an issue-body-read-exempt for a non-marker body read", () => {
    const text = step(
      "# issue-body-read-exempt: parses task-list checkboxes, not a marker.",
      "C=$(gh issue list --label x \\",
      "  --json number,body \\",
      `  --jq '.[] | select(.body | test("- \\\\[.\\\\] #1")) | .number')`,
    );
    expect(rules(text)).toEqual([]);
  });

  it("rejects an issue-body-read-exempt on a statement without --label", () => {
    const text = step(
      "# issue-body-read-exempt: parses task-list checkboxes, not a marker.",
      "C=$(gh issue list --state open \\",
      "  --json number,body \\",
      `  --jq '.[] | select(.body | test("- \\\\[.\\\\] #1")) | .number')`,
    );
    const v = findViolations("w.yml", text);
    expect(v.map((x) => x.rule).sort()).toEqual(
      ["exempt-misuse", "issue-list-no-helper", "unanchored-body-match"].sort(),
    );
    expect(v.find((x) => x.rule === "exempt-misuse").message).toContain("--label");
  });

  it("rejects an issue-body-read-exempt on a statement that mentions a marker", () => {
    const text = step(
      "# issue-body-read-exempt: trying to dodge the helper.",
      `C=$(gh issue list --json number,body --jq '.[] | select(.body | startswith("<!-- x -->"))')`,
    );
    expect(rules(text)).toEqual(["exempt-misuse", "issue-list-no-helper"]);
  });
});

describe("exemption scoping", () => {
  it("exempts a PR-comment lookup directly below the comment", () => {
    const text = step(
      "# marker-lookup-exempt: PR-comment dedup keyed on a per-SHA marker.",
      'FOUND=$(gh api "repos/$REPO/issues/$PR/comments" --paginate \\',
      "  | jq --arg m \"$MARKER\" '[.[] | select(.body | contains($m))] | length')",
    );
    expect(rules(text)).toEqual([]);
  });

  it("covers a multi-line quoted --jq as one statement", () => {
    const text = step(
      "# marker-lookup-exempt: bot-authored per-SHA dedup.",
      'MATCH=$(gh api "repos/$REPO/issues/$PR/comments" --paginate \\',
      '  --jq "[.[] | select(.user.login == \\"bot\\")',
      '             | select(.body | contains(\\"<!-- x:$SHA -->\\"))] | length")',
    );
    expect(rules(text)).toEqual([]);
  });

  it("covers only the NEXT statement, not a later one", () => {
    const text = step(
      "# marker-lookup-exempt: PR-comment dedup.",
      'A=$(gh api "repos/$REPO/issues/$PR/comments" --jq \'[.[] | select(.body | contains("a"))]\')',
      'B=$(gh api "repos/$REPO/issues/$PR/comments" --jq \'[.[] | select(.body | contains("b"))]\')',
    );
    const v = findViolations("w.yml", text);
    expect(v.map((x) => x.rule)).toEqual(["unanchored-body-match"]);
    expect(v[0].line).toBe(5);
  });

  it("does not reach across a blank line or an intervening statement", () => {
    const text = step(
      "# marker-lookup-exempt: PR-comment dedup.",
      "",
      'A=$(gh api "repos/$REPO/issues/$PR/comments" --jq \'[.[] | select(.body | contains("a"))]\')',
    );
    expect(rules(text)).toEqual(["exempt-unused", "unanchored-body-match"]);
  });

  it("rejects a marker-lookup-exempt on something that is not a PR-comment lookup", () => {
    const text = step(
      "# marker-lookup-exempt: sneaking a tracking-issue lookup through.",
      `X=$(jq '[.[] | select(.body | contains($m))]' issues.json)`,
    );
    expect(rules(text)).toEqual(["exempt-misuse", "unanchored-body-match"]);
  });

  it("rejects an exemption with no reason, and does not honour it", () => {
    const text = step(
      "# marker-lookup-exempt:",
      'X=$(gh api "repos/$R/issues/$P/comments" --jq \'[.[] | select(.body | contains($m))]\')',
    );
    expect(rules(text)).toEqual(["exempt-reason", "unanchored-body-match"]);
  });

  it("flags an exemption above a statement that needs none", () => {
    const text = step("# marker-lookup-exempt: nothing to exempt.", 'gh api "repos/$R/issues/$P/comments"');
    expect(rules(text)).toEqual(["exempt-unused"]);
  });

  it("never exempts an in:body search", () => {
    const text = step(
      "# marker-lookup-exempt: trying to excuse a search.",
      'gh api "repos/$R/issues/$P/comments" && gh issue list --search "$MARKER in:body"',
    );
    expect(rules(text)).toContain("in-body-search");
  });

  it("skips heredoc bodies when splitting statements", () => {
    const text = step(
      'cat > "$F" <<EOF',
      "qa's body text with an apostrophe",
      "EOF",
      "# marker-lookup-exempt: PR-comment dedup.",
      'A=$(gh api "repos/$REPO/issues/$PR/comments" --jq \'[.[] | select(.body | contains("a"))]\')',
    );
    expect(rules(text)).toEqual([]);
  });
});

describe("the repo's workflows", () => {
  it("contain no body-search, unanchored or helper-less marker lookups", () => {
    expect(lintWorkflowDir(resolve(repoRoot, ".github/workflows"))).toEqual([]);
  });

  it("pins the number of issue-body-read-exempt uses, so adding one is a visible change", () => {
    // Today: auto-close-umbrella.yml's label-gated task-list read only. Raise
    // this deliberately, and say why in the PR, when adding another.
    const dir = resolve(repoRoot, ".github/workflows");
    const uses = readdirSync(dir)
      .filter((name) => /\.ya?ml$/.test(name))
      .flatMap((name) =>
        readFileSync(resolve(dir, name), "utf8")
          .split("\n")
          .filter((line) => /^\s*#\s*issue-body-read-exempt:/.test(line))
          .map(() => name),
      );
    expect(uses).toEqual(["auto-close-umbrella.yml"]);
  });

  it("CLI exits 0 on the current tree", () => {
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("OK");
  });
});
