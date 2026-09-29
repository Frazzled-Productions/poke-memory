/**
 * Tests for the workflow marker-lookup lint (#2081), the forcing function that
 * keeps every monitor on .github/scripts/find-marker-issue.mjs.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import {
  findViolations,
  lintWorkflowDir,
  EXEMPT_WINDOW,
} from "./lint-workflow-marker-lookups.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const SCRIPT = resolve(here, "lint-workflow-marker-lookups.mjs");

const rules = (text) => findViolations("w.yml", text).map((v) => v.rule);

describe("findViolations", () => {
  it("flags an unanchored jq contains on an issue body", () => {
    const text = [
      "        run: |",
      '          EXISTING=$(gh issue list --json number,body --limit 100 \\',
      "            | jq -r --arg m \"$MARKER\" '[.[] | select(.body | contains($m))] | .[0].number // empty')",
    ].join("\n");
    const v = findViolations("w.yml", text);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ file: "w.yml", line: 3, rule: "unanchored-contains" });
  });

  it("flags the no-space and --jq escaped forms of the contains match", () => {
    expect(rules(`  --jq '.[] | select(.body|contains("x")) | .id'`)).toEqual([
      "unanchored-contains",
    ]);
    expect(rules(`  --jq ".[] | select(.body | contains(\\"$MARKER\\")) | .id"`)).toEqual([
      "unanchored-contains",
    ]);
    expect(rules(`  jq '.[] | select((.body // "") | contains($m))'`)).toEqual([
      "unanchored-contains",
    ]);
  });

  it("flags an in:body search, with or without a marker variable", () => {
    expect(rules(`  gh issue list --search "$MARKER in:body" --json number`)).toEqual([
      "in-body-search",
    ]);
    expect(rules(`  gh issue list --search 'foo in:body'`)).toEqual(["in-body-search"]);
  });

  it("flags a --search for a marker without in:body", () => {
    expect(rules(`  gh issue list --search "<!-- monitor:x -->"`)).toEqual(["marker-search"]);
    expect(rules(`  gh issue list --search "$MARKER"`)).toEqual(["marker-search"]);
    expect(rules(`  gh issue list --search "\${DEDUP_MARKER}"`)).toEqual(["marker-search"]);
  });

  it("does not flag a --search that is not for a marker", () => {
    expect(rules(`  gh pr list --search "$SHA" --state merged`)).toEqual([]);
  });

  it("ignores comment lines that describe the banned forms", () => {
    const text = [
      "# We do NOT use `gh issue list --search '... in:body'`.",
      "          # an unanchored jq `select(.body | contains($m))` misfired (#1997)",
    ].join("\n");
    expect(rules(text)).toEqual([]);
  });

  it("allows the anchored helper call and a startswith match", () => {
    const text = [
      '          EXISTING=$(node .github/scripts/find-marker-issue.mjs "$MARKER" <<<"$OPEN_ISSUES")',
      `            --jq ".[] | select(.body | startswith(\\"$MARKER\\")) | .id" | head -n1)`,
    ].join("\n");
    expect(rules(text)).toEqual([]);
  });

  it("does not flag a GitHub expression contains() on an event field", () => {
    expect(rules(`       ((contains(github.event.comment.body, '<!-- auto-review:') &&`)).toEqual([]);
  });

  it("exempts a contains match with a reasoned marker-lookup-exempt comment above it", () => {
    const text = [
      "          # marker-lookup-exempt: PR-comment dedup keyed on a per-SHA marker.",
      '          FOUND=$(gh api "repos/$REPO/issues/$PR/comments" --paginate \\',
      "            | jq --arg m \"$MARKER\" '[.[] | select(.body | contains($m))] | length')",
    ].join("\n");
    expect(rules(text)).toEqual([]);
  });

  it("rejects an exemption with no reason, and does not honour it", () => {
    const text = [
      "          # marker-lookup-exempt:",
      "            | jq '[.[] | select(.body | contains($m))]'",
    ].join("\n");
    expect(rules(text)).toEqual(["exempt-reason", "unanchored-contains"]);
  });

  it("does not let an exemption reach past the window", () => {
    const filler = Array.from({ length: EXEMPT_WINDOW }, () => "          echo filler");
    const text = [
      "          # marker-lookup-exempt: too far away",
      ...filler,
      "            | jq '[.[] | select(.body | contains($m))]'",
    ].join("\n");
    expect(rules(text)).toEqual(["unanchored-contains"]);
  });

  it("never exempts an in:body search", () => {
    const text = [
      "          # marker-lookup-exempt: trying to excuse a search",
      '          gh issue list --search "$MARKER in:body"',
    ].join("\n");
    expect(rules(text)).toEqual(["in-body-search"]);
  });
});

describe("the repo's workflows", () => {
  it("contain no body-search or unanchored marker lookups", () => {
    expect(lintWorkflowDir(resolve(repoRoot, ".github/workflows"))).toEqual([]);
  });

  it("CLI exits 0 on the current tree", () => {
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("OK");
  });
});
