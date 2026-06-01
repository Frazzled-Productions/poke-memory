#!/usr/bin/env node
// Fails CI if any changelog fragment under changelog.d/unreleased/ is malformed.
//
// auto-release.yml assembles these fragments into the next CHANGELOG section.
// A fragment missing its YAML front-matter (or with an unknown `kind`, or with
// no bullet body) breaks that assembly. This was caught only by auto-review on
// PR #1503 when a fragment shipped as the bare text `patch` instead of valid
// front-matter; this gate makes the failure local and immediate instead.
//
// Contract (mirrors changelog.d/README.md):
//   - YAML front-matter delimited by a leading `---` and a closing `---`.
//   - A `kind:` field whose value is one of the VALID_KINDS below.
//   - At least one `- ` bullet line in the body, EXCEPT for `minor-bump`,
//     which carries no bullet (it only requests a minor version bump).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIR = resolve(ROOT, "changelog.d", "unreleased");

const VALID_KINDS = [
  "added",
  "changed",
  "removed",
  "deprecated",
  "fixed",
  "security",
  "minor-bump",
];

// Files in the directory that are not fragments and must be skipped.
const SKIP = new Set(["README.md", ".gitkeep"]);

/**
 * Validate a single fragment's text. Returns an array of human-readable
 * problem strings (empty when the fragment is well-formed).
 */
function problemsFor(text) {
  const problems = [];
  const lines = text.split("\n");

  if (lines[0]?.trim() !== "---") {
    problems.push(
      "missing opening YAML front-matter delimiter `---` on line 1 " +
        "(fragments need front-matter with a `kind:` field, see changelog.d/README.md)",
    );
    return problems;
  }

  // Find the closing delimiter.
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    problems.push("missing closing YAML front-matter delimiter `---`");
    return problems;
  }

  const frontMatter = lines.slice(1, closeIdx);
  const kindLine = frontMatter.find((l) => /^\s*kind\s*:/.test(l));
  if (!kindLine) {
    problems.push("front-matter has no `kind:` field");
    return problems;
  }

  const kind = kindLine.replace(/^\s*kind\s*:/, "").trim();
  if (!VALID_KINDS.includes(kind)) {
    problems.push(
      `\`kind: ${kind || "(empty)"}\` is not valid; expected one of ${VALID_KINDS.join(", ")}`,
    );
  }

  const body = lines.slice(closeIdx + 1);
  const hasBullet = body.some((l) => /^\s*-\s+\S/.test(l));
  if (kind !== "minor-bump" && !hasBullet) {
    problems.push("no `- ` bullet line in the body");
  }

  return problems;
}

let fileNames;
try {
  fileNames = readdirSync(DIR);
} catch (err) {
  console.error(`✗ cannot read ${DIR}: ${err.message}`);
  process.exit(1);
}

const fragments = fileNames
  .filter((name) => name.endsWith(".md") && !SKIP.has(name))
  .sort();

let failures = 0;
for (const name of fragments) {
  const text = readFileSync(resolve(DIR, name), "utf8");
  const problems = problemsFor(text);
  if (problems.length > 0) {
    failures++;
    console.error(`✗ changelog.d/unreleased/${name}:`);
    for (const p of problems) {
      console.error(`    - ${p}`);
    }
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} malformed changelog fragment(s). ` +
      `See changelog.d/README.md for the required format.`,
  );
  process.exit(1);
}

console.log(`✓ ${fragments.length} changelog fragment(s) well-formed.`);
